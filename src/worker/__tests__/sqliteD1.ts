import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { D1, D1Statement } from '../db'

/** A D1-compatible wrapper over node:sqlite, so tests run the real migration SQL and the real write path. */
type Param = null | number | string
class Stmt implements D1Statement {
  constructor(private db: DatabaseSync, public sql: string, public args: Param[] = []) {}
  bind(...values: unknown[]) { return new Stmt(this.db, this.sql, values as Param[]) }
  async all<T>() { return { results: this.rows() as T[] } }
  async first<T>() { return (this.rows()[0] as T | undefined) ?? null }
  async run() { this.db.prepare(this.sql).run(...this.args); return {} }
  rows() { return this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }
  exec() { return /^\s*(select|pragma|with)/i.test(this.sql) ? this.rows() : (this.db.prepare(this.sql).run(...this.args), []) }
}

export interface TestDb { d1: D1; raw: DatabaseSync; failNextBatch: (message: string) => void }

/**
 * An in-memory database with the real migrations applied. By default the REEF reference fixture (seeds/reef) is added on top so tests have a
 * project and fleet to work with; pass `{ seed: false }` for the genuinely empty database a new installation starts with.
 */
export function createTestDb(opts: { migrate?: boolean; seed?: boolean; projectAccess?: 'all' | 'explicit' } = {}): TestDb {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  if (opts.migrate !== false) for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
  if (opts.migrate !== false && opts.seed !== false) applySeeds(raw)
  // Most tests are about something other than project access, so by default every non-administrator may see every project (what they could
  // see before project assignments existed). `projectAccess: 'explicit'` leaves assignments exactly as the test makes them.
  if (opts.migrate !== false && opts.projectAccess !== 'explicit') {
    raw.exec(`CREATE TRIGGER test_assign_new_project AFTER INSERT ON projects BEGIN
      INSERT OR IGNORE INTO user_projects (email, project_id, assigned_by, assigned_at) SELECT email, NEW.id, 'test', '' FROM user_roles WHERE role <> 'admin'; END;
      CREATE TRIGGER test_assign_new_member AFTER INSERT ON user_roles WHEN NEW.role <> 'admin' BEGIN
      INSERT OR IGNORE INTO user_projects (email, project_id, assigned_by, assigned_at) SELECT NEW.email, id, 'test', '' FROM projects; END;`)
  }
  let failure: string | null = null
  const d1: D1 = {
    prepare: (sql) => new Stmt(raw, sql),
    async batch(statements) {
      // Reads (plain SELECT batches) never fail; the injected failure hits the next batch that writes.
      if (failure && (statements as Stmt[]).some((x) => !/^\s*(select|pragma|with)/i.test(x.sql))) { const m = failure; failure = null; throw new Error(m) }
      raw.exec('BEGIN')
      try {
        const out = (statements as Stmt[]).map((s) => ({ results: s.exec() as Record<string, unknown>[] }))
        raw.exec('COMMIT')
        return out
      } catch (e) {
        raw.exec('ROLLBACK')
        throw e
      }
    },
  }
  return { d1, raw, failNextBatch: (m) => { failure = m } }
}

export const applySeeds = (raw: DatabaseSync) => { for (const f of readdirSync('seeds/reef').filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(`seeds/reef/${f}`, 'utf8')) }
export const applyMigrationFile = (raw: DatabaseSync, name: string) => raw.exec(readFileSync(`migrations/${name}`, 'utf8'))
