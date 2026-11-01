import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW, TODAY } from './helpers'
import { getDef } from '@/domains/construction/config'
import { lockedCommandProblem } from '../locks'
import { readdirSync, readFileSync as read } from 'node:fs'
import { createTestDb, type TestDb } from './sqliteD1'

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
const token = async (email: string) => {
  const header = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const payload = enc({ iss: TEAM, aud: [AUD], email, exp: Math.floor(NOW.getTime() / 1000) + 3600 })
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64u(sig)}`
}
const certs = (async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1' }] }))) as unknown as typeof fetch


const give = (db: TestDb, email: string, role: string) => db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, 'test', '2026-10-21T00:00:00Z')").run(email, role)
async function as(db: TestDb, email: string, method: string, path: string, body?: unknown, env: Partial<Env> = {}) {
  resetAuthCache()
  const full: Env = { DB: db.d1, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, NEXUS_ENV: 'staging', ...env }
  const res = await handleApi(new Request(`https://staging.nexus.example${path}`, { method, headers: { 'cf-access-jwt-assertion': await token(email), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), full, clock(), certs)
  return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}
let n = 0
const cmd = (db: TestDb, email: string, module: string, name: string, args: unknown[], env: Partial<Env> = {}) =>
  as(db, email, 'POST', '/api/commands', { module, name, args, requestId: `req-team-${Date.now().toString(36)}-${n++}-xxxxxxxx`, clientToday: TODAY }, env)
const state = async (db: TestDb, email: string, module = 'construction') => (await as(db, email, 'GET', `/api/state/${module}`)).body.state
const status = (db: TestDb, email: string) => (db.raw.prepare('SELECT status FROM user_roles WHERE email = ?').get(email) as { status: string } | undefined)?.status

/** Two projects, each with an area and a foundation, and an admin. Project access is exactly what each test assigns. */
async function world() {
  const db = createTestDb({ seed: false, projectAccess: 'explicit' })
  give(db, 'admin@example.com', 'admin')
  expect((await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }])).status).toBe(200)
  const ids: { pid: string; aid: string; fid: string }[] = []
  for (const name of ['Alpha', 'Beta']) {
    const pid = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name }])).body.state.projects.find((p: { name: string }) => p.name === name).id
    await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, `${name} area`, []])
    const aid = (await state(db, 'admin@example.com')).areas.find((a: { name: string }) => a.name === `${name} area`).id
    const r = await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, `${name}-1`, '', null, 1, {}])
    expect(r.status).toBe(200)
    const fid = (await state(db, 'admin@example.com')).foundations.find((f: { number: string }) => f.number === `${name}-1`).id
    ids.push({ pid, aid, fid })
  }
  return { db, alpha: ids[0], beta: ids[1] }
}
const invite = (db: TestDb, body: Record<string, unknown>) => as(db, 'admin@example.com', 'POST', '/api/members/invite', body)

describe('migration 0026', () => {
  it('keeps every existing member active and gives existing non-administrators the projects that exist today', () => {
    const db = createTestDb({ migrate: false })
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0026').sort()) db.raw.exec(read(`migrations/${f}`, 'utf8'))
    db.raw.exec("INSERT INTO companies (id, name) VALUES ('c1', 'Co'); INSERT INTO projects (id, company_id, name, job_number, status) VALUES ('p1', 'c1', 'One', '', 'active'), ('p2', 'c1', 'Two', '', 'active')")
    give(db, 'boss@example.com', 'admin'); give(db, 'ed@example.com', 'editor'); give(db, 'view@example.com', 'viewer')
    db.raw.exec(read('migrations/0026_team_access.sql', 'utf8'))
    expect(db.raw.prepare('SELECT email, status FROM user_roles ORDER BY email').all()).toEqual([{ email: 'boss@example.com', status: 'active' }, { email: 'ed@example.com', status: 'active' }, { email: 'view@example.com', status: 'active' }])
    expect(db.raw.prepare('SELECT email, project_id FROM user_projects ORDER BY email, project_id').all()).toEqual([
      { email: 'ed@example.com', project_id: 'p1' }, { email: 'ed@example.com', project_id: 'p2' }, { email: 'view@example.com', project_id: 'p1' }, { email: 'view@example.com', project_id: 'p2' },
    ])
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '26' })
  })
})

