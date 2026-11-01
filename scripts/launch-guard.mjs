// Assertions used by .github/workflows/production-launch.yml. Each command exits non-zero (and says why) when a safeguard fails. It prints counts only, never row data.
//   report <report.json> <expectedRows>   the migration dry run: no problems, exactly the approved number of rows, nothing excluded, filtered, cascaded or in conflict
//   counts <db.sqlite> <expected.json>    row counts of every table the migration touches (the rehearsal copy is the reference for the live database)
//   prestate <wrangler-json>              production holds no project data, members, change log or module counters yet
//   compare <wrangler-json> <counts.json> the live verification (foreign_key_check + counts) equals the rehearsal
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [cmd, a, b] = process.argv.slice(2)
const fail = (m) => { console.error(`FAIL  ${m}`); process.exit(1) }
const ok = (m) => console.log(`PASS  ${m}`)
const wrangler = (file) => {
  const text = readFileSync(file, 'utf8')
  const i = text.indexOf('[')
  if (i < 0) fail(`no JSON in ${file}`)
  const out = JSON.parse(text.slice(i))
  if (!Array.isArray(out) || out.some((r) => r.success === false)) fail('a statement did not succeed')
  return out
}

if (cmd === 'report') {
  const r = JSON.parse(readFileSync(a, 'utf8'))
  const expected = Number(b)
  if (r.problems.length) fail(`dry run reported ${r.problems.length} problem(s)`)
  if (r.checks.some((c) => !c.ok)) fail(`${r.checks.filter((c) => !c.ok).length} dry-run check(s) failed`)
  const rows = r.plan.reduce((s, t) => s + t.migrate, 0)
  if (rows !== expected) fail(`the plan inserts ${rows} rows; the approved plan is ${expected}. Staging changed or the plan differs: stop and ask`)
  const odd = r.plan.filter((t) => t.filteredOut || t.excludedByRequest || t.cascaded || t.conflicts)
  if (odd.length) fail(`unexpected exclusions or conflicts in: ${odd.map((t) => t.table).join(', ')}`)
  ok(`dry run clean: ${rows} rows in ${r.plan.filter((t) => t.migrate).length} tables, ${r.checks.length} checks`)
} else if (cmd === 'counts') {
  const expected = JSON.parse(readFileSync(b, 'utf8'))
  const db = new DatabaseSync(a, { readOnly: true })
  const counts = Object.fromEntries(Object.keys(expected).map((t) => [t, db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n]))
  console.log(JSON.stringify(counts))
} else if (cmd === 'prestate') {
  const row = wrangler(a)[0]?.results?.[0]
  if (!row) fail('no result')
  const dirty = Object.entries(row).filter(([k, v]) => k !== 'ledger' && v !== 0)
  if (dirty.length) fail(`production is not in its empty state: ${dirty.map(([k, v]) => `${k}=${v}`).join(', ')}`)
  if (row.ledger !== 27) fail(`production has ${row.ledger} migrations, expected 27`)
  ok('production is in its verified empty state (27 migrations, no project data, members, change log or counters)')
} else if (cmd === 'compare') {
  const results = wrangler(a)
  const want = JSON.parse(readFileSync(b, 'utf8'))
  const fk = results[0]?.results ?? []
  if (fk.length) fail(`${fk.length} foreign-key violation(s) in production`)
  const got = Object.fromEntries(results.slice(1).map((r) => [r.results?.[0]?.t, r.results?.[0]?.n]))
  const bad = Object.keys(want).filter((t) => got[t] !== want[t])
  if (bad.length) fail(`count mismatch in ${bad.map((t) => `${t} (live ${got[t]}, expected ${want[t]})`).join(', ')}`)
  ok(`production matches the rehearsal in all ${Object.keys(want).length} tables; foreign_key_check is empty`)
} else {
  console.error('Usage: launch-guard.mjs report|counts|prestate|compare ...'); process.exit(2)
}
