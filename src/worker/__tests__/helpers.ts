import { handleApi, type Env } from '../api'
import type { Clock } from '../service'
import { createTestDb, type TestDb } from './sqliteD1'

export const NOW = new Date('2026-10-21T15:00:00Z')
export const clock = (d: Date = NOW): Clock => ({ now: () => d })
export const TODAY = '2026-10-21'

export interface Session { env: Env; db: TestDb; call: (method: string, path: string, body?: unknown, init?: RequestInit) => Promise<{ status: number; body: any }> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A signed-in browser session talking to the API, backed by the given database. Several sessions can share one database. */
export function session(db: TestDb = createTestDb(), extra: Partial<Env> = {}): Session {
  const env: Env = { DB: db.d1, DEV_BYPASS_AUTH: 'true', NEXUS_ENV: 'test', ...extra }
  const call: Session['call'] = async (method, path, body, init) => {
    const res = await handleApi(new Request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } }), env, clock())
    return { status: res.status, body: await res.json() }
  }
  return { env, db, call }
}

let n = 0
export const rid = () => `req-${Date.now().toString(36)}-${(n++).toString(36)}-xxxx`

/** Sends a command the way the browser does. */
export const command = (s: Session, module: string, name: string, args: unknown[], requestId = rid()) =>
  s.call('POST', '/api/commands', { module, name, args, requestId, clientToday: TODAY })
