/**
 * Repeatable staging -> production data migration, working ONLY on local SQLite files (copies of the two D1 databases, made with `wrangler d1 export`). It never connects to D1.
 *   dry run (default): reads both files, builds and validates the plan, writes nothing anywhere (the apply is rehearsed on an in-memory copy of the target).
 *   --apply:           writes to the TARGET FILE in one transaction (rolled back on any failed check). Use it on disposable copies.
 *   --emit-sql:        writes the SQL to run on the live database (`wrangler d1 execute --file`), plus a rollback script and a verification script.
 * Rules: rows are only ever INSERTed (never replaced or updated); a primary-key or unique-key conflict stops everything; excluded tables can never be selected; every table must be classified in plan.mjs.
 */
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { GROUPS, GROUP_MODULE, LOGICAL_REFS, TABLES } from './plan.mjs'

const q = (name) => `"${String(name).replace(/"/g, '""')}"`
const SEP = '\u0001'

export const open = (path, { readOnly = false } = {}) => {
  if (!existsSync(path)) throw new Error(`No such file: ${path}`)
  return new DatabaseSync(path, { readOnly })
}
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'").all().map((r) => r.name).sort()
const columns = (db, t) => db.prepare(`PRAGMA table_info(${q(t)})`).all()
const pkCols = (db, t) => columns(db, t).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)
const fks = (db, t) => db.prepare(`PRAGMA foreign_key_list(${q(t)})`).all().map((f) => ({ column: f.from, parent: f.table, parentColumn: f.to }))
const pkOf = (row, pk) => pk.map((c) => String(row[c])).join(SEP)

