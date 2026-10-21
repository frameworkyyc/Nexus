/**
 * Cloudflare Access gate. Access sits in front of the site and puts a signed JWT in `Cf-Access-Jwt-Assertion`; the Worker
 * verifies that token itself, so the API stays closed even if the Access policy is misconfigured, bypassed through another
 * hostname (for example workers.dev), or removed. With no Access settings the API refuses to serve data (fail closed).
 */
export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string // https://<team>.cloudflareaccess.com
  ACCESS_AUD?: string // the Access application's audience (AUD) tag
  ALLOWED_EMAILS?: string // optional comma-separated allow-list, checked in addition to the Access policy
  DEV_BYPASS_AUTH?: string // "true" only honoured for localhost requests
}

export interface Identity { email: string; via: 'access' | 'dev' }
export class AuthError extends Error {
  constructor(public status: 401 | 403 | 503, message: string, public code: string) { super(message) }
}

interface Jwk { kid?: string; kty: string; n?: string; e?: string; alg?: string }
let cache: { url: string; keys: Jwk[]; at: number } | null = null

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s))) as Record<string, unknown>

async function keys(teamDomain: string, fetcher: typeof fetch, forceRefresh: boolean): Promise<Jwk[]> {
  const url = `${teamDomain}/cdn-cgi/access/certs`
  if (!forceRefresh && cache && cache.url === url && Date.now() - cache.at < 10 * 60_000) return cache.keys
  const res = await fetcher(url)
  if (!res.ok) throw new AuthError(503, 'Could not load Cloudflare Access signing keys.', 'access-keys')
  const body = (await res.json()) as { keys?: Jwk[] }
  cache = { url, keys: body.keys ?? [], at: Date.now() }
  return cache.keys
}

export const resetAuthCache = () => { cache = null }

const isLocal = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

export async function authenticate(request: Request, env: AuthEnv, fetcher: typeof fetch = fetch, nowMs = Date.now()): Promise<Identity> {
  const url = new URL(request.url)
  if (env.DEV_BYPASS_AUTH === 'true' && isLocal(url)) return { email: 'local-dev', via: 'dev' }
  const team = (env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/\/+$/, '')
  const aud = (env.ACCESS_AUD ?? '').trim()
  if (!team || !aud) throw new AuthError(503, 'Access control is not configured, so saved data is unavailable.', 'access-not-configured')
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) throw new AuthError(401, 'Sign in required.', 'no-token')
  const [h, p, sig] = token.split('.')
  if (!h || !p || !sig) throw new AuthError(401, 'Invalid token.', 'bad-token')
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try { header = json(h); payload = json(p) } catch { throw new AuthError(401, 'Invalid token.', 'bad-token') }
  if (header.alg !== 'RS256') throw new AuthError(401, 'Invalid token.', 'bad-alg')
  let jwk = (await keys(team, fetcher, false)).find((k) => k.kid === header.kid)
  if (!jwk) jwk = (await keys(team, fetcher, true)).find((k) => k.kid === header.kid)
  if (!jwk) throw new AuthError(401, 'Unknown signing key.', 'bad-kid')
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(sig), new TextEncoder().encode(`${h}.${p}`))
  if (!valid) throw new AuthError(401, 'Invalid token signature.', 'bad-signature')
  const now = Math.floor(nowMs / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new AuthError(401, 'Session expired.', 'expired')
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) throw new AuthError(401, 'Token not yet valid.', 'not-yet')
  if (payload.iss !== team) throw new AuthError(403, 'Token issuer is not accepted.', 'bad-issuer')
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audience.includes(aud)) throw new AuthError(403, 'Token audience is not accepted.', 'bad-audience')
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
  const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (allowed.length && !allowed.includes(email)) throw new AuthError(403, 'This account is not allowed.', 'not-allowed')
  return { email: email || 'unknown', via: 'access' }
}
