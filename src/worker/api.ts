import { authenticate, AuthError, type AuthEnv } from './auth'
import { handlePublicApi, type PublicEnv } from './publicApi'
import { publishAfterChange, type SnapshotWriter } from './snapshot'
import type { D1 } from './db'
import { applyMigration, previewMigration, type MigrationBundle } from './migrate'
import { checkIntegrity, createBackup, HttpError, readModule, runCommand, systemClock, versions, type Clock } from './service'
import { listRoles, requirePermission, resolveActor, setRole, type RoleEnv } from './roles'
import { ROLE_PERMISSIONS } from '@/shared/rbac'
import { MODULE_NAMES, type ModuleName } from '@/shared/registry'

export interface Env extends AuthEnv, RoleEnv, PublicEnv {
  DB?: D1
  /** Staging only: the private bucket the sanitized public snapshot is written to after each change. Absent = nothing is published. */
  PUBLIC_SNAPSHOT?: SnapshotWriter & PublicEnv['PUBLIC_SNAPSHOT']
  NEXUS_ENV?: string // "demo" (public, API off) | "public" (public, view only) | "staging" | "production"
}

const MAX_BODY = 4_000_000

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'The request is too large.', 'too-large')
  try { return JSON.parse(text) } catch { throw new HttpError(400, 'The request body is not valid JSON.', 'bad-request') }
}

/**
 * Nexus API. `/api/health` is public and reveals only whether the backend is configured. Everything else needs a verified
 * Cloudflare Access identity. Same-origin only: no CORS headers are ever sent.
 */
export async function handleApi(request: Request, env: Env, clock: Clock = systemClock, fetcher: typeof fetch = fetch, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')
  try {
    // The public demo deployment has no saved data at all: the API is switched off before authentication, bindings or the database
    // are even considered, so nothing a visitor sends can reach a record.
    if (env.NEXUS_ENV === 'demo') return json({ error: 'This is the public demo. It has no server API; sample data stays in your browser.', code: 'demo' }, 404)
    // The public view-only site has its own small API: it never reaches authentication, roles or any write path.
    if (env.NEXUS_ENV === 'public') return handlePublicApi(request, env, clock)
    if (path === '/api/health') {
      return json({ ok: true, environment: env.NEXUS_ENV ?? 'unknown', database: !!env.DB, access: !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) || env.DEV_BYPASS_AUTH === 'true' })
    }
    if (!path.startsWith('/api/')) return json({ error: 'Not found.' }, 404)
    const who = await authenticate(request, env, fetcher, clock.now().getTime())
    // State-changing requests must come from this site, not from a page on another origin that rides the user's session.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('origin')
      if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin requests are not allowed.', 'cross-origin')
    }
    if (!env.DB) throw new HttpError(503, 'The database is not connected.', 'no-database')
    const db = env.DB
    // Who the verified identity is *allowed* to be, from the server's own records. Nothing in the request chooses the role.
    const actor = await resolveActor(db, env, who, clock.now())

    if (path === '/api/session' && request.method === 'GET') {
      const info = await db.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").first<{ value: string }>()
      return json({ ok: true, user: who.email, role: actor.role, permissions: actor.role ? ROLE_PERMISSIONS[actor.role] : [], environment: env.NEXUS_ENV ?? 'unknown', schemaVersion: info?.value ?? 'unknown', versions: await versions(db), serverDate: clock.now().toISOString().slice(0, 10) })
    }
    if (path === '/api/roles' && request.method === 'GET') { requirePermission(actor, 'access.manage'); return json({ roles: await listRoles(db) }) }
    if (path === '/api/roles' && request.method === 'POST') {
      const body = (await readJson(request)) as { email?: unknown; role?: unknown }
      return json({ roles: await setRole(db, actor, body.email, body.role ?? null, clock.now()) })
    }
    const stateMatch = /^\/api\/state\/(\w+)$/.exec(path)
    if (stateMatch && request.method === 'GET') {
      const module = stateMatch[1] as ModuleName
      requirePermission(actor, 'view')
      if (!MODULE_NAMES.includes(module)) throw new HttpError(404, 'Unknown module.', 'not-found')
      const snap = await readModule(db, module)
      return json({ version: snap.version, state: snap.state })
    }
    if (path === '/api/commands' && request.method === 'POST') {
      const body = (await readJson(request)) as Record<string, unknown>
      const result = await runCommand(db, body as never, actor, clock)
      // Refresh the public snapshot in the background; a failure there never affects this change (the scheduled publisher catches up).
      const refresh = publishAfterChange(env, clock)
      if (waitUntil) waitUntil(refresh); else await refresh
      return json(result)
    }
    if (path === '/api/backup' && request.method === 'GET') {
      requirePermission(actor, 'access.manage')
      const backup = await createBackup(db, clock)
      const stamp = backup.createdAt.replace(/[:.]/g, '-')
      return json(backup, 200, { 'content-disposition': `attachment; filename="nexus-backup-${env.NEXUS_ENV ?? 'data'}-${stamp}.json"` })
    }
    if (path === '/api/integrity' && request.method === 'GET') { requirePermission(actor, 'access.manage'); return json(await checkIntegrity(db)) }
    if (path === '/api/migrate/preview' && request.method === 'POST') {
      requirePermission(actor, 'access.manage')
      const body = (await readJson(request)) as { bundle?: MigrationBundle }
      return json({ report: await previewMigration(db, body.bundle as MigrationBundle) })
    }
    if (path === '/api/migrate/apply' && request.method === 'POST') {
      requirePermission(actor, 'access.manage')
      const applied = await applyMigration(db, (await readJson(request)) as never, actor.email, clock)
      const refresh = publishAfterChange(env, clock)
      if (waitUntil) waitUntil(refresh); else await refresh
      return json(applied)
    }
    throw new HttpError(404, 'Not found.', 'not-found')
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status)
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status)
    console.error('Unhandled API error', e instanceof Error ? e.message : e)
    return json({ error: 'The server could not complete the request. Nothing was changed unless a confirmation was shown.', code: 'server-error' }, 500)
  }
}
