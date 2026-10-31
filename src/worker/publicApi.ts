import type { D1, D1Statement } from './db'
import { loadRows } from './db'
import { MODULES } from './modules'
import { redactRows, stripEmails } from './publicView'
import { HttpError, versions, type Clock } from './service'
import { MODULE_NAMES, type ModuleName } from '@/shared/registry'

/**
 * The public, view-only API (NEXUS_ENV = "public"). It is deliberately separate from the authenticated API and shares none of its code paths:
 *   - no sign-in, no roles, no cookies are read: everything it returns is already restricted to what may be public;
 *   - only GET (and HEAD) is answered, and only three routes exist: /api/health, /api/session and /api/state/<module>;
 *   - the database it is given can only run SELECT statements (see readOnlyDb), so even a coding mistake cannot write;
 *   - every row passes through the public policy (publicView.ts) before it becomes application state.
 */
export interface PublicEnv { DB?: D1; NEXUS_ENV?: string }

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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } })

export async function handlePublicApi(request: Request, env: PublicEnv, clock: Clock): Promise<Response> {
  void clock
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'This site is view only.', code: 'read-only' }, 405, { allow: 'GET, HEAD' })
    if (path === '/api/health') return json({ ok: true, environment: 'public', readOnly: true, database: !!env.DB, access: true })
    const stateMatch = /^\/api\/state\/(\w+)$/.exec(path)
    if (path !== '/api/session' && !stateMatch) return json({ error: 'Not found.', code: 'not-found' }, 404)
    if (!env.DB) throw new HttpError(503, 'The data is not connected.', 'no-database')
    const db = readOnlyDb(env.DB)
    if (path === '/api/session') {
      const v = await db.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").first<{ value: string }>()
      return json({ ok: true, user: 'Public visitor', role: 'viewer', permissions: ['view'], environment: 'public', readOnly: true, schemaVersion: v?.value ?? 'unknown', versions: await versions(db) })
    }
    const module = stateMatch![1] as ModuleName
    if (!MODULE_NAMES.includes(module)) throw new HttpError(404, 'Unknown module.', 'not-found')
    const spec = MODULES[module]
    const [rows, v] = await Promise.all([loadRows(db, spec.tables), db.prepare('SELECT version FROM module_versions WHERE module = ?').bind(module).first<{ version: number }>()])
    return json({ version: Number(v?.version ?? 0), state: stripEmails(spec.fromRows(redactRows(rows))) })
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status)
    console.error('Public API error', e instanceof Error ? e.message : e)
    return json({ error: 'The data could not be loaded right now.', code: 'server-error' }, 500)
  }
}