/** Copies a database into memory (so a rehearsal can never touch the file). */
export function cloneInMemory(src) {
  const mem = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
  const objs = src.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all()
  for (const o of objs) if (o.type === 'table') mem.exec(o.sql)
  for (const t of objs.filter((o) => o.type === 'table')) {
    const rows = src.prepare(`SELECT * FROM ${q(t.name)}`).all()
    if (!rows.length) continue
    const cols = Object.keys(rows[0])
    const ins = mem.prepare(`INSERT INTO ${q(t.name)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    for (const row of rows) ins.run(...cols.map((c) => row[c]))
  }
  for (const o of objs) if (o.type !== 'table') mem.exec(o.sql)
  return mem
}

/** The tables a run will touch, parents before children. Throws on anything unclassified, excluded, or inconsistent. */
export function selectTables(source, target, { groups = [], include = [] } = {}) {
  const errors = []
  for (const g of groups) if (!GROUPS[g]) errors.push(`Unknown group "${g}" (known: ${Object.keys(GROUPS).join(', ')}).`)
  for (const t of tableNames(source)) if (!TABLES[t]) errors.push(`Table "${t}" is not classified in plan.mjs: review it manually before migrating.`)
  for (const t of include) {
    if (!TABLES[t]) errors.push(`Unknown table "${t}".`)
    else if (TABLES[t].action === 'exclude') errors.push(`Table "${t}" is excluded and can never be migrated (${TABLES[t].reason})`)
    else if (TABLES[t].action !== 'review') errors.push(`Table "${t}" is not a review table; select its group instead.`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  const picked = Object.entries(TABLES).filter(([name, c]) => (c.action === 'migrate' && groups.includes(c.group)) || include.includes(name)).map(([name]) => name)
  const present = new Set(tableNames(target))
  const selected = picked.filter((t) => tableNames(source).includes(t))
  for (const t of selected) {
    if (!present.has(t)) throw new Error(`Table "${t}" does not exist in the target.`)
    const sc = columns(source, t).map((c) => `${c.name}:${c.type}`).sort().join(',')
    const tc = columns(target, t).map((c) => `${c.name}:${c.type}`).sort().join(',')
    if (sc !== tc) throw new Error(`Table "${t}" has a different shape in source and target (apply the same migrations to both first).`)
  }
  // Parents first, from the target's foreign keys.
  const order = []
  const seen = new Set()
  const visit = (t) => {
    if (seen.has(t)) return
    seen.add(t)
    for (const f of fks(target, t)) if (selected.includes(f.parent) && f.parent !== t) visit(f.parent)
    order.push(t)
  }
  selected.forEach(visit)
  return order
}

const sameRow = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k])

/** Builds the plan: which rows go, which are skipped and why, and every conflict. Reads only. */
export function buildPlan(source, target, opts = {}) {
  const { excludeRows = {} } = opts
  const order = selectTables(source, target, opts)
  const kept = new Map()
  const tables = []
  const problems = []
  const exists = (t, pk, value) => target.prepare(`SELECT 1 FROM ${q(t)} WHERE ${q(pk)} = ? LIMIT 1`).get(value) != null

  for (const t of order) {
    const cfg = TABLES[t]
    const pk = pkCols(source, t)
    const rows = source.prepare(`SELECT * FROM ${q(t)}${cfg.filter ? ` WHERE ${cfg.filter}` : ''} ORDER BY rowid`).all()
    const total = source.prepare(`SELECT count(*) AS n FROM ${q(t)}`).get().n
    const info = { table: t, pk: pk[0], group: cfg.group, action: cfg.action, sourceRows: total, filteredOut: total - rows.length, excludedByRequest: 0, cascaded: 0, skippedIdentical: 0, insert: [], conflicts: [] }
    const dropped = new Set(excludeRows[t] ?? [])
    let live = rows.filter((row) => { const drop = dropped.has(String(row[pk[0]])); if (drop) info.excludedByRequest++; return !drop })
    // Follow the foreign keys and the logical references: a child of an excluded row is excluded with it.
    const parentsOf = [
      ...fks(target, t).filter((f) => kept.has(f.parent)).map((f) => ({ column: f.column, sets: [kept.get(f.parent)], skip: (v) => v === null })),
      ...LOGICAL_REFS.filter((l) => l.table === t && kept.has(l.parent)).map((l) => ({ column: l.column, sets: [l.parent, ...(l.alsoIn ?? [])].filter((p) => kept.has(p)).map((p) => kept.get(p)), skip: (v) => v === null || (l.skip && l.skip(v)) })),
    ]
    live = live.filter((row) => {
      for (const p of parentsOf) { const v = row[p.column]; if (!p.skip(v) && !p.sets.some((s) => s.has(String(v)))) { info.cascaded++; return false } }
      return true
    })
    for (const row of live) {
      const existing = target.prepare(`SELECT * FROM ${q(t)} WHERE ${pk.map((c) => `${q(c)} = ?`).join(' AND ')}`).get(...pk.map((c) => row[c]))
      if (existing) {
        if (cfg.merge === 'skip-identical' && sameRow(existing, row)) info.skippedIdentical++
        else info.conflicts.push(`${t}: primary key ${pkOf(row, pk)} already exists in the target${cfg.merge ? ' with different values' : ''}`)
        continue
      }
      for (const idx of target.prepare(`PRAGMA index_list(${q(t)})`).all().filter((i) => i.unique && i.origin !== 'pk')) {
        const cols = target.prepare(`PRAGMA index_info(${q(idx.name)})`).all().map((c) => c.name)
        const hit = target.prepare(`SELECT 1 FROM ${q(t)} WHERE ${cols.map((c) => `${q(c)} IS ?`).join(' AND ')} LIMIT 1`).get(...cols.map((c) => row[c]))
        if (hit && !(cols.some((c) => row[c] === null))) info.conflicts.push(`${t}: unique key (${cols.join(', ')}) = (${cols.map((c) => row[c]).join(', ')}) already exists in the target`)
      }
      info.insert.push(row)
    }
    // Rows skipped as identical still count as present for the children that reference them.
    kept.set(t, new Set(live.map((row) => String(row[pk[0]]))))
    problems.push(...info.conflicts)
    tables.push(info)
  }
  // Every foreign key of an inserted row must point at a row that will exist.
  for (const info of tables) {
    for (const f of fks(target, info.table)) {
      if (kept.has(f.parent)) continue
      for (const row of info.insert) {
        const v = row[f.column]
        if (v !== null && !exists(f.parent, f.parentColumn ?? pkCols(target, f.parent)[0], v)) problems.push(`${info.table}.${f.column} = ${v} points at ${f.parent}, which is neither migrated nor already in the target`)
      }
    }
  }
  return { order, tables, problems, groups: opts.groups ?? [], include: opts.include ?? [], ok: problems.length === 0 }
}

const modulesOf = (plan) => [...new Set(plan.tables.filter((t) => t.insert.length).map((t) => GROUP_MODULE[t.group]).filter(Boolean))].sort()

/** Inserts the plan into `target` in one transaction; every check runs before COMMIT and any failure rolls everything back. */
export function applyPlan(target, plan, { bumpVersions = true } = {}) {
  if (!plan.ok) throw new Error(`Refusing to apply a plan with problems:\n${plan.problems.join('\n')}`)
  target.exec('PRAGMA foreign_keys = ON')
  target.exec('BEGIN IMMEDIATE')
  try {
    for (const info of plan.tables) {
      if (!info.insert.length) continue
      const cols = Object.keys(info.insert[0])
      const ins = target.prepare(`INSERT INTO ${q(info.table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      for (const row of info.insert) ins.run(...cols.map((c) => row[c]))
    }
    if (bumpVersions) for (const mod of modulesOf(plan)) target.prepare('UPDATE module_versions SET version = version + 1 WHERE module = ?').run(mod)
    const violations = target.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new Error(`Foreign key violations after the insert: ${JSON.stringify(violations.slice(0, 5))}`)
    target.exec('COMMIT')
  } catch (e) {
    target.exec('ROLLBACK')
    throw e
  }
}

const hashRows = (rows, pk) => createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => (pkOf(a, pk) < pkOf(b, pk) ? -1 : 1)))).digest('hex')

