/**
 * WorkOS AuthKit client, ported from the Framework client portal (worker/portal/workos.js, workos-admin.js, claims.js, jwt.js): authorize URL (PKCE S256),
 * server-side code exchange, access-token verification against WorkOS's published keys, and the invitations API. Every network call goes through an injected
 * `fetcher`, so tests never reach WorkOS. Outcomes are typed; upstream text is never returned to a person.
 */
export interface WorkosConfig { clientId: string; apiKey: string; origin: string; issuer: string; pepper: string }
export interface WorkosEnv { WORKOS_CLIENT_ID?: string; WORKOS_API_KEY?: string; APP_BASE_URL?: string; SESSION_PEPPER?: string }

const ORIGIN = 'https://api.workos.com'
export const CALLBACK_PATH = '/api/auth/callback'
const TIMEOUT_MS = 8000
const WORKOS_ID = /^[A-Za-z0-9_.-]{5,128}$/
const INVITATION_ID = /^invitation_[A-Za-z0-9]{5,100}$/
const AUTH_CODE = /^[A-Za-z0-9._~-]{1,512}$/
const EMAIL_HINT = /^[^\s@<>"'&?#%]{1,64}@[^\s@<>"'&?#%]{1,190}$/
const INVITATION_TOKEN = /^[A-Za-z0-9._~-]{8,256}$/

/** The configuration, or null when WorkOS sign-in is not fully set up (a missing secret never leaves a half-working sign-in). */
export function workosConfig(env: WorkosEnv): WorkosConfig | null {
  const clientId = (env.WORKOS_CLIENT_ID ?? '').trim()
  const apiKey = (env.WORKOS_API_KEY ?? '').trim()
  const pepper = (env.SESSION_PEPPER ?? '').trim()
  let origin = ''
  try { const u = new URL((env.APP_BASE_URL ?? '').trim()); if (u.protocol === 'https:' || u.hostname === 'localhost') origin = u.origin } catch { /* not configured */ }
  if (!/^client_[A-Za-z0-9]{10,}$/.test(clientId) || apiKey.length < 8 || pepper.length < 16 || !origin) return null
  return { clientId, apiKey, origin, issuer: `${ORIGIN}/user_management/${clientId}`, pepper }
}

/** Only these parameters travel from our sign-in URL to WorkOS, and only when they look right. */
export function forwardableParams(search: URLSearchParams): { login_hint?: string; invitation_token?: string } {
  const out: { login_hint?: string; invitation_token?: string } = {}
  const hint = search.get('login_hint'); if (hint && EMAIL_HINT.test(hint)) out.login_hint = hint
  const token = search.get('invitation_token'); if (token && INVITATION_TOKEN.test(token)) out.invitation_token = token
  return out
}

export function buildAuthorizeUrl(cfg: WorkosConfig, p: { state: string; challenge: string; loginHint?: string; invitationToken?: string }): string {
  const u = new URL(`${ORIGIN}/user_management/authorize`)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', cfg.origin + CALLBACK_PATH)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('provider', 'authkit')
  u.searchParams.set('state', p.state)
  u.searchParams.set('code_challenge', p.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  if (p.loginHint) u.searchParams.set('login_hint', p.loginHint)
  if (p.invitationToken) u.searchParams.set('invitation_token', p.invitationToken)
  return u.toString()
}

export const logoutUrl = (cfg: WorkosConfig, workosSessionId: string) => {
  if (!WORKOS_ID.test(workosSessionId)) return null
  const u = new URL(`${ORIGIN}/user_management/sessions/logout`)
  u.searchParams.set('session_id', workosSessionId)
  u.searchParams.set('return_to', cfg.origin)
  return u.toString()
}

async function fetchJson(fetcher: typeof fetch, url: string, init: RequestInit = {}) {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body: body as Record<string, unknown> | null }
}

export interface WorkosUser { id: string; email: string; email_verified: boolean }
/** Exchanges the authorization code. The API key travels only in this server-to-server request. */
export async function exchangeCode(cfg: WorkosConfig, code: string, verifier: string, fetcher: typeof fetch): Promise<{ ok: true; accessToken: string; user: Record<string, unknown>; method: string | null } | { ok: false; kind: 'unavailable' | 'refused' }> {
  if (!AUTH_CODE.test(code)) return { ok: false, kind: 'refused' }
  let res
  try {
    res = await fetchJson(fetcher, `${ORIGIN}/user_management/authenticate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.apiKey, grant_type: 'authorization_code', code, code_verifier: verifier }) })
  } catch { return { ok: false, kind: 'unavailable' } }
  if (res.status >= 500 || res.status === 429) return { ok: false, kind: 'unavailable' }
  const b = res.body
  if (!res.ok || !b || typeof b.access_token !== 'string' || !b.user || typeof b.user !== 'object') return { ok: false, kind: 'refused' }
  const m = typeof b.authentication_method === 'string' ? b.authentication_method.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() : null
  return { ok: true, accessToken: b.access_token, user: b.user as Record<string, unknown>, method: m && /^[a-z][a-z0-9_-]{0,39}$/.test(m) ? m : null }
}

interface Jwks { keys?: { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string }[] }
const trustedJwksHost = (value: string) => { try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'api.workos.com' || u.hostname.endsWith('.authkit.app')) } catch { return false } }

async function loadJwks(cfg: WorkosConfig, fetcher: typeof fetch): Promise<Jwks | null> {
  let url = `${ORIGIN}/sso/jwks/${encodeURIComponent(cfg.clientId)}`
  try {
    const d = await fetchJson(fetcher, `${ORIGIN}/user_management/${encodeURIComponent(cfg.clientId)}/.well-known/openid-configuration`)
    if (d.ok && d.body && typeof d.body.jwks_uri === 'string' && trustedJwksHost(d.body.jwks_uri)) url = d.body.jwks_uri
  } catch { /* documented URL */ }
  try { const k = await fetchJson(fetcher, url); return k.ok && k.body && Array.isArray((k.body as Jwks).keys) ? (k.body as Jwks) : null } catch { return null }
}

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
const part = (s: string) => JSON.parse(new TextDecoder().decode(b64(s))) as Record<string, unknown>
const LEEWAY = 30

/** Verifies signature, algorithm and timing, then the claims (pinned issuer, our client, subject, REQUIRED WorkOS session id). */
export async function verifyAccessToken(cfg: WorkosConfig, token: string, fetcher: typeof fetch, now = new Date()): Promise<{ ok: true; sub: string; sid: string } | { ok: false; kind: 'unavailable' | 'invalid'; reason: string }> {
  const jwks = await loadJwks(cfg, fetcher)
  if (!jwks) return { ok: false, kind: 'unavailable', reason: 'keys_unavailable' }
  const bad = (reason: string) => ({ ok: false as const, kind: 'invalid' as const, reason })
  const parts = typeof token === 'string' && token.length <= 8192 ? token.split('.') : []
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return bad('malformed')
  let header: Record<string, unknown>, payload: Record<string, unknown>
  try { header = part(parts[0]); payload = part(parts[1]) } catch { return bad('malformed') }
  if (header.alg !== 'RS256') return bad('bad_alg')
  const key = (jwks.keys ?? []).find((k) => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'))
  if (!key) return bad('unknown_kid')
  const valid = await (async () => {
    try {
      const ck = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', ck, b64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
    } catch { return false }
  })()
  if (!valid) return bad('bad_signature')
  const nowSec = Math.floor(now.getTime() / 1000)
  const { iss, client_id: clientId, sub, sid, exp, iat, aud } = payload
  if (typeof exp !== 'number' || nowSec > exp + LEEWAY) return bad('expired')
  if (typeof payload.nbf === 'number' && nowSec + LEEWAY < payload.nbf) return bad('not_yet_valid')
  if (iss !== cfg.issuer) return bad('issuer_mismatch')
  if (clientId !== cfg.clientId) return bad('client_mismatch')
  if (typeof sub !== 'string' || !WORKOS_ID.test(sub)) return bad('subject_invalid')
  if (aud !== undefined && aud !== null && !(Array.isArray(aud) ? aud : [aud]).includes(cfg.clientId)) return bad('audience_mismatch')
  if (typeof sid !== 'string' || !WORKOS_ID.test(sid)) return bad('session_id_invalid')
  if (!Number.isInteger(iat) || !Number.isInteger(exp) || (iat as number) > nowSec + LEEWAY || (exp as number) - (iat as number) < 1 || (exp as number) - (iat as number) > 3600) return bad('lifetime_invalid')
  return { ok: true, sub, sid }
}

/** The verified identity from the code-exchange user, bound to the verified token. */
export function identityOf(user: Record<string, unknown>, sub: string): { ok: true; workosUserId: string; email: string } | { ok: false; reason: string } {
  if (typeof user.id !== 'string' || !WORKOS_ID.test(user.id)) return { ok: false, reason: 'user_invalid' }
  if (user.id !== sub) return { ok: false, reason: 'subject_mismatch' }
  if (user.email_verified !== true) return { ok: false, reason: 'email_not_verified' }
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'email_invalid' }
  return { ok: true, workosUserId: user.id, email }
}

/* ── Invitations (server-side admin API) ──────────────────────────────────────────────────────────────────────────────────────── */

export type InviteErrorCode = 'workos_not_configured' | 'workos_unreachable' | 'workos_unauthorized' | 'workos_rate_limited' | 'workos_rejected' | 'workos_unavailable' | 'workos_bad_response'
export class InviteError extends Error { constructor(public code: InviteErrorCode) { super(code) } }

export interface Invitations {
  findUserByEmail(email: string): Promise<{ exists: boolean }>
  create(email: string, expiresInDays: number): Promise<{ id: string; expiresAt: string | null }>
  resend(id: string): Promise<{ id: string; expiresAt: string | null }>
  revoke(id: string): Promise<void>
}

/** WorkOS emails the invitation itself (with a link to this installation's sign-in). Errors carry a short code only: never WorkOS's text, never the address. */
export function invitationsClient(cfg: WorkosConfig, fetcher: typeof fetch): Invitations {
  async function call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    let res: Response
    try { res = await fetcher(ORIGIN + path, { method, headers: { authorization: `Bearer ${cfg.apiKey}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) }) } catch { throw new InviteError('workos_unreachable') }
    if (res.status === 401 || res.status === 403) throw new InviteError('workos_unauthorized')
    if (res.status === 429) throw new InviteError('workos_rate_limited')
    if (res.status >= 500) throw new InviteError('workos_unavailable')
    if (res.status < 200 || res.status > 299) throw new InviteError('workos_rejected')
    let data: unknown
    try { data = await res.json() } catch { throw new InviteError('workos_bad_response') }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InviteError('workos_bad_response')
    return data as Record<string, unknown>
  }
  const expires = (d: Record<string, unknown>) => (typeof d.expires_at === 'string' && !Number.isNaN(Date.parse(d.expires_at)) ? new Date(d.expires_at).toISOString() : null)
  return {
    async findUserByEmail(email) {
      const d = await call('GET', `/user_management/users?email=${encodeURIComponent(email)}`)
      if (!Array.isArray(d.data)) throw new InviteError('workos_bad_response')
      return { exists: d.data.some((u) => u && typeof (u as { email?: unknown }).email === 'string' && (u as { email: string }).email.trim().toLowerCase() === email) }
    },
    async create(email, expiresInDays) {
      const d = await call('POST', '/user_management/invitations', { email, expires_in_days: expiresInDays })
      if (typeof d.id !== 'string' || !INVITATION_ID.test(d.id)) throw new InviteError('workos_bad_response')
      return { id: d.id, expiresAt: expires(d) }
    },
    async resend(id) {
      if (!INVITATION_ID.test(id)) throw new InviteError('workos_rejected')
      const d = await call('POST', `/user_management/invitations/${id}/resend`)
      if (d.id !== id) throw new InviteError('workos_bad_response')
      return { id, expiresAt: expires(d) }
    },
    async revoke(id) {
      if (!INVITATION_ID.test(id)) throw new InviteError('workos_rejected')
      const d = await call('POST', `/user_management/invitations/${id}/revoke`)
      if (d.id !== id) throw new InviteError('workos_bad_response')
    },
  }
}
