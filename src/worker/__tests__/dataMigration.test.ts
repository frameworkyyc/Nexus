import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { applyPlan, buildPlan, emitRollbackSql, emitSql, emitVerifySql, selectTables, verify } from '../../../scripts/data-migration/migrate.mjs'
import { importSql } from '../../../scripts/data-migration/import-sql.mjs'
import { TABLES } from '../../../scripts/data-migration/plan.mjs'
import { checkIntegrity, readModule } from '../service'
import { createTestDb, type TestDb } from './sqliteD1'

const names = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
const snapshot = (db: DatabaseSync) => Object.fromEntries(names(db).map((t) => [t, createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())).digest('hex')]))
const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n
const AUTH = ['user_roles', 'user_projects', 'role_audit', 'auth_sessions', 'change_log']

/** A staging-like source (the REEF fixture plus a foundation chain, materials, procurement and the records that must NOT travel) and an empty production-like target. */
function world(): { source: TestDb; target: TestDb } {
  const source = createTestDb({ seed: true, projectAccess: 'explicit' })
  const target = createTestDb({ seed: false, projectAccess: 'explicit' })
  const raw = source.raw
  const project = (raw.prepare('SELECT id FROM projects').get() as { id: string }).id
  const area = (raw.prepare('SELECT id FROM areas ORDER BY sequence').get() as { id: string }).id
  const area2 = (raw.prepare('SELECT id FROM areas ORDER BY sequence LIMIT 1 OFFSET 1').get() as { id: string }).id
  raw.exec(`
    INSERT INTO anchorage_types (id, project_id, code, seq) VALUES ('at1', '${project}', 'A1', 1);
    INSERT INTO foundations (id, area_id, number, seq) VALUES ('f1', '${area}', 'F-1', 1), ('f2', '${area2}', 'F-2', 2);
    INSERT INTO foundation_anchorage_groups (id, foundation_id, anchorage_type_id, plinth_count, seq) VALUES ('g1', 'f1', 'at1', 1, 1);
    INSERT INTO plinths (id, foundation_id, idx, seq, anchorage_type_id, group_id) VALUES ('p1', 'f1', 1, 1, 'at1', 'g1'), ('p2', 'f2', 1, 2, NULL, NULL);
    INSERT INTO activities (id, scope, activity_key, foundation_id, plinth_id, status, seq) VALUES ('f1:formed', 'footing', 'formed', 'f1', NULL, 'complete', 1), ('f2:formed', 'footing', 'formed', 'f2', NULL, 'complete', 2);
    INSERT INTO manual_materials (id, area, category, name, required_qty, seq, area_id, anchorage_type_id) VALUES ('mm1', 'Area', 'bolt', 'Anchor bolt', 10, 1, '${area}', 'at1');
    INSERT INTO purchase_orders (id, po_number, order_date, seq) VALUES ('po1', 'PO-1', '2026-10-01', 1), ('po2', '', '2026-10-02', 2);
    INSERT INTO purchase_order_lines (id, order_id, group_key, area_id, qty, seq) VALUES ('pol1', 'po1', 'k1', '${area}', 5, 1), ('pol2', 'po2', 'k2', '${area}', 3, 2);
    INSERT INTO procurement_deliveries (id, order_id, delivery_date, seq) VALUES ('d1', 'po1', '2026-10-05', 1), ('d2', 'po2', '2026-10-06', 2);
    INSERT INTO procurement_delivery_lines (id, delivery_id, order_line_id, group_key, area_id, qty, seq) VALUES ('dl1', 'd1', 'pol1', 'k1', '${area}', 5, 1), ('dl2', 'd2', 'pol2', 'k2', '${area}', 3, 2);
    INSERT INTO material_audit (id, at, actor, action, material_id, summary, seq) VALUES ('ma1', '2026-10-01', 'someone@example.com', 'created', 'mm1', 'created', 1);
    INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES ('tester@example.com', 'editor', 'test', '2026-10-01');
    INSERT INTO user_projects (email, project_id, assigned_by, assigned_at) VALUES ('tester@example.com', '${project}', 'test', '2026-10-01');
    INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES ('2026-10-01', 'test', 'tester@example.com', NULL, 'editor');
    INSERT INTO auth_sessions (id, email, workos_user_id, workos_session_id, created_at, last_seen_at, expires_at) VALUES ('s1', 'tester@example.com', 'u1', 'w1', '2026-10-01', '2026-10-01', '2026-10-02');
    INSERT INTO change_log (request_id, module, command, args_json, actor, created_at, result_version) VALUES ('req-1', 'construction', 'x', '[]', 'tester@example.com', '2026-10-01', 1);
  `)
  return { source, target }
}
const G = ['construction', 'materials']