/** Checks an applied target against the plan: counts, row-for-row content, foreign keys, logical references, integrity. */
export function verify(target, plan) {
  const checks = []
  const add = (ok, label, detail = '') => checks.push({ ok, label, detail })
  for (const info of plan.tables) {
    const pk = pkCols(target, info.table)
    const migrated = info.insert
    const have = migrated.length ? target.prepare(`SELECT * FROM ${q(info.table)} WHERE ${q(pk[0])} IN (${migrated.map(() => '?').join(',')})`).all(...migrated.map((r) => r[pk[0]])) : []
    add(have.length === migrated.length, `${info.table}: ${migrated.length} row(s) present`, `found ${have.length}`)
    if (migrated.length) add(hashRows(have, pk) === hashRows(migrated, pk), `${info.table}: every migrated row is identical to its source (ids, references, values)`)
  }
  add(target.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'SQLite integrity_check is ok')
  add(target.prepare('PRAGMA foreign_key_check').all().length === 0, 'no foreign key violations')
  for (const l of LOGICAL_REFS) {
    if (!tableNames(target).includes(l.table) || !tableNames(target).includes(l.parent)) continue
    const parents = [l.parent, ...(l.alsoIn ?? [])].filter((p) => tableNames(target).includes(p))
    const col = q(l.column)
    const rows = target.prepare(`SELECT ${col} AS v FROM ${q(l.table)} WHERE ${col} IS NOT NULL`).all().filter((r) => !(l.skip && l.skip(r.v)))
    const bad = rows.filter((r) => !parents.some((p) => target.prepare(`SELECT 1 FROM ${q(p)} WHERE ${q(pkCols(target, p)[0])} = ? LIMIT 1`).get(r.v)))
    add(bad.length === 0, `${l.table}.${l.column} -> ${l.parent}: no orphans`, `${bad.length} orphan(s)`)
  }
  for (const t of ['user_roles', 'user_projects', 'auth_sessions', 'change_log', 'role_audit']) {
    if (tableNames(target).includes(t)) add(plan.tables.every((p) => p.table !== t), `${t} was not touched by this migration`)
  }
  return { ok: checks.every((c) => c.ok), checks }
}

const lit = (v) => {
  if (v === null) return 'NULL'
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Non-finite number'); return String(v) }
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
  throw new Error(`Unsupported value type: ${typeof v}`)
}

/** The SQL to run on the live database. Plain INSERTs only (a conflict stops the statement), no BEGIN/COMMIT (D1 does not accept them in files). */
export function emitSql(plan, { bumpVersions = true } = {}) {
  const out = [`-- Nexus data migration (staging -> production). Generated ${new Date().toISOString()}. INSERT only: nothing is replaced or updated except the module counters below.`, `-- Groups: ${plan.groups.join(', ') || '(none)'}${plan.include.length ? `; also: ${plan.include.join(', ')}` : ''}`]
  for (const info of plan.tables) {
    if (!info.insert.length) continue
    out.push(`\n-- ${info.table}: ${info.insert.length} row(s)`)
    const cols = Object.keys(info.insert[0])
    for (const row of info.insert) out.push(`INSERT INTO ${q(info.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});`)
  }
  if (bumpVersions) for (const mod of modulesOf(plan)) out.push(`\nUPDATE module_versions SET version = version + 1 WHERE module = '${mod}';`)
  return `${out.join('\n')}\n`
}

/** Deletes exactly the rows this migration inserted (children first). Only safe while nothing else has been written to them: otherwise restore the bookmark. */
export function emitRollbackSql(plan, { bumpVersions = true } = {}) {
  const out = ['-- ROLLBACK of the data migration: removes exactly the rows it inserted, children first. Use only if no other writes touched them; otherwise restore the Time Travel bookmark.']
  for (const info of [...plan.tables].reverse()) {
    if (!info.insert.length) continue
    const pkName = info.pk
    out.push(`DELETE FROM ${q(info.table)} WHERE ${q(pkName)} IN (${info.insert.map((r) => lit(r[pkName])).join(', ')});`)
  }
  if (bumpVersions) for (const mod of modulesOf(plan)) out.push(`UPDATE module_versions SET version = version - 1 WHERE module = '${mod}';`)
  return `${out.join('\n')}\n`
}

