// Assertions used by .github/workflows/production-release.yml around an additive schema migration. Each exits non-zero (and says why) on failure. Prints counts only, never row data.
//   precheck <wrangler-json> <schema> <ledger>   production is exactly at the schema and ledger the migration expects, and does not have the new table yet
//   verify <wrangler-json> <schema> <ledger>     after applying: new schema and ledger, and one anchorage group per typed plinth set
//   clean <wrangler-json>                         PRAGMA foreign_key_check returned nothing
import { readFileSync } from 'node:fs'

const [cmd, file, a, b] = process.argv.slice(2)
const fail = (m) => { console.error(`FAIL  ${m}`); process.exit(1) }
const ok = (m) => console.log(`PASS  ${m}`)
const text = readFileSync(file, 'utf8')
const i = text.indexOf('[')
if (i < 0) fail(`no JSON in ${file}`)
const blocks = JSON.parse(text.slice(i))
if (!Array.isArray(blocks) || blocks.some((r) => r.success === false)) fail('a statement did not succeed')
const rows = blocks.flatMap((r) => r.results ?? [])

if (cmd === 'precheck') {
  const r = rows[0]
  if (!r) fail('no result')
  if (String(r.schema_version) !== a) fail(`production schema is ${r.schema_version}, expected ${a}`)
  if (r.ledger !== Number(b)) fail(`production has ${r.ledger} ledger rows, expected ${b}`)
  if (r.has_table !== 0) fail('foundation_anchorages already exists: the migration looks already applied')
  ok(`production is at schema ${a} with ${b} migrations, the new table is absent, ${r.typed_sets} typed plinth sets to map`)
} else if (cmd === 'verify') {
  const r = rows[0]
  if (!r) fail('no result')
  if (String(r.schema_version) !== a) fail(`schema is ${r.schema_version}, expected ${a}`)
  if (r.ledger !== Number(b)) fail(`ledger has ${r.ledger} rows, expected ${b}`)
  if (r.anchorages !== r.typed_sets) fail(`${r.anchorages} anchorage groups for ${r.typed_sets} typed plinth sets`)
  ok(`schema ${a}, ${b} migrations, ${r.anchorages} anchorage groups = ${r.typed_sets} typed plinth sets`)
} else if (cmd === 'clean') {
  if (rows.length) fail(`${rows.length} foreign-key violation(s) in ${[...new Set(rows.map((x) => x.table))].join(', ')}`)
  ok('foreign_key_check is empty')
} else {
  console.error('Usage: schema-guard.mjs precheck|verify|clean ...'); process.exit(2)
}