describe('table classification', () => {
  it('every table the migrations create is classified (a new table must be reviewed before data can move)', () => {
    const { source } = world()
    expect(names(source.raw).filter((t) => !TABLES[t])).toEqual([])
  })

  it('authentication, sessions, membership, history and bookkeeping are excluded and can never be selected', () => {
    for (const t of [...AUTH, 'module_versions', 'schema_info', 'd1_migrations', 'write_guard']) expect(TABLES[t].action, t).toBe('exclude')
    const { source, target } = world()
    for (const t of AUTH) expect(() => selectTables(source.raw, target.raw, { groups: G, include: [t] }), t).toThrow(/excluded/)
  })

  it('an unclassified table stops the migration', () => {
    const { source, target } = world()
    source.raw.exec('CREATE TABLE zz_new_table (id TEXT PRIMARY KEY)')
    expect(() => buildPlan(source.raw, target.raw, { groups: G })).toThrow(/not classified/)
  })

  it('unknown groups and tables are refused; fleet and material history move only when asked for', () => {
    const { source, target } = world()
    expect(() => buildPlan(source.raw, target.raw, { groups: ['nonsense'] })).toThrow(/Unknown group/)
    const plan = buildPlan(source.raw, target.raw, { groups: G })
    const moved = plan.tables.map((t) => t.table)
    expect(moved).not.toContain('vehicles')
    expect(moved).not.toContain('material_audit')
    expect(buildPlan(source.raw, target.raw, { groups: [...G, 'fleet'], include: ['material_audit'] }).tables.map((t) => t.table)).toEqual(expect.arrayContaining(['vehicles', 'inspections', 'material_audit']))
  })
})

describe('dry run', () => {
  it('builds and validates the plan and changes nothing', () => {
    const { source, target } = world()
    const before = snapshot(target.raw)
    const plan = buildPlan(source.raw, target.raw, { groups: G })
    expect(plan.ok).toBe(true)
    expect(plan.tables.find((t) => t.table === 'foundations')?.insert).toHaveLength(2)
    expect(snapshot(target.raw)).toEqual(before)
  })
})

