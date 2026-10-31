import type { D1, D1Statement } from './db'
import { HttpError } from './service'

/** Wraps a D1 binding so that only a single SELECT statement can be prepared. There is no run(), exec() or dump(). */
export function readOnlyDb(db: D1): D1 {
  const guard = (sql: string): string => {
    const s = String(sql).trim()
    if (!/^select\b/i.test(s) || /;\s*\S/.test(s)) throw new HttpError(403, 'The public site is read-only.', 'read-only')
    return s
  }
  // Statements that passed the guard, by their wrapper. batch() accepts nothing else, so it cannot be handed a statement that was prepared elsewhere.
  const inner = new WeakMap<D1Statement, D1Statement>()
  const wrap = (stmt: D1Statement): D1Statement => {
    const w: D1Statement = {
      bind: (...v: unknown[]) => wrap(stmt.bind(...v)),
      all: <T = Record<string, unknown>>() => stmt.all<T>(),
      first: <T = Record<string, unknown>>() => stmt.first<T>(),
      run: () => Promise.reject(new HttpError(403, 'The public site is read-only.', 'read-only')),
    }
    inner.set(w, stmt)
    return w
  }
  return {
    prepare: (sql: string) => wrap(db.prepare(guard(sql))),
    batch: (statements: D1Statement[]) => db.batch(statements.map((x) => { const i = inner.get(x); if (!i) throw new HttpError(403, 'The public site is read-only.', 'read-only'); return i })),
  }
}
