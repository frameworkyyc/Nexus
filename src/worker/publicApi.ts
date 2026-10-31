import { HttpError, type Clock } from './service'
import { SNAPSHOT_KEY, type Snapshot, type SnapshotReader } from './snapshot'
import { MODULE_NAMES, type ModuleName } from '@/shared/registry'

/**
 * The public, view-only API (NEXUS_ENV = "public"). It has no database. Everything it can return is one sanitized snapshot document that the
 * editable side published to a private R2 bucket:
 *   - no sign-in, no roles, no cookies are read;
 *   - only GET (and HEAD) is answered, and only three routes exist: /api/health, /api/session and /api/state/<module>;
 *   - the only thing it can reach is the read side of the bucket (SnapshotReader has no put or delete), so there is nothing to write to and no
 *     staging record to read: the data was already restricted before it was published (publicView.ts, snapshot.ts).
 */
export interface PublicEnv { NEXUS_ENV?: string; PUBLIC_SNAPSHOT?: SnapshotReader; PUBLIC_INDEXABLE?: string }

/** Headers on every public response. Search engines are asked not to index it until that is deliberately switched on (PUBLIC_INDEXABLE=true). */
export function publicHeaders(env: PublicEnv): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(env.PUBLIC_INDEXABLE === 'true' ? {} : { 'x-robots-tag': 'noindex, nofollow, noarchive' }),
  }
}

const json = (env: PublicEnv, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...publicHeaders(env), ...headers } })

async function readSnapshot(env: PublicEnv): Promise<Snapshot> {
  if (!env.PUBLIC_SNAPSHOT) throw new HttpError(503, 'The data is not connected.', 'no-snapshot')
  const obj = await env.PUBLIC_SNAPSHOT.get(SNAPSHOT_KEY)
  if (!obj) throw new HttpError(503, 'The data has not been published yet.', 'no-snapshot')
  const snap = JSON.parse(await obj.text()) as Snapshot
  if (!snap || snap.format !== 1 || !snap.modules) throw new HttpError(503, 'The published data is not readable.', 'bad-snapshot')
  return snap
}

export async function handlePublicApi(request: Request, env: PublicEnv, clock: Clock): Promise<Response> {
  void clock
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(env, { error: 'This site is view only.', code: 'read-only' }, 405, { allow: 'GET, HEAD' })
    if (path === '/api/health') return json(env, { ok: true, environment: 'public', readOnly: true, database: !!env.PUBLIC_SNAPSHOT, access: true })
    const stateMatch = /^\/api\/state\/(\w+)$/.exec(path)
    if (path !== '/api/session' && !stateMatch) return json(env, { error: 'Not found.', code: 'not-found' }, 404)
    if (stateMatch && !MODULE_NAMES.includes(stateMatch[1] as ModuleName)) return json(env, { error: 'Unknown module.', code: 'not-found' }, 404)
    const snap = await readSnapshot(env)
    if (path === '/api/session') return json(env, { ok: true, user: 'Public visitor', role: 'viewer', permissions: ['view'], environment: 'public', readOnly: true, schemaVersion: snap.schemaVersion, versions: snap.versions, asOf: snap.generatedAt })
    const m = snap.modules[stateMatch![1] as ModuleName]
    return json(env, { version: m.version, state: m.state, asOf: snap.generatedAt })
  } catch (e) {
    if (e instanceof HttpError) return json(env, { error: e.message, code: e.code }, e.status)
    console.error('Public API error', e instanceof Error ? e.message : e)
    return json(env, { error: 'The data could not be loaded right now.', code: 'server-error' }, 500)
  }
}