describe('apply', () => {
  it('copies every selected row exactly (ids, references, values), keeps production configuration, and never touches authentication or history', async () => {
    const { source, target } = world()
    const plan = buildPlan(source.raw, target.raw, { groups: G })
    applyPlan(target.raw, plan)
    const result = verify(target.raw, plan)
    expect(result.checks.filter((c) => !c.ok)).toEqual([])
    for (const t of ['companies', 'projects', 'areas', 'foundations', 'plinths', 'activities', 'manual_materials', 'purchase_orders', 'purchase_order_lines', 'procurement_deliveries', 'procurement_delivery_lines']) expect(count(target.raw, t), t).toBe(count(source.raw, t))
    for (const t of AUTH) expect(count(target.raw, t), t).toBe(0)
    expect(count(target.raw, 'suppliers')).toBe(1) // production's own row, left alone
    expect(count(target.raw, 'vehicles')).toBe(0) // fleet was not selected
    expect(count(target.raw, 'material_audit')).toBe(0) // review table, not asked for
    expect(target.raw.prepare("SELECT version FROM module_versions WHERE module = 'construction'").get()).toEqual({ version: 1 })
    expect(target.raw.prepare("SELECT version FROM module_versions WHERE module = 'fleet'").get()).toEqual({ version: 0 })
    // the application itself reads the migrated copy as it reads the source
    expect((await checkIntegrity(target.d1)).ok).toBe(true)
    expect((await readModule(target.d1, 'construction')).state).toEqual((await readModule(source.d1, 'construction')).state)
    // The materials history (material_audit) is a review table and was not asked for, so everything except the history reads the same.
    const { history: sourceHistory, ...sourceMaterials } = (await readModule(source.d1, 'materials')).state
    const { history: targetHistory, ...targetMaterials } = (await readModule(target.d1, 'materials')).state
    expect(targetMaterials).toEqual(sourceMaterials)
    expect(sourceHistory.length).toBeGreaterThan(0)
    expect(targetHistory).toEqual([])
  })

  it('demonstration inspections are never copied, and fleet follows only when selected', () => {
    const { source, target } = world()
    source.raw.exec('UPDATE inspections SET demo = 0; UPDATE inspections SET demo = 1 WHERE rowid = 1') // the fixture marks its inspections as demonstration records
    const demo = count(source.raw, 'inspections')
    const plan = buildPlan(source.raw, target.raw, { groups: [...G, 'fleet'] })
    expect(plan.tables.find((t) => t.table === 'inspections')?.insert).toHaveLength(demo - 1)
    applyPlan(target.raw, plan)
    expect(count(target.raw, 'inspections')).toBe(demo - 1)
    expect(verify(target.raw, plan).ok).toBe(true)
  })

  it('a record that already exists in production is a conflict: nothing is written and nothing is overwritten', () => {
    const { source, target } = world()
    const project = source.raw.prepare('SELECT * FROM projects').get() as Record<string, string>
    target.raw.exec(`INSERT INTO companies (id, name) VALUES ('${project.company_id}', 'Production company'); INSERT INTO projects (id, company_id, name, job_number, status) VALUES ('${project.id}', '${project.company_id}', 'Existing production project', 'P-1', 'active')`)
    const before = snapshot(target.raw)
    const plan = buildPlan(source.raw, target.raw, { groups: G })
    expect(plan.ok).toBe(false)
    expect(plan.problems.join('\n')).toMatch(/projects: primary key .* already exists/)
    expect(() => applyPlan(target.raw, plan)).toThrow(/Refusing/)
    expect(snapshot(target.raw)).toEqual(before)
    expect(target.raw.prepare('SELECT name FROM projects').get()).toEqual({ name: 'Existing production project' })
  })

  it('a unique-key clash with an existing production row is a conflict even under a different id', () => {
    const { source, target } = world()
    const a = source.raw.prepare('SELECT * FROM areas ORDER BY sequence').get() as Record<string, string>
    target.raw.exec(`INSERT INTO companies (id, name) VALUES ('c-x', 'X'); INSERT INTO projects (id, company_id, name, job_number, status) VALUES ('${a.project_id}', 'c-x', 'P', 'J', 'active'); INSERT INTO areas (id, project_id, name, sequence) VALUES ('other-id', '${a.project_id}', '${a.name}', 99)`)
    const plan = buildPlan(source.raw, target.raw, { groups: ['construction'] })
    expect(plan.problems.join('\n')).toMatch(/unique key \(project_id, name\)/)
  })

  it('a different supplier row under the same id is a conflict; an identical one is left alone', () => {
    const { source, target } = world()
    expect(buildPlan(source.raw, target.raw, { groups: G }).tables.find((t) => t.table === 'suppliers')?.skippedIdentical).toBe(1)
    target.raw.exec("UPDATE suppliers SET name = 'Someone else', name_key = 'someone else'")
    expect(buildPlan(source.raw, target.raw, { groups: G }).problems.join('\n')).toMatch(/suppliers: primary key .* with different values/)
  })

  it('running it twice is refused rather than duplicated', () => {
    const { source, target } = world()
    applyPlan(target.raw, buildPlan(source.raw, target.raw, { groups: G }))
    const again = buildPlan(source.raw, target.raw, { groups: G })
    expect(again.ok).toBe(false)
    expect(again.problems.length).toBeGreaterThan(10)
  })

  it('excluding a record excludes everything that depends on it, and the rest still validates', () => {
    const { source, target } = world()
    const plan = buildPlan(source.raw, target.raw, { groups: G, excludeRows: { purchase_orders: ['po2'] } })
    const rows = (t: string) => plan.tables.find((x) => x.table === t)?.insert.map((r) => r.id)
    expect(rows('purchase_orders')).toEqual(['po1'])
    expect(rows('purchase_order_lines')).toEqual(['pol1'])
    expect(rows('procurement_deliveries')).toEqual(['d1'])
    expect(rows('procurement_delivery_lines')).toEqual(['dl1'])
    applyPlan(target.raw, plan)
    expect(verify(target.raw, plan).ok).toBe(true)
  })

  it('excluding an area excludes its foundations, plinths and activities (and the references to them)', () => {
    const { source, target } = world()
    const area2 = (source.raw.prepare('SELECT area_id FROM foundations WHERE id = ?').get('f2') as { area_id: string }).area_id
    const plan = buildPlan(source.raw, target.raw, { groups: G, excludeRows: { areas: [area2] } })
    expect(plan.tables.find((t) => t.table === 'foundations')?.insert.map((r) => r.id)).toEqual(['f1'])
    expect(plan.tables.find((t) => t.table === 'plinths')?.insert.map((r) => r.id)).toEqual(['p1'])
    expect(plan.tables.find((t) => t.table === 'activities')?.insert.map((r) => r.id)).toEqual(['f1:formed'])
    applyPlan(target.raw, plan)
    expect(verify(target.raw, plan).ok).toBe(true)
  })
})