/** Read-only SQL to run on the live database afterwards, with the counts it must return. */
export function emitVerifySql(plan) {
  const lines = ['-- Verification: run on the live database after the migration and compare with expected-counts below.', 'PRAGMA foreign_key_check;']
  const expected = {}
  for (const info of plan.tables) {
    if (!info.insert.length && !info.skippedIdentical) continue
    lines.push(`SELECT '${info.table}' AS t, count(*) AS n FROM ${q(info.table)};`)
    expected[info.table] = { rowsMigrated: info.insert.length, skippedIdentical: info.skippedIdentical }
  }
  return { sql: `${lines.join('\n')}\n`, expected }
}

export function describe(plan) {
  const rows = plan.tables.map((t) => ({ table: t.table, group: t.group, action: t.action, source: t.sourceRows, migrate: t.insert.length, skippedIdentical: t.skippedIdentical, filteredOut: t.filteredOut, excludedByRequest: t.excludedByRequest, cascaded: t.cascaded, conflicts: t.conflicts.length }))
  return rows
}

/* ── command line ──────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const a = { groups: [], include: [], apply: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const next = () => argv[++i]
    if (k === '--source') a.source = next()
    else if (k === '--target') a.target = next()
    else if (k === '--groups') a.groups = next().split(',').filter(Boolean)
    else if (k === '--include') a.include = next().split(',').filter(Boolean)
    else if (k === '--exclude-rows') a.excludeRows = next()
    else if (k === '--apply') a.apply = true
    else if (k === '--dry-run') a.apply = false
    else if (k === '--emit-sql') a.emitSql = next()
    else if (k === '--emit-rollback') a.emitRollback = next()
    else if (k === '--emit-verify') a.emitVerify = next()
    else if (k === '--report') a.report = next()
    else if (k === '--no-bump-versions') a.noBump = true
    else throw new Error(`Unknown argument ${k}`)
  }
  return a
}

export async function main(argv) {
  const a = parseArgs(argv)
  if (!a.source || !a.target) throw new Error('Usage: node scripts/data-migration/migrate.mjs --source staging.sqlite --target production.sqlite --groups construction,materials [--include material_audit] [--exclude-rows rows.json] [--dry-run | --apply | --emit-sql out.sql [--emit-rollback r.sql] [--emit-verify v.sql]] [--report report.json]')
  const source = open(a.source, { readOnly: true })
  const targetFile = open(a.target, { readOnly: !a.apply })
  const excludeRows = a.excludeRows ? JSON.parse((await import('node:fs')).readFileSync(a.excludeRows, 'utf8')) : {}
  const opts = { groups: a.groups, include: a.include, excludeRows }
  const bump = !a.noBump
  // The plan is always built against the file as it is; the rehearsal runs on a copy.
  const plan = buildPlan(source, targetFile, opts)
  console.table(describe(plan))
  if (plan.problems.length) console.error(`\n${plan.problems.length} problem(s):\n  ${plan.problems.slice(0, 30).join('\n  ')}`)
  let result = null
  if (plan.ok) {
    const rehearsal = cloneInMemory(targetFile)
    applyPlan(rehearsal, plan, { bumpVersions: bump })
    result = verify(rehearsal, plan)
    for (const c of result.checks.filter((c) => !c.ok)) console.error(`FAIL  ${c.label} ${c.detail}`)
    console.log(`\nRehearsal on an in-memory copy of the target: ${result.ok ? `all ${result.checks.length} checks passed` : 'FAILED'}.`)
  }
  if (a.emitSql && plan.ok && result?.ok) {
    writeFileSync(a.emitSql, emitSql(plan, { bumpVersions: bump }))
    if (a.emitRollback) writeFileSync(a.emitRollback, emitRollbackSql(plan, { bumpVersions: bump }))
    if (a.emitVerify) { const v = emitVerifySql(plan); writeFileSync(a.emitVerify, v.sql); writeFileSync(`${a.emitVerify}.expected.json`, JSON.stringify(v.expected, null, 2)) }
    console.log(`Wrote ${a.emitSql}`)
  }
  if (a.apply && plan.ok && result?.ok) {
    applyPlan(targetFile, plan, { bumpVersions: bump })
    const real = verify(targetFile, plan)
    console.log(`Applied to ${a.target}: ${real.ok ? 'verified' : 'VERIFICATION FAILED'}.`)
    if (!real.ok) process.exitCode = 1
  } else if (a.apply) { console.error('Nothing was applied.'); process.exitCode = 1 }
  if (a.report) writeFileSync(a.report, JSON.stringify({ at: new Date().toISOString(), groups: a.groups, include: a.include, plan: describe(plan), problems: plan.problems, checks: result?.checks ?? [] }, null, 2))
  if (!plan.ok || (result && !result.ok)) process.exitCode = 1
  return { plan, result }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1) })
