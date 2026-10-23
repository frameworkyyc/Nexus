import { describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'

/** A database that fails the test if anything touches it. */
const forbiddenDb = new Proxy({}, { get: () => () => { throw new Error('the public demo must never touch a database') } }) as unknown as NonNullable<Env['DB']>

const call = (env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handleApi(new Request(`https://nexus.example${path}`, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env)

describe('the public demo deployment (NEXUS_ENV = demo)', () => {
  // Worst case: someone accidentally binds a database and a valid-looking Access setup AND bypass to the demo deployment.
  const env: Env = { NEXUS_ENV: 'demo', DB: forbiddenDb, ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud', DEV_BYPASS_AUTH: '1' } as Env

  it('switches the whole API off before authentication or the database are considered', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/health'], ['GET', '/api/session'], ['GET', '/api/state/fleet'], ['GET', '/api/state/construction'], ['GET', '/api/backup'],
      ['POST', '/api/commands', { module: 'fleet', name: 'recordOdometer', args: [], requestId: 'x' }], ['POST', '/api/migrate/apply', {}],
    ] as const) {
      const res = await call(env, method, path, body, { origin: 'https://evil.example', 'cf-access-jwt-assertion': 'anything' })
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(await res.json()).toMatchObject({ code: 'demo' })
    }
  })

  it('never reveals bindings or configuration', async () => {
    const text = await (await call(env, 'GET', '/api/health')).text()
    expect(text).not.toMatch(/database|team\.cloudflareaccess|aud/i)
  })

  it('does not change the other environments', async () => {
    const staging = await call({ NEXUS_ENV: 'staging' } as Env, 'GET', '/api/health')
    expect(staging.status).toBe(200) // health still answers (and reports the backend is not configured)
    expect(await staging.json()).toMatchObject({ database: false, access: false })
    const noAuth = await call({ NEXUS_ENV: 'staging', DB: forbiddenDb } as unknown as Env, 'GET', '/api/state/fleet')
    expect([401, 403, 503]).toContain(noAuth.status) // fails closed without Access, exactly as before
  })
})
