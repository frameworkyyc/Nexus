import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW } from './helpers'
import { readdirSync, readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from './sqliteD1'

const CLIENT = 'client_01TESTCLIENT0000000000'
const ORIGIN = 'https://staging.nexus.example'
const ISSUER = `https://api.workos.com/user_management/${CLIENT}`
const env = (over: Partial<Env> = {}, db?: TestDb): Env => ({ DB: db?.d1, NEXUS_ENV: 'staging', AUTH_PROVIDER: 'workos', WORKOS_CLIENT_ID: CLIENT, WORKOS_API_KEY: 'sk_test_0123456789', SESSION_PEPPER: 'pepper-pepper-pepper-pepper', APP_BASE_URL: ORIGIN, ...over })

const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
let pair: CryptoKeyPair
let jwk: JsonWebKey
beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
})
async function accessToken(over: Record<string, unknown> = {}, sub = 'user_01ABCDEFG') {
  const iat = Math.floor(NOW.getTime() / 1000)
  const header = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const payload = enc({ iss: ISSUER, client_id: CLIENT, sub, sid: 'session_01SESSION0001', iat, exp: iat + 300, ...over })
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64u(sig)}`
}

interface Fake { calls: { method: string; url: string; body?: unknown }[]; user: Record<string, unknown>; token: () => Promise<string>; invites: { status: number; body: unknown; resendStatus?: number; existingUser?: boolean } }
/** A fake WorkOS: the sign-in token exchange, the signing keys, and the invitations API. */
function workos(over: Partial<Fake> = {}) {
  const fake: Fake = { calls: [], user: { id: 'user_01ABCDEFG', email: 'ed@example.com', email_verified: true }, token: () => accessToken(), invites: { status: 201, body: { id: 'invitation_01ABCDEFGH', expires_at: '2026-10-28T15:00:00.000Z' } }, ...over }
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    fake.calls.push({ method: init?.method ?? 'GET', url, body })
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    if (url.endsWith('/openid-configuration')) return j({})
    if (url.includes('/sso/jwks/')) return j({ keys: [{ ...jwk, kid: 'k1', use: 'sig', alg: 'RS256' }] })
    if (url.endsWith('/user_management/authenticate')) return j({ access_token: await fake.token(), user: fake.user, authentication_method: 'MagicAuth' })
    if (url.includes('/user_management/users?email=')) return j({ data: fake.invites.existingUser ? [{ email: new URL(url).searchParams.get('email') }] : [] })
    if (url.endsWith('/user_management/invitations')) return j(fake.invites.body, fake.invites.status)
    const m = /invitations\/(invitation_\w+)\/(resend|revoke)$/.exec(url)
    if (m) return j({ id: m[1], expires_at: '2026-10-28T15:00:00.000Z' }, m[2] === 'resend' ? fake.invites.resendStatus ?? 200 : 200)
    return j({}, 404)
  }) as typeof fetch
  return { fake, f }
}

const give = (db: TestDb, email: string, role: string, status = 'active') => db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at, status) VALUES (?, ?, 'test', '2026-10-21T00:00:00Z', ?)").run(email, role, status)
const call = async (db: TestDb, f: typeof fetch, method: string, path: string, opts: { cookie?: string; body?: unknown; e?: Partial<Env> } = {}) => {
  resetAuthCache()
  const res = await handleApi(new Request(`${ORIGIN}${path}`, { method, redirect: 'manual', headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), 'content-type': 'application/json' }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env(opts.e, db), clock(), f)
  const text = await res.text()
  const body: any = (() => { try { return JSON.parse(text) } catch { return text } })() // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body, headers: res.headers, cookies: res.headers.getSetCookie() }
}
const cookieOf = (cookies: string[], name: string) => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0]

/** Runs a full sign-in: /login, then /callback with the state from the redirect. Returns the session cookie (or the failing response). */
async function signIn(db: TestDb, f: typeof fetch, e: Partial<Env> = {}) {
  const login = await call(db, f, 'GET', '/api/auth/login', { e })
  const loc = new URL(login.headers.get('location') ?? '')
  const stateCookie = cookieOf(login.cookies, '__Host-nx_auth') as string
  const cb = await call(db, f, 'GET', `/api/auth/callback?code=abc123&state=${loc.searchParams.get('state')}`, { cookie: stateCookie, e })
  return { login, loc, cb, session: cookieOf(cb.cookies, '__Host-nx_session') }
}
const fresh = () => { const db = createTestDb({ seed: false, projectAccess: 'explicit' }); give(db, 'admin@example.com', 'admin'); return db }

describe('WorkOS sign-in', () => {
  it('sends the person to WorkOS AuthKit with PKCE, this installation’s callback and a signed state cookie', async () => {
    const db = fresh(); const { f } = workos()
    const { loc, login } = await signIn(db, f)
    expect(loc.origin + loc.pathname).toBe('https://api.workos.com/user_management/authorize')
    expect(Object.fromEntries(loc.searchParams)).toMatchObject({ client_id: CLIENT, redirect_uri: `${ORIGIN}/api/auth/callback`, response_type: 'code', provider: 'authkit', code_challenge_method: 'S256' })
    expect(login.cookies[0]).toMatch(/^__Host-nx_auth=.*HttpOnly; Secure; SameSite=Lax/)
  })

  it('an invited member signs in, becomes Active, and the session resolves their role and projects on every request', async () => {
    const db = fresh(); const { f, fake } = workos()
    give(db, 'ed@example.com', 'editor', 'invited')
    const { cb, session } = await signIn(db, f)
    expect(cb.status).toBe(302)
    expect(session).toBeDefined()
    expect(cb.cookies.find((c) => c.startsWith('__Host-nx_session='))).toMatch(/HttpOnly; Secure; SameSite=Lax/)
    expect(db.raw.prepare("SELECT status, workos_user_id FROM user_roles WHERE email = 'ed@example.com'").get()).toEqual({ status: 'active', workos_user_id: 'user_01ABCDEFG' })
    const me = await call(db, f, 'GET', '/api/session', { cookie: session })
    expect(me.body).toMatchObject({ user: 'ed@example.com', role: 'editor', via: 'workos', auth: 'workos' })
    // the stored session id is an HMAC, never the cookie token
    const token = session!.split('=')[1]
    expect(JSON.stringify(db.raw.prepare('SELECT * FROM auth_sessions').all())).not.toContain(token)
    // the client secret only ever goes to WorkOS in the code exchange
    expect(fake.calls.find((c) => c.url.endsWith('/authenticate'))?.body).toMatchObject({ client_secret: 'sk_test_0123456789', code_verifier: expect.any(String) })
  })

  it('is invitation-only: a verified WorkOS user who was never added gets no session and no data', async () => {
    const db = fresh(); const { f } = workos({ user: { id: 'user_01STRANGER1', email: 'stranger@example.com', email_verified: true }, token: () => accessToken({}, 'user_01STRANGER1') })
    const { cb, session } = await signIn(db, f)
    expect(cb.status).toBe(403)
    expect(session).toBeUndefined()
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get()).toEqual({ n: 0 })
    expect((await call(db, f, 'GET', '/api/state/construction')).status).toBe(401)
  })

  it('a revoked member is refused at sign-in, and an existing session stops working on the very next request', async () => {
    const db = fresh(); const { f } = workos()
    give(db, 'ed@example.com', 'editor', 'invited')
    const { session } = await signIn(db, f)
    expect((await call(db, f, 'GET', '/api/state/construction', { cookie: session })).status).toBe(200)
    db.raw.prepare("UPDATE user_roles SET status = 'revoked' WHERE email = 'ed@example.com'").run() // even without clearing the session row
    expect(await call(db, f, 'GET', '/api/state/construction', { cookie: session })).toMatchObject({ status: 403, body: { code: 'revoked' } })
    expect((await signIn(db, f)).cb.status).toBe(403)
  })

  it('revoking through Team Members also ends every session and withdraws a pending invitation', async () => {
    const db = fresh(); const { f, fake } = workos()
    const admin = await adminSession(db, f)
    await call(db, f, 'POST', '/api/members/invite', { cookie: admin, body: { email: 'ed@example.com', role: 'editor' } })
    const { session } = await signIn(db, f)
    expect((await call(db, f, 'GET', '/api/session', { cookie: session })).status).toBe(200)
    await call(db, f, 'POST', '/api/members/revoke', { cookie: admin, body: { email: 'ed@example.com' } })
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE email = 'ed@example.com' AND revoked_at IS NULL").get()).toEqual({ n: 0 })
    expect((await call(db, f, 'GET', '/api/session', { cookie: session })).status).toBe(401)
    expect(fake.calls.some((c) => c.url.endsWith('/invitations/invitation_01ABCDEFGH/revoke'))).toBe(true)
  })

  it('refuses a mismatched state, a missing state cookie, bad tokens and unverified email', async () => {
    const db = fresh(); give(db, 'ed@example.com', 'editor', 'invited')
    const { f } = workos()
    const login = await call(db, f, 'GET', '/api/auth/login')
    const stateCookie = cookieOf(login.cookies, '__Host-nx_auth') as string
    expect((await call(db, f, 'GET', '/api/auth/callback?code=abc&state=wrong', { cookie: stateCookie })).status).toBe(400)
    expect((await call(db, f, 'GET', '/api/auth/callback?code=abc&state=x')).status).toBe(400)
    for (const [over, status] of [[{ iss: 'https://evil.example' }, 403], [{ client_id: 'client_other' }, 403], [{ sid: undefined }, 403], [{ exp: 1 }, 403]] as const) {
      const w = workos({ token: () => accessToken(over) })
      expect((await signIn(db, w.f)).cb.status, JSON.stringify(over)).toBe(status)
    }
    expect((await signIn(db, workos({ user: { id: 'user_01ABCDEFG', email: 'ed@example.com', email_verified: false } }).f)).cb.status).toBe(403)
    expect((await signIn(db, workos({ user: { id: 'user_01OTHERUSER', email: 'ed@example.com', email_verified: true } }).f)).cb.status).toBe(403) // token subject differs from the user
  })

  it('binds a member to the WorkOS user who first signed in: a different user with the same email is refused', async () => {
    const db = fresh(); give(db, 'ed@example.com', 'editor', 'invited')
    expect((await signIn(db, workos().f)).session).toBeDefined()
    const other = workos({ user: { id: 'user_01SOMEONEELSE', email: 'ed@example.com', email_verified: true }, token: () => accessToken({}, 'user_01SOMEONEELSE') })
    expect((await signIn(db, other.f)).cb.status).toBe(403)
  })

  it('signing out ends the session and returns the WorkOS logout address', async () => {
    const db = fresh(); const { f } = workos(); give(db, 'ed@example.com', 'editor', 'invited')
    const { session } = await signIn(db, f)
    const out = await call(db, f, 'POST', '/api/auth/logout', { cookie: session, body: {} })
    expect(out.body.logoutUrl).toContain('/user_management/sessions/logout?session_id=session_01SESSION0001')
    expect((await call(db, f, 'GET', '/api/session', { cookie: session })).status).toBe(401)
  })

  it('a session expires after the idle period', async () => {
    const db = fresh(); const { f } = workos(); give(db, 'ed@example.com', 'editor', 'invited')
    const { session } = await signIn(db, f)
    db.raw.prepare("UPDATE auth_sessions SET last_seen_at = '2026-10-20T00:00:00Z'").run()
    expect((await call(db, f, 'GET', '/api/session', { cookie: session })).status).toBe(401)
  })
})

async function adminSession(db: TestDb, f: typeof fetch) {
  db.raw.prepare("UPDATE user_roles SET workos_user_id = 'user_01ADMINUSER0' WHERE email = 'admin@example.com'").run()
  const w = workos({ user: { id: 'user_01ADMINUSER0', email: 'admin@example.com', email_verified: true }, token: () => accessToken({}, 'user_01ADMINUSER0') })
  void f
  const s = (await signIn(db, w.f)).session as string
  expect(s).toBeDefined()
  return s
}

describe('invitations through WorkOS', () => {
  it('inviting asks WorkOS to email the invitation and tracks it; Resend keeps the expiry; a failed send can be retried', async () => {
    const db = fresh(); const { f, fake } = workos()
    const admin = await adminSession(db, f)
    const invited = await call(db, f, 'POST', '/api/members/invite', { cookie: admin, body: { email: 'New@Example.com', role: 'viewer' } })
    expect(invited.status).toBe(200)
    expect(fake.calls.find((c) => c.url.endsWith('/user_management/invitations'))?.body).toEqual({ email: 'new@example.com', expires_in_days: 7 })
    const m = invited.body.members.find((x: { email: string }) => x.email === 'new@example.com')
    expect(m).toMatchObject({ status: 'invited', signedIn: false, invitation: { delivery: 'sent', expiresAt: '2026-10-28T15:00:00.000Z' } })
    const again = await call(db, f, 'POST', '/api/members/resend', { cookie: admin, body: { email: 'new@example.com' } })
    expect(again.status).toBe(200)
    expect(fake.calls.some((c) => c.url.endsWith('/invitations/invitation_01ABCDEFGH/resend'))).toBe(true)
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM role_audit WHERE target = 'new@example.com' AND to_role = 'invitation-resent'").get()).toEqual({ n: 1 })
  })

  it('an invitation that WorkOS cannot send leaves the member Invited with the failure shown, and Resend sends a new one', async () => {
    const db = fresh(); const w = workos({ invites: { status: 503, body: {} } })
    const admin = await adminSession(db, w.f)
    const r = await call(db, w.f, 'POST', '/api/members/invite', { cookie: admin, body: { email: 'new@example.com', role: 'editor' } })
    expect(r.status).toBe(200)
    expect(r.body.members.find((x: { email: string }) => x.email === 'new@example.com')).toMatchObject({ status: 'invited', invitation: { delivery: 'failed' } })
    w.fake.invites = { status: 201, body: { id: 'invitation_01RETRYSENT', expires_at: '2026-10-28T15:00:00.000Z' } }
    const retry = await call(db, w.f, 'POST', '/api/members/resend', { cookie: admin, body: { email: 'new@example.com' } })
    expect(retry.body.members.find((x: { email: string }) => x.email === 'new@example.com').invitation.delivery).toBe('sent')
  })

  it('someone who already has a WorkOS sign-in is not re-invited: the admin is told to share the link', async () => {
    const db = fresh(); const w = workos({ invites: { status: 422, body: {}, existingUser: true } })
    const admin = await adminSession(db, w.f)
    const r = await call(db, w.f, 'POST', '/api/members/invite', { cookie: admin, body: { email: 'new@example.com', role: 'viewer' } })
    expect(r.body.members.find((x: { email: string }) => x.email === 'new@example.com').invitation.delivery).toBe('existing_user')
    expect((await call(db, w.f, 'GET', '/api/members', { cookie: admin })).body.invitations).toEqual({ enabled: true, signInUrl: `${ORIGIN}/api/auth/login` })
  })

  it('only administrators invite or resend; nothing is sent for someone who has already signed in', async () => {
    const db = fresh(); const { f, fake } = workos(); give(db, 'ed@example.com', 'editor', 'invited')
    const { session } = await signIn(db, f)
    expect((await call(db, f, 'POST', '/api/members/invite', { cookie: session, body: { email: 'x@example.com', role: 'viewer' } })).status).toBe(403)
    expect((await call(db, f, 'POST', '/api/members/resend', { cookie: session, body: { email: 'ed@example.com' } })).status).toBe(403)
    const admin = await adminSession(db, f)
    expect((await call(db, f, 'POST', '/api/members/resend', { cookie: admin, body: { email: 'ed@example.com' } })).status).toBe(409) // already signed in
    expect(fake.calls.some((c) => c.url.includes('/invitations'))).toBe(false)
  })
})

describe('both mode (WorkOS verification while Cloudflare Access stays on)', () => {
  const TEAM = 'https://nexus-team.cloudflareaccess.com'
  const AUD = 'aud-tag-123'
  async function accessJwt(email: string) {
    const header = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    const payload = enc({ iss: TEAM, aud: [AUD], email, exp: Math.floor(NOW.getTime() / 1000) + 3600 })
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
    return `${header}.${payload}.${b64u(sig)}`
  }
  const both = { AUTH_PROVIDER: 'both', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as Partial<Env>
  const certs = (async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1' }] }))) as unknown as typeof fetch
  const withAccess = async (db: TestDb, email: string, f: typeof fetch, path = '/api/session') => {
    resetAuthCache()
    const res = await handleApi(new Request(`${ORIGIN}${path}`, { headers: { 'cf-access-jwt-assertion': await accessJwt(email) } }), env(both, db), clock(), f)
    return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it('a Cloudflare Access sign-in keeps working exactly as before, with the same role resolution', async () => {
    const db = fresh()
    const r = await withAccess(db, 'admin@example.com', certs)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ user: 'admin@example.com', role: 'admin', via: 'access', auth: 'both' })
    expect((await withAccess(db, 'nobody@example.com', certs)).body.role).toBeNull() // still no role without a membership
  })

  it('a WorkOS session works in the same mode, and with neither an Access token nor a session the request is refused', async () => {
    const db = fresh(); give(db, 'ed@example.com', 'editor', 'invited')
    const { f } = workos()
    const { session } = await signIn(db, f, both)
    expect((await call(db, f, 'GET', '/api/session', { cookie: session, e: both })).body).toMatchObject({ via: 'workos', role: 'editor' })
    expect((await call(db, f, 'GET', '/api/session', { e: both })).status).toBe(401)
  })

  it('a revoked member is refused over either sign-in', async () => {
    const db = fresh(); give(db, 'ed@example.com', 'editor', 'revoked')
    expect(await withAccess(db, 'ed@example.com', certs, '/api/state/construction')).toMatchObject({ status: 403, body: { code: 'revoked' } })
  })

  it('serves the WorkOS routes from the Worker (they are under /api/*, which the Worker handles first)', () => {
    const cfg = readFileSync('wrangler.jsonc', 'utf8')
    expect(cfg).toMatch(/"run_worker_first": \["\/api\/\*"\]/)
  })
})

describe('provider switch', () => {
  it('Cloudflare Access stays the default: the WorkOS routes do not exist and nothing changes', async () => {
    const db = fresh(); const { f } = workos()
    const r = await call(db, f, 'GET', '/api/auth/login', { e: { AUTH_PROVIDER: undefined } })
    expect(r.status).toBe(404)
    expect((await call(db, f, 'GET', '/api/session', { e: { AUTH_PROVIDER: undefined } })).body.code).toBe('access-not-configured')
  })

  it('WorkOS mode with incomplete configuration fails closed, and health reports it', async () => {
    const db = fresh(); const { f } = workos()
    expect((await call(db, f, 'GET', '/api/session', { e: { WORKOS_API_KEY: undefined } })).body.code).toBe('workos-not-configured')
    expect((await call(db, f, 'GET', '/api/health', { e: { WORKOS_API_KEY: undefined } })).body).toMatchObject({ auth: 'workos', access: false })
    expect((await call(db, f, 'GET', '/api/health')).body).toMatchObject({ auth: 'workos', access: true })
  })

  it('a WorkOS session is not accepted when only Access is configured', async () => {
    const db = fresh(); const { f } = workos(); give(db, 'ed@example.com', 'editor', 'invited')
    const { session } = await signIn(db, f)
    expect((await call(db, f, 'GET', '/api/session', { cookie: session, e: { AUTH_PROVIDER: 'access' } })).status).toBe(503)
  })
})

describe('migration 0027', () => {
  it('is additive: every existing member, role, status and project assignment is unchanged', () => {
    const db = createTestDb({ migrate: false })
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0027').sort()) db.raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
    db.raw.exec("INSERT INTO user_roles (email, role, assigned_by, assigned_at, status) VALUES ('a@example.com', 'admin', 't', '2026-10-21T00:00:00Z', 'active'), ('b@example.com', 'editor', 't', '2026-10-21T00:00:00Z', 'revoked')")
    db.raw.exec("INSERT INTO user_projects (email, project_id, assigned_by, assigned_at) VALUES ('b@example.com', 'p1', 't', '')")
    const before = db.raw.prepare('SELECT email, role, status, assigned_by, assigned_at FROM user_roles ORDER BY email').all()
    db.raw.exec(readFileSync('migrations/0027_workos_auth.sql', 'utf8'))
    expect(db.raw.prepare('SELECT email, role, status, assigned_by, assigned_at FROM user_roles ORDER BY email').all()).toEqual(before)
    expect(db.raw.prepare('SELECT workos_user_id, workos_invitation_id, invitation_delivery FROM user_roles').all()).toEqual([{ workos_user_id: null, workos_invitation_id: null, invitation_delivery: null }, { workos_user_id: null, workos_invitation_id: null, invitation_delivery: null }])
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM user_projects').get()).toEqual({ n: 1 })
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '27' })
  })
})