describe('team members', () => {
  it('only administrators manage members; an invitation shows as Invited and becomes Active on first sign-in', async () => {
    const { db, alpha } = await world()
    give(db, 'editor@example.com', 'editor')
    expect((await as(db, 'editor@example.com', 'GET', '/api/members')).status).toBe(403)
    expect((await as(db, 'editor@example.com', 'POST', '/api/members/invite', { email: 'x@example.com', role: 'viewer' })).status).toBe(403)
    expect((await invite(db, { email: 'New.Person@Example.com ', role: 'editor', projectIds: [alpha.pid] })).status).toBe(200)
    expect(status(db, 'new.person@example.com')).toBe('invited')
    const list = (await as(db, 'admin@example.com', 'GET', '/api/members')).body.members
    expect(list.find((m: { email: string }) => m.email === 'new.person@example.com')).toMatchObject({ role: 'editor', status: 'invited', projectIds: [alpha.pid] })
    expect((await as(db, 'new.person@example.com', 'GET', '/api/session')).body).toMatchObject({ role: 'editor', projects: [alpha.pid] })
    expect(status(db, 'new.person@example.com')).toBe('active')
    expect((await invite(db, { email: 'new.person@example.com', role: 'viewer' })).status).toBe(409)
    expect((await invite(db, { email: 'nope', role: 'viewer' })).status).toBe(400)
    expect((await invite(db, { email: 'a@example.com', role: 'owner' })).status).toBe(400)
    expect((await invite(db, { email: 'a@example.com', role: 'viewer', projectIds: ['missing'] })).status).toBe(400)
  })

  it('permissions can be changed and projects reassigned; administrators are never limited to projects', async () => {
    const { db, alpha, beta } = await world()
    await invite(db, { email: 'p@example.com', role: 'viewer', projectIds: [alpha.pid] })
    await as(db, 'admin@example.com', 'POST', '/api/members/update', { email: 'p@example.com', role: 'editor', projectIds: [alpha.pid, beta.pid] })
    expect((await as(db, 'p@example.com', 'GET', '/api/session')).body).toMatchObject({ role: 'editor', projects: [alpha.pid, beta.pid].sort() })
    await as(db, 'admin@example.com', 'POST', '/api/members/update', { email: 'p@example.com', role: 'admin' })
    expect((await as(db, 'p@example.com', 'GET', '/api/session')).body).toMatchObject({ role: 'admin', projects: 'all' })
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM user_projects WHERE email = 'p@example.com'").get()).toEqual({ n: 0 })
  })

  it('a project-assigned member sees and changes only their projects, on the server', async () => {
    const { db, alpha, beta } = await world()
    await invite(db, { email: 'ed@example.com', role: 'editor', projectIds: [alpha.pid] })
    await invite(db, { email: 'none@example.com', role: 'viewer', projectIds: [] })
    const s = await state(db, 'ed@example.com')
    expect(s.projects.map((p: { id: string }) => p.id)).toEqual([alpha.pid])
    expect(s.areas.map((a: { id: string }) => a.id)).toEqual([alpha.aid])
    expect(s.foundations.map((f: { id: string }) => f.id)).toEqual([alpha.fid])
    expect(s.activities.every((a: { foundationId: string }) => a.foundationId === alpha.fid)).toBe(true)
    expect((await state(db, 'none@example.com')).projects).toEqual([])
    expect((await state(db, 'admin@example.com')).projects).toHaveLength(2)
    // Their own project: allowed. The other project's activity, whatever id they send: refused, and nothing changes.
    const mine = (await state(db, 'admin@example.com')).activities.find((a: { foundationId: string }) => a.foundationId === alpha.fid)
    const theirs = (await state(db, 'admin@example.com')).activities.find((a: { foundationId: string }) => a.foundationId === beta.fid)
    expect((await cmd(db, 'ed@example.com', 'construction', 'updateActivity', [mine.id, { notes: 'ok' }, TODAY])).status).toBe(200)
    const refused = await cmd(db, 'ed@example.com', 'construction', 'updateActivity', [theirs.id, { notes: 'sneaky' }, TODAY])
    expect(refused).toMatchObject({ status: 403, body: { code: 'project-forbidden' } })
    expect((await state(db, 'admin@example.com')).activities.find((a: { id: string }) => a.id === theirs.id).notes).not.toBe('sneaky')
    // Editors still cannot change project setup, even in their own project.
    expect((await cmd(db, 'ed@example.com', 'construction', 'createArea', [alpha.pid, 'Another', []])).status).toBe(403)
  })

  it('a revoked member loses access on the very next request, even though Cloudflare Access still signs them in; restoring brings them back', async () => {
    const { db, alpha } = await world()
    await invite(db, { email: 'ed@example.com', role: 'editor', projectIds: [alpha.pid] })
    expect((await as(db, 'ed@example.com', 'GET', '/api/state/construction')).status).toBe(200)
    expect((await as(db, 'admin@example.com', 'POST', '/api/members/revoke', { email: 'ed@example.com' })).status).toBe(200)
    expect(status(db, 'ed@example.com')).toBe('revoked')
    expect(await as(db, 'ed@example.com', 'GET', '/api/state/construction')).toMatchObject({ status: 403, body: { code: 'revoked' } })
    const mine = (await state(db, 'admin@example.com')).activities.find((a: { foundationId: string }) => a.foundationId === alpha.fid)
    expect(await cmd(db, 'ed@example.com', 'construction', 'updateActivity', [mine.id, { notes: 'x' }, TODAY])).toMatchObject({ status: 403, body: { code: 'revoked' } })
    expect((await as(db, 'ed@example.com', 'GET', '/api/session')).body).toMatchObject({ role: null, revoked: true })
    expect((await as(db, 'ed@example.com', 'GET', '/api/members')).status).toBe(403)
    // A revoked person cannot be changed until restored; the record and their projects are kept.
    expect((await as(db, 'admin@example.com', 'POST', '/api/members/update', { email: 'ed@example.com', role: 'viewer' })).status).toBe(409)
    expect((await as(db, 'admin@example.com', 'GET', '/api/members')).body.members.find((m: { email: string }) => m.email === 'ed@example.com')).toMatchObject({ status: 'revoked', projectIds: [alpha.pid] })
    await as(db, 'admin@example.com', 'POST', '/api/members/restore', { email: 'ed@example.com' })
    expect(status(db, 'ed@example.com')).toBe('invited')
    expect((await as(db, 'ed@example.com', 'GET', '/api/state/construction')).status).toBe(200)
    expect(status(db, 'ed@example.com')).toBe('active')
  })

  it('there is always one administrator, and nobody revokes themselves; every change is audited', async () => {
    const { db } = await world()
    expect((await as(db, 'admin@example.com', 'POST', '/api/members/revoke', { email: 'admin@example.com' })).status).toBe(409)
    expect((await as(db, 'admin@example.com', 'POST', '/api/members/update', { email: 'admin@example.com', role: 'editor' })).body.code).toBe('last-admin')
    await invite(db, { email: 'two@example.com', role: 'admin' })
    expect((await as(db, 'admin@example.com', 'POST', '/api/members/revoke', { email: 'two@example.com' })).status).toBe(200)
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM role_audit WHERE target = 'two@example.com'").get()).toEqual({ n: 2 })
  })

  it('view only cannot modify data', async () => {
    const { db, alpha } = await world()
    await invite(db, { email: 'v@example.com', role: 'viewer', projectIds: [alpha.pid] })
    const mine = (await state(db, 'admin@example.com')).activities.find((a: { foundationId: string }) => a.foundationId === alpha.fid)
    expect((await state(db, 'v@example.com')).projects).toHaveLength(1)
    expect((await cmd(db, 'v@example.com', 'construction', 'updateActivity', [mine.id, { notes: 'x' }, TODAY])).status).toBe(403)
  })
})

