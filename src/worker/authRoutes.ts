import { AuthError, authenticate, isLocal, type AuthEnv, type Identity } from './auth'
import type { D1 } from './db'
import { normalizeEmail } from './roles'
import { endSession, open, randomToken, seal, sessionIdentity, sha256b64url, SESSION_COOKIE, STATE_COOKIE, clearCookie, readCookie, setCookie, startSession } from './session'
import { buildAuthorizeUrl, exchangeCode, forwardableParams, identityOf, logoutUrl, verifyAccessToken, workosConfig, type WorkosEnv } from './workos'

/** `access` keeps the Cloudflare Access sign-in (the default). `workos` is WorkOS AuthKit only. `both` accepts either, for verifying WorkOS before Access is switched off. */
export type AuthProvider = 'access' | 'workos' | 'both'
export interface AuthRouteEnv extends AuthEnv, WorkosEnv { AUTH_PROVIDER?: string; INITIAL_ADMIN_EMAIL?: string }
/**
 * Production signs in with WorkOS only, whatever AUTH_PROVIDER says: a Cloudflare Access token is never accepted there and the local-development bypass is off.
 * Every other environment follows AUTH_PROVIDER (staging sets `access`).
 */
export const providerOf = (env: AuthRouteEnv & { NEXUS_ENV?: string }): AuthProvider =>
  env.NEXUS_ENV === 'production' ? 'workos' : env.AUTH_PROVIDER === 'workos' || env.AUTH_PROVIDER === 'both' ? env.AUTH_PROVIDER : 'access'

const STATE_TTL = 600
const PURPOSE = 'auth-state'

