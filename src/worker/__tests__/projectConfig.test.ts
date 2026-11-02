import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW, TODAY } from './helpers'
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
async function as(db: TestDb, email: string, method: string, path: string, body?: unknown, env: Partial<Env> = {}) {
  resetAuthCache()
  const full: Env = { DB: db.d1, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, NEXUS_ENV: 'staging', ...env }
  const res = await handleApi(new Request(`https://staging.nexus.example${path}`, { method, headers: { 'cf-access-jwt-assertion': await token(email), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), full, clock(), certs)
  return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}
let n = 0
const cmd = (db: TestDb, email: string, module: string, name: string, args: unknown[], env: Partial<Env> = {}) =>
  as(db, email, 'POST', '/api/commands', { module, name, args, requestId: `req-pc-${Date.now().toString(36)}-${n++}-xxxxxxxx`, clientToday: TODAY }, env)
const give = (db: TestDb, email: string, role: string) => db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, 'test', '2026-10-21T00:00:00Z')").run(email, role)

const count = (db: TestDb, table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const get = async (db: TestDb, email = 'viewer@example.com') => (await as(db, email, 'GET', '/api/state/construction')).body.state
const fresh = async () => {
  const db = createTestDb({ seed: false })
  give(db, 'admin@example.com', 'admin'); give(db, 'editor@example.com', 'editor'); give(db, 'viewer@example.com', 'viewer'); give(db, 'scoped@example.com', 'editor')
  await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }])
  return db
}
const post = (db: TestDb, who: string, name: string, args: unknown[]) => cmd(db, who, 'construction', name, args)

async function twoProjects() {
  const db = await fresh()
  await post(db, 'admin@example.com', 'createProject', [{ name: 'REEF' }])
  let st = await get(db)
  const reef = st.projects[0].id
  await post(db, 'admin@example.com', 'createArea', [reef, 'Area A', [{ number: 'F-1', plinthCount: 0 }]])
  await post(db, 'admin@example.com', 'createProject', [{ name: 'Grouting job', template: 'grouting-only' }])
  st = await get(db)
  const grout = st.projects.find((p: { name: string }) => p.name === 'Grouting job').id
  expect((await post(db, 'admin@example.com', 'createFoundation', [grout, 'P-101', 'Pump base', null, 1])).status).toBe(200)
  return { db, reef, grout }
}

describe('migration 0031', () => {
  it('is additive: existing projects keep areas, no settings rows, no activity rows change', async () => {
    const db = createTestDb({ seed: false })
    expect(count(db, 'project_settings')).toBe(0)
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '31' })
    const cols = (t: string) => (db.raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string; dflt_value: string }[])
    expect(cols('projects').find((c) => c.name === 'use_areas')!.dflt_value).toBe('1')
    expect(cols('projects').find((c) => c.name === 'archived')!.dflt_value).toBe('0')
    expect(cols('areas').find((c) => c.name === 'implicit')!.dflt_value).toBe('0')
  })
})