describe('production module locks', () => {
  it('QA/QC, Civil and project fleet changes are refused in production and still work on staging', async () => {
    const { db, alpha } = await world()
    const acts = (await state(db, 'admin@example.com')).activities.filter((a: { foundationId: string }) => a.foundationId === alpha.fid)
    const byCat = (cat: string) => acts.find((a: { scope: string; key: string }) => getDef(a.scope as never, a.key).category === cat)
    const st = await state(db, 'admin@example.com')
    for (const cat of ['qaqc', 'civil']) {
      const a = byCat(cat)
      expect(a, cat).toBeDefined()
      expect(lockedCommandProblem('production', 'construction', 'updateActivity', [a.id, { notes: 'x' }, TODAY], st), cat).toMatch(/coming soon/)
      expect(lockedCommandProblem('staging', 'construction', 'updateActivity', [a.id, { notes: 'x' }, TODAY], st), cat).toBeNull()
      expect((await cmd(db, 'admin@example.com', 'construction', 'updateActivity', [a.id, { notes: 'x' }, TODAY])).status).toBe(200) // staging, over the API
    }
    for (const cat of ['construction', 'survey']) expect(lockedCommandProblem('production', 'construction', 'updateActivity', [byCat(cat).id, { notes: 'y' }, TODAY], st)).toBeNull()
    expect(lockedCommandProblem('production', 'fleet', 'reassignVehicle', ['v', alpha.pid, [alpha.pid], TODAY], st)).toMatch(/Fleet on this project is coming soon/)
    expect(lockedCommandProblem('staging', 'fleet', 'reassignVehicle', ['v', alpha.pid, [alpha.pid], TODAY], st)).toBeNull()
    // production sign-in is WorkOS only, so the end-to-end production check (a WorkOS session) is in workos.test.ts
  })
})
