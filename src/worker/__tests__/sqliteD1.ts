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

export function createTestDb(opts: { migrate?: boolean } = {}): TestDb {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  if (opts.migrate !== false) for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
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

export const applyMigrationFile = (raw: DatabaseSync, name: string) => raw.exec(readFileSync(`migrations/${name}`, 'utf8'))