describe('the SQL for the live database', () => {
  it('reproduces the apply exactly, is INSERT-only, and its rollback restores the original', () => {
    const { source, target } = world()
    const twin = createTestDb({ seed: false, projectAccess: 'explicit' })
    const original = snapshot(target.raw)
    const plan = buildPlan(source.raw, target.raw, { groups: G })
    const sql = emitSql(plan)
    expect(sql).not.toMatch(/\b(UPDATE (?!module_versions)|DELETE|REPLACE|DROP|ALTER)\b/i)
    expect(sql).not.toMatch(/INSERT OR/i)
    expect(sql).not.toMatch(/\b(user_roles|auth_sessions|change_log|role_audit|user_projects)\b/)
    applyPlan(target.raw, plan)
    twin.raw.exec('PRAGMA foreign_keys = ON')
    twin.raw.exec(sql)
    expect(snapshot(twin.raw)).toEqual(snapshot(target.raw))
    twin.raw.exec(emitRollbackSql(plan))
    expect(snapshot(twin.raw)).toEqual(original)
    const v = emitVerifySql(plan)
    expect(v.sql).toMatch(/PRAGMA foreign_key_check/)
    expect(v.expected.foundations).toEqual({ rowsMigrated: 2, skippedIdentical: 0 })
  })

  it('escapes text safely (quotes, newlines, unicode)', () => {
    const { source, target } = world()
    source.raw.prepare('UPDATE foundations SET description = ? WHERE id = ?').run("O'Brien's \"pad\"\nline two — ünï", 'f1')
    const twin = createTestDb({ seed: false, projectAccess: 'explicit' })
    twin.raw.exec(emitSql(buildPlan(source.raw, target.raw, { groups: G })))
    expect(twin.raw.prepare('SELECT description FROM foundations WHERE id = ?').get('f1')).toEqual({ description: "O'Brien's \"pad\"\nline two — ünï" })
  })
})

describe('loading an export into a local copy', () => {
  it('loads a D1-style export (deferred foreign keys, positional INSERTs, children listed before parents) and refuses to overwrite a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-import-'))
    try {
      const sql = join(dir, 'export.sql')
      writeFileSync(sql, [
        'PRAGMA defer_foreign_keys=TRUE;',
        'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent (id));',
        'CREATE TABLE parent (id TEXT PRIMARY KEY, name TEXT NOT NULL);',
        "INSERT INTO \"child\" VALUES('c1','p1');",
        "INSERT INTO \"parent\" VALUES('p1','O''Brien');",
      ].join('\n'))
      const out = join(dir, 'copy.sqlite')
      expect(importSql(sql, out)).toEqual({ tables: 2, foreignKeyViolations: 0 })
      expect(() => importSql(sql, out)).toThrow(/refusing to overwrite/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
