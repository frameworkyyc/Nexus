import type { D1 } from './db'

/**
 * Nexus's own sessions, ported from the Framework portal (worker/portal/sessions.js, crypto.js, http.js). A session proves WHO someone is; it never grants
 * access: every request still resolves the member's role, status and projects from the database. The cookie holds a random token and only an HMAC of it is
 * stored, so a copy of the database cannot be used to sign in. Everything fails closed: any problem reading the store means "not signed in".
 */
export const SESSION_COOKIE = '__Host-nx_session'
export const STATE_COOKIE = '__Host-nx_auth'
export const IDLE_SECONDS = 12 * 3600
export const ABSOLUTE_SECONDS = 14 * 86400
const TOUCH_AFTER_SECONDS = 60

const enc = new TextEncoder()
const dec = new TextDecoder()
export const bytesToB64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
export const randomToken = (bytes = 32) => bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)))
export const sha256b64url = async (v: string) => bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(v))))
const TOKEN = /^[A-Za-z0-9_-]{43}$/

/** HMAC under a distinct label per purpose, so a value made for one purpose is never accepted for another. Rotating the pepper signs everyone out. */
async function mac(pepper: string, label: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${label}:${value}`)))
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const safeEqual = (a: string, b: string) => { const x = enc.encode(a), y = enc.encode(b); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0 }

/** A short-lived, tamper-proof, purpose-bound payload (the sign-in state cookie). Signed, not encrypted. */
export async function seal(pepper: string, purpose: string, payload: Record<string, unknown>, now: Date, ttl: number): Promise<string> {
  const body = bytesToB64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(now.getTime() / 1000) + ttl })))
  return `${body}.${bytesToB64url(await mac(pepper, `seal:${purpose}`, body))}`
}
export async function open(pepper: string, purpose: string, sealed: string | undefined, now: Date): Promise<Record<string, unknown> | null> {
  if (!sealed || sealed.length > 4096) return null
  const parts = sealed.split('.')
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null
  if (!safeEqual(bytesToB64url(await mac(pepper, `seal:${purpose}`, parts[0])), parts[1])) return null
  try {
    const p = JSON.parse(dec.decode(b64urlToBytes(parts[0]))) as Record<string, unknown>
    return typeof p.exp === 'number' && Math.floor(now.getTime() / 1000) <= p.exp ? p : null
  } catch { return null }
}

/** Cookies are __Host- prefixed (HTTPS only, host-only, Path=/), HttpOnly and SameSite=Lax. */
export const setCookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
export const clearCookie = (name: string) => setCookie(name, '', 0)
/** A name that appears more than once is ambiguous (cookie tossing from a sibling host) and counts as absent. */
export function readCookie(request: Request, name: string): string | undefined {
  const found = (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).filter((c) => c.startsWith(`${name}=`))
  return found.length === 1 ? found[0].slice(name.length + 1) : undefined
}

const sessionId = (pepper: string, token: string) => mac(pepper, 'session', token).then(hex)

export async function startSession(db: D1, pepper: string, p: { email: string; workosUserId: string; workosSessionId: string; method: string | null }, now: Date): Promise<{ cookie: string }> {
  const token = randomToken(32) // always brand new: never reuse a token a browser already holds
  const at = now.toISOString()
  await db.prepare('INSERT INTO auth_sessions (id, email, workos_user_id, workos_session_id, auth_method, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(await sessionId(pepper, token), p.email, p.workosUserId, p.workosSessionId, p.method, at, at, new Date(now.getTime() + ABSOLUTE_SECONDS * 1000).toISOString()).run()
  return { cookie: setCookie(SESSION_COOKIE, token, ABSOLUTE_SECONDS) }
}

interface SessionRow { email: string; workos_user_id: string; workos_session_id: string; last_seen_at: string; expires_at: string }
async function findActive(db: D1, id: string, now: Date): Promise<SessionRow | null> {
  const row = await db.prepare('SELECT email, workos_user_id, workos_session_id, last_seen_at, expires_at FROM auth_sessions WHERE id = ? AND revoked_at IS NULL').bind(id).first<SessionRow>()
  if (!row) return null
  if (Date.parse(row.expires_at) <= now.getTime() || Date.parse(row.last_seen_at) + IDLE_SECONDS * 1000 <= now.getTime()) return null
  return row
}

/** Who is signed in on this request, from the session cookie. null = nobody (including any store problem). */
export async function sessionIdentity(request: Request, db: D1, pepper: string, now: Date): Promise<{ email: string; workosUserId: string } | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || !TOKEN.test(token)) return null
  try {
    const id = await sessionId(pepper, token)
    const row = await findActive(db, id, now)
    if (!row) return null
    if (now.getTime() - Date.parse(row.last_seen_at) > TOUCH_AFTER_SECONDS * 1000) await db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').bind(now.toISOString(), id).run().catch(() => {})
    return { email: row.email, workosUserId: row.workos_user_id }
  } catch { return null }
}

/** Ends this browser's session. Returns the WorkOS session id so the caller can also end the identity-provider session. */
export async function endSession(request: Request, db: D1, pepper: string, now: Date): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || !TOKEN.test(token)) return null
  try {
    const id = await sessionId(pepper, token)
    const row = await findActive(db, id, now)
    await db.prepare("UPDATE auth_sessions SET revoked_at = ?, revoke_reason = 'logout' WHERE id = ? AND revoked_at IS NULL").bind(now.toISOString(), id).run()
    return row?.workos_session_id ?? null
  } catch { return null }
}

/** Every session of a member ends at once (revoking or restoring them). */
export const revokeSessionsOf = (db: D1, email: string, reason: string, now: Date) =>
  db.prepare('UPDATE auth_sessions SET revoked_at = ?, revoke_reason = ? WHERE email = ? AND revoked_at IS NULL').bind(now.toISOString(), reason, email).run()