const page = (status: number, title: string, message: string, cookies: string[] = []) => {
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" })
  for (const c of cookies) h.append('set-cookie', c)
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${message}</p><p><a href="/">Back to Nexus</a></p></body>`, { status, headers: h })
}
const redirect = (location: string, cookies: string[] = []) => {
  const h = new Headers({ location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  for (const c of cookies) h.append('set-cookie', c)
  return new Response(null, { status: 302, headers: h })
}

/** Who is making this request: the Access token, the WorkOS session cookie, or either, depending on AUTH_PROVIDER. */
export async function identify(request: Request, env: AuthRouteEnv & { NEXUS_ENV?: string }, db: D1 | undefined, fetcher: typeof fetch, nowMs: number): Promise<Identity> {
  const provider = providerOf(env)
  const url = new URL(request.url)
  if (provider === 'access' || (provider === 'both' && request.headers.get('cf-access-jwt-assertion'))) return authenticate(request, env, fetcher, nowMs)
  if (env.DEV_BYPASS_AUTH === 'true' && isLocal(url) && env.NEXUS_ENV !== 'production') return { email: 'local-dev', via: 'dev' }
  const cfg = workosConfig(env)
  if (!cfg) throw new AuthError(503, 'WorkOS sign-in is not configured, so saved data is unavailable.', 'workos-not-configured')
  if (!db) throw new AuthError(503, 'The database is not connected.', 'no-database')
  const who = await sessionIdentity(request, db, cfg.pepper, new Date(nowMs))
  if (!who) throw new AuthError(401, 'Sign in required.', 'no-session')
  return { email: who.email, via: 'workos' }
}

/**
 * /api/auth/login, /api/auth/callback, /api/auth/logout. Registration is invitation-only twice over: WorkOS sign-up is switched off, and a verified WorkOS identity
 * still gets no Nexus session unless an administrator has added its email as a member that has not been revoked.
 */
export async function handleAuthRoute(path: string, request: Request, env: AuthRouteEnv & { NEXUS_ENV?: string }, db: D1 | undefined, fetcher: typeof fetch, now: Date): Promise<Response | null> {
  if (!path.startsWith('/api/auth/')) return null
  if (providerOf(env) === 'access') return new Response(JSON.stringify({ error: 'Not found.', code: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  const cfg = workosConfig(env)
  if (!cfg || !db) return page(503, 'Sign-in isn’t available', 'Sign-in is not set up for this environment yet.')
  const url = new URL(request.url)

  if (path === '/api/auth/login' && (request.method === 'GET' || request.method === 'HEAD')) {
    const forward = forwardableParams(url.searchParams)
    const state = randomToken(32)
    const verifier = randomToken(32)
    const sealed = await seal(cfg.pepper, PURPOSE, { s: state, v: verifier }, now, STATE_TTL)
    return redirect(buildAuthorizeUrl(cfg, { state, challenge: await sha256b64url(verifier), loginHint: forward.login_hint, invitationToken: forward.invitation_token }), [setCookie(STATE_COOKIE, sealed, STATE_TTL)])
  }

  if (path === '/api/auth/callback' && request.method === 'GET') {
    const fail = (status: number, title: string, message: string) => page(status, title, `${message} <a href="/api/auth/login">Try again</a>.`, [clearCookie(STATE_COOKIE)])
    const opened = await open(cfg.pepper, PURPOSE, readCookie(request, STATE_COOKIE), now)
    const state = url.searchParams.get('state') ?? ''
    if (!opened || typeof opened.s !== 'string' || typeof opened.v !== 'string' || state !== opened.s) return fail(400, 'Sign-in didn’t complete', 'This sign-in attempt expired or did not start in this browser.')
    const code = url.searchParams.get('code') ?? ''
    if (url.searchParams.get('error') || !code) return fail(400, 'Sign-in didn’t complete', 'The sign-in was cancelled or refused.')
    const ex = await exchangeCode(cfg, code, opened.v, fetcher)
    if (!ex.ok) return ex.kind === 'unavailable' ? fail(502, 'Sign-in is unavailable', 'The sign-in service could not be reached.') : fail(400, 'Sign-in didn’t complete', 'The sign-in could not be verified.')
    const verified = await verifyAccessToken(cfg, ex.accessToken, fetcher, now)
    if (!verified.ok) return verified.kind === 'unavailable' ? fail(502, 'Sign-in is unavailable', 'The sign-in service could not be reached.') : fail(403, 'Sign-in didn’t complete', 'The sign-in could not be verified.')
    const who = identityOf(ex.user, verified.sub)
    if (!who.ok) return fail(403, 'Sign-in didn’t complete', 'Your email address could not be verified.')

    // Membership gate: nobody signs in without an administrator having added them, and a revoked member never does.
    const row = await db.prepare('SELECT status, workos_user_id FROM user_roles WHERE email = ?').bind(who.email).first<{ status: string; workos_user_id: string | null }>()
    const bootstrap = !row && normalizeEmail(env.INITIAL_ADMIN_EMAIL) === who.email && !(await db.prepare("SELECT 1 AS x FROM user_roles WHERE role = 'admin' AND status <> 'revoked' LIMIT 1").first())
    if (!row && !bootstrap) return page(403, 'No access to Nexus', 'This email address hasn’t been invited. Ask an administrator to invite you.', [clearCookie(STATE_COOKIE)])
    if (row?.status === 'revoked') return page(403, 'Access revoked', 'Your access to Nexus has been revoked. Contact an administrator.', [clearCookie(STATE_COOKIE)])
    if (row?.workos_user_id && row.workos_user_id !== who.workosUserId) return page(403, 'No access to Nexus', 'This sign-in does not match the account that was invited.', [clearCookie(STATE_COOKIE)])
    const at = now.toISOString()
    if (row) await db.prepare("UPDATE user_roles SET workos_user_id = ?, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, last_seen_at = ? WHERE email = ?").bind(who.workosUserId, at, who.email).run()
    // The very first administrator: created here, bound to the verified WorkOS user, only while no administrator exists and only for INITIAL_ADMIN_EMAIL.
    else await db.batch([
      db.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at, status, workos_user_id, last_seen_at) VALUES (?, 'admin', 'bootstrap:INITIAL_ADMIN_EMAIL', ?, 'active', ?, ?)").bind(who.email, at, who.workosUserId, at),
      db.prepare("INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, 'bootstrap:INITIAL_ADMIN_EMAIL', ?, NULL, 'admin')").bind(at, who.email),
    ])
    const started = await startSession(db, cfg.pepper, { email: who.email, workosUserId: who.workosUserId, workosSessionId: verified.sid, method: ex.method }, now)
    return redirect('/', [started.cookie, clearCookie(STATE_COOKIE)])
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) return new Response(JSON.stringify({ error: 'Cross-origin requests are not allowed.', code: 'cross-origin' }), { status: 403, headers: { 'content-type': 'application/json' } })
    const sid = await endSession(request, db, cfg.pepper, now)
    return new Response(JSON.stringify({ ok: true, logoutUrl: sid ? logoutUrl(cfg, sid) : null }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': clearCookie(SESSION_COOKIE) } })
  }
  return new Response(JSON.stringify({ error: 'Not found.', code: 'not-found' }), { status: 404, headers: { 'content-type': 'application/json' } })
}
