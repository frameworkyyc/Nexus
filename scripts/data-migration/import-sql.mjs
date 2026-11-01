// Loads a SQL file (for example the output of `wrangler d1 export`) into a NEW local SQLite file, so a migration can be planned and rehearsed on a copy.
// Usage: node scripts/data-migration/import-sql.mjs backups/staging.sql work/staging.sqlite
// Foreign keys are off while loading (an export lists tables in name order and relies on deferred checks); the file is refused if it already exists.
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export function importSql(sqlPath, outPath) {
  if (existsSync(outPath)) throw new Error(`${outPath} already exists: refusing to overwrite it.`)
  const db = new DatabaseSync(outPath, { enableForeignKeyConstraints: false })
  db.exec(readFileSync(sqlPath, 'utf8'))
  const violations = db.prepare('PRAGMA foreign_key_check').all().length
  const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n
  db.close()
  return { tables, foreignKeyViolations: violations }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , sql, out] = process.argv
  if (!sql || !out) { console.error('Usage: node scripts/data-migration/import-sql.mjs export.sql copy.sqlite'); process.exit(2) }
  try { const r = importSql(sql, out); console.log(`Loaded ${r.tables} table(s) into ${out}; foreign key violations: ${r.foreignKeyViolations}`) } catch (e) { console.error(e.message); process.exit(1) }
}
