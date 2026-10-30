import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW, session, TODAY } from './helpers'
import { createTestDb } from './sqliteD1'

const TEAM = 'https://nexus-team.cloudflareaccess.com'
const AUD = 'aud-tag-123'
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

let pair: CryptoKeyPair
let jwk: JsonWebKey
beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
})

async function token(over: Record<string, unknown> = {}, key: CryptoKey = pair.privateKey, kid = 'k1') {
  const header = enc({ alg: 'RS256', kid, typ: 'JWT' })
  const payload = enc({ iss: TEAM, aud: [AUD], email: 'Owner@Example.com', exp: Math.floor(NOW.getTime() / 1000) + 3600, iat: Math.floor(NOW.getTime() / 1000), ...over })
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64u(sig)}`
}

const certs = (async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1' }] }))) as unknown as typeof fetch

function api(env: Partial<Env>, headers: Record<string, string> = {}, path = '/api/state/fleet', method = 'GET', url = 'https://staging.nexus.example', roles: [string, string][] = [['owner@example.com', 'viewer']]) {
  resetAuthCache()
  const db = createTestDb()
  for (const [email, role] of roles) db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, 'test', '2026-10-21T00:00:00Z')").run(email, role)
  return handleApi(new Request(`${url}${path}`, { method, headers, body: method === 'POST' ? '{}' : undefined }), { DB: db.d1, ...env }, clock(), certs).then(async (r) => ({ status: r.status, body: await r.json() }))
}

const configured: Partial<Env> = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }

describe('the API is not publicly readable or writable', () => {
  it('fails closed when Access is not configured', async () => {
    const r = await api({}, { 'cf-access-jwt-assertion': await token() })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('access-not-configured')
  })

  it('refuses requests without an Access token', async () => {
    expect((await api(configured)).status).toBe(401)
    expect((await api(configured, {}, '/api/commands', 'POST')).status).toBe(401)
    expect((await api(configured, {}, '/api/backup')).status).toBe(401)
    expect((await api(configured, {}, '/api/migrate/apply', 'POST')).status).toBe(401)
  })

  it('accepts a valid token and identifies the user', async () => {
    const r = await api(configured, { 'cf-access-jwt-assertion': await token() }, '/api/session')
    expect(r.status).toBe(200)
    expect(r.body.user).toBe('owner@example.com')
  })

  it('rejects forged, expired, wrong-audience, wrong-issuer and unknown-key tokens', async () => {
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])
    const run = async (t: string) => (await api(configured, { 'cf-access-jwt-assertion': t })).status
    expect(await run(await token({}, other.privateKey))).toBe(401) // signed with a key Cloudflare never published
    expect(await run(await token({ exp: Math.floor(NOW.getTime() / 1000) - 10 }))).toBe(401)
    expect(await run(await token({ aud: ['someone-elses-app'] }))).toBe(403)
    expect(await run(await token({ iss: 'https://evil.cloudflareaccess.com' }))).toBe(403)
    expect(await run(await token({}, pair.privateKey, 'unknown-kid'))).toBe(401)
    expect(await run('not.a.jwt')).toBe(401)
    const good = await token()
    expect(await run(good.slice(0, -4) + 'AAAA')).toBe(401) // tampered signature
    const [h, , s] = good.split('.')
    expect(await run(`${h}.${enc({ iss: TEAM, aud: [AUD], email: 'attacker@x.com', exp: 9_999_999_999 })}.${s}`)).toBe(401) // swapped payload
  })

  it('can be restricted to named people in addition to the Access policy', async () => {
    expect((await api({ ...configured, ALLOWED_EMAILS: 'owner@example.com' }, { 'cf-access-jwt-assertion': await token() })).status).toBe(200)
    expect((await api({ ...configured, ALLOWED_EMAILS: 'someone@else.com' }, { 'cf-access-jwt-assertion': await token() })).status).toBe(403)
  })

  it('the development bypass only works on localhost', async () => {
    const env = { DEV_BYPASS_AUTH: 'true' }
    expect((await api(env, {}, '/api/session', 'GET', 'http://localhost:8787')).status).toBe(200)
    expect((await api(env, {}, '/api/session', 'GET', 'https://staging.nexus.example')).status).toBe(503)
    expect((await api(env, {}, '/api/session', 'GET', 'https://localhost.evil.example')).status).toBe(503)
  })

  it('rejects cross-origin writes even with a valid token', async () => {
    resetAuthCache()
    const s = createTestDb()
    const res = await handleApi(new Request('https://staging.nexus.example/api/commands', { method: 'POST', body: '{}', headers: { 'cf-access-jwt-assertion': await token(), origin: 'https://evil.example' } }), { DB: s.d1, ...configured }, clock(), certs)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('cross-origin')
  })

  it('never sends CORS headers', async () => {
    const s = session()
    const res = await handleApi(new Request('http://localhost/api/state/fleet'), s.env, clock())
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('the health endpoint reveals only configuration, never data', async () => {
    const r = await api(configured, {}, '/api/health')
    expect(r.status).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(['access', 'database', 'environment', 'ok'])
  })

  it('an unauthenticated request cannot read the backup or the integrity report', async () => {
    for (const p of ['/api/backup', '/api/integrity', '/api/state/materials', '/api/session']) expect((await api(configured, {}, p)).status).toBe(401)
    void TODAY
  })
})