describe('project configuration on the server', () => {
  it('a project created from a template persists its settings and its hidden area, and reloads the same', async () => {
    const { db, grout } = await twoProjects()
    expect(db.raw.prepare('SELECT use_areas, archived, template FROM projects WHERE id = ?').get(grout)).toEqual({ use_areas: 0, archived: 0, template: 'grouting-only' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM areas WHERE project_id = ? AND implicit = 1').get(grout)).toEqual({ n: 1 })
    expect(db.raw.prepare("SELECT key, enabled FROM project_settings WHERE project_id = ? AND key LIKE 'scope:%' ORDER BY key").all(grout)).toContainEqual({ key: 'scope:grouted', enabled: 1 })
    const st = await get(db)
    const p = st.projects.find((x: { id: string }) => x.id === grout)
    expect(p).toMatchObject({ useAreas: false, template: 'grouting-only', modules: { survey: false, procurement: false, progress: true }, scopeItems: { grouted: true, poured: false } })
    // The unconfigured project reads exactly as before.
    const reef = st.projects.find((x: { name: string }) => x.name === 'REEF')
    expect(reef.useAreas).toBeUndefined() // the default template: areas on
    expect(reef.scopeItems).toMatchObject({ poured: true, equipmentSet: false, grouted: false })
    expect(reef.archived).toBeUndefined()
  })

  it('switching a module off keeps the recorded activity in the database, and switching it on returns it', async () => {
    const { db, reef } = await twoProjects()
    const st = await get(db)
    const f = st.foundations.find((x: { number: string }) => x.number === 'F-1')
    expect((await post(db, 'admin@example.com', 'updateActivity', [`${f.id}:layout`, { status: 'complete' }, TODAY])).status).toBe(200)
    expect((await post(db, 'admin@example.com', 'updateProjectSettings', [reef, { modules: { survey: false } }])).status).toBe(200)
    expect(db.raw.prepare('SELECT status FROM activities WHERE id = ?').get(`${f.id}:layout`)).toEqual({ status: 'complete' }) // kept
    expect((await post(db, 'admin@example.com', 'updateActivity', [`${f.id}:layout`, { status: 'not-started' }, TODAY])).status).toBe(422) // server refuses edits outside the scope
    expect((await post(db, 'admin@example.com', 'updateProjectSettings', [reef, { modules: { survey: true } }])).status).toBe(200)
    expect(db.raw.prepare('SELECT status FROM activities WHERE id = ?').get(`${f.id}:layout`)).toEqual({ status: 'complete' })
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('archive, restore, edit and delete need an Admin; viewers and editors are refused', async () => {
    const { db, grout } = await twoProjects()
    for (const who of ['viewer@example.com', 'editor@example.com']) {
      for (const [name, args] of [['updateProjectSettings', [grout, { useAreas: true }]], ['archiveProject', [grout, true]], ['deleteProject', [grout, 'Grouting job']], ['updateProject', [grout, { description: 'x' }]]] as [string, unknown[]][]) {
        expect((await post(db, who, name, args)).status, `${who} ${name}`).toBe(403)
      }
    }
    expect(db.raw.prepare('SELECT archived FROM projects WHERE id = ?').get(grout)).toEqual({ archived: 0 })
    expect((await post(db, 'admin@example.com', 'updateProject', [grout, { description: 'Pump bases' }])).status).toBe(200)
    expect((await post(db, 'admin@example.com', 'archiveProject', [grout, true])).status).toBe(200)
    expect(db.raw.prepare('SELECT archived FROM projects WHERE id = ?').get(grout)).toEqual({ archived: 1 })
    expect((await post(db, 'admin@example.com', 'archiveProject', [grout, false])).status).toBe(200)
    expect(db.raw.prepare('SELECT archived FROM projects WHERE id = ?').get(grout)).toEqual({ archived: 0 })
  })

  it('delete is refused until archived and named, then removes only that project\'s records', async () => {
    const { db, reef, grout } = await twoProjects()
    expect((await post(db, 'admin@example.com', 'deleteProject', [grout, 'Grouting job'])).status).toBe(422) // not archived
    await post(db, 'admin@example.com', 'archiveProject', [grout, true])
    expect((await post(db, 'admin@example.com', 'deleteProject', [grout, 'wrong'])).status).toBe(422)
    const before = { reefFoundations: db.raw.prepare('SELECT COUNT(*) AS n FROM foundations f JOIN areas a ON a.id = f.area_id WHERE a.project_id = ?').get(reef) }
    const res = await post(db, 'admin@example.com', 'deleteProject', [grout, 'Grouting job'])
    expect(res.status).toBe(200)
    for (const t of ['projects', 'areas']) expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${t === 'projects' ? 'id' : 'project_id'} = ?`).get(grout)).toEqual({ n: 0 })
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM project_settings WHERE project_id = ?").get(grout)).toEqual({ n: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM foundations WHERE number = ?').get('P-101')).toEqual({ n: 0 })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM foundations f JOIN areas a ON a.id = f.area_id WHERE a.project_id = ?').get(reef)).toEqual(before.reefFoundations)
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('a user assigned to one project cannot read or change the other, whatever the interface hides', async () => {
    const { db, reef, grout } = await twoProjects()
    db.raw.prepare("DELETE FROM user_projects WHERE email = 'scoped@example.com'").run()
    db.raw.prepare("INSERT INTO user_projects (email, project_id, assigned_by, assigned_at) VALUES ('scoped@example.com', ?, 'test', '')").run(grout)
    const st = await get(db, 'scoped@example.com')
    expect(st.projects.map((p: { id: string }) => p.id)).toEqual([grout])
    expect(st.foundations.map((f: { number: string }) => f.number)).toEqual(['P-101'])
    const fReef = (await get(db)).foundations.find((f: { number: string }) => f.number === 'F-1')
    expect((await post(db, 'scoped@example.com', 'updateActivity', [`${fReef.id}:layout`, { status: 'complete' }, TODAY])).status).toBe(403)
    expect((await post(db, 'scoped@example.com', 'updateActivity', [`${(st.foundations[0]).id}:grouted`, { status: 'complete' }, TODAY])).status).toBe(200)
    expect((await post(db, 'scoped@example.com', 'updateProjectSettings', [reef, { useAreas: false }])).status).toBe(403) // not an Admin
  })

  it('areas cannot be switched off while foundations sit in several areas', async () => {
    const { db, reef } = await twoProjects()
    await post(db, 'admin@example.com', 'createArea', [reef, 'Area B', [{ number: 'F-2', plinthCount: 0 }]])
    const res = await post(db, 'admin@example.com', 'updateProjectSettings', [reef, { useAreas: false }])
    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body)).toMatch(/Move them into one area/)
  })
})
