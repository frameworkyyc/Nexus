import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW, TODAY } from './helpers'
import { applyMigrationFile, createTestDb, type TestDb } from './sqliteD1'

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
  as(db, email, 'POST', '/api/commands', { module, name, args, requestId: `req-onb-${Date.now().toString(36)}-${n++}-xxxxxxxx`, clientToday: TODAY }, env)
const give = (db: TestDb, email: string, role: string) => db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, 'test', '2026-10-21T00:00:00Z')").run(email, role)
const count = (db: TestDb, table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const fresh = async () => { const db = createTestDb({ seed: false }); give(db, 'admin@example.com', 'admin'); give(db, 'editor@example.com', 'editor'); give(db, 'viewer@example.com', 'viewer'); await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }]); return db }
const state = async (db: TestDb) => (await as(db, 'viewer@example.com', 'GET', '/api/state/construction')).body.state
const dims = (l: number, w: number, h: number, unit = 'm') => ({ length: l, width: w, height: h, unit })

async function setup() {
  const db = await fresh()
  const pid = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'Plant' }])).body.state.projects[0].id
  await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, 'E-House', []])
  const aid = (await state(db)).areas[0].id
  await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [pid, 'A', 'Type A'])
  await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [pid, 'B', 'Type B'])
  const [A, B] = (await state(db)).anchorageTypes.map((t: { id: string }) => t.id)
  const r = await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'OP-101', '', null, 18, { footing: dims(4, 3, 0.5), groups: [{ anchorageTypeId: A, count: 2, dims: dims(0.5, 0.5, 0.8) }, { anchorageTypeId: B, count: 1, dims: dims(600, 600, 1000, 'mm') }] }])
  expect(r.status).toBe(200)
  const f = (await state(db)).foundations[0]
  return { db, pid, aid, A, B, f }
}

describe('foundation configuration and pours on the server', () => {
  it('stores groups, dimensions and plinth references; reloads identically', async () => {
    const { db, A, B, f } = await setup()
    const s = await state(db)
    expect(f).toMatchObject({ quantity: 18, plinthsPerFoundation: 3, footing: { length: 4, width: 3, height: 0.5, unit: 'm' } })
    expect(s.anchorageGroups.map((g: { anchorageTypeId: string; count: number }) => [g.anchorageTypeId, g.count])).toEqual([[A, 2], [B, 1]])
    expect(s.plinths).toHaveLength(3)
    expect(db.raw.prepare('SELECT footing_length, footing_unit, plinth_base FROM foundations').get()).toEqual({ footing_length: 4, footing_unit: 'm', plinth_base: 'above-footing' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM plinths WHERE group_id IS NOT NULL').get()).toEqual({ n: 3 })
  })

  it('only admins configure foundations and override completion; editors plan and record pours; viewers only read', async () => {
    const { db, pid, f } = await setup()
    expect((await cmd(db, 'editor@example.com', 'construction', 'configureFoundation', [f.id, { footing: null }])).status).toBe(403)
    expect((await cmd(db, 'viewer@example.com', 'construction', 'createPour', [pid, 'Week 12', null, 0])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'construction', 'createPour', [pid, 'Week 12', '2026-11-02', 5])).status).toBe(200)
    const pour = (await state(db)).pours[0]
    expect((await cmd(db, 'editor@example.com', 'construction', 'addPourItems', [pour.id, [{ foundationId: f.id, units: [1, 2, 3], components: 'both' }]])).status).toBe(200)
    const items = (await state(db)).pourItems
    expect(items).toHaveLength(12)
    const plinth = items.find((i: { component: string }) => i.component === 'plinth')
    const fail = await cmd(db, 'editor@example.com', 'construction', 'recordPour', [plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, TODAY])
    expect(fail.status).toBe(422)
    expect((await cmd(db, 'editor@example.com', 'construction', 'recordPourOverride', [plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, 'Poured early by agreement', TODAY])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'recordPourOverride', [plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, 'Poured early by agreement', TODAY])).status).toBe(200)
    expect(db.raw.prepare("SELECT override_reason, override_by FROM pour_items WHERE completed_date IS NOT NULL").get()).toEqual({ override_reason: 'Poured early by agreement', override_by: 'admin@example.com' })
  })

  it('partial pours and completion persist; the database also refuses a duplicate completion', async () => {
    const { db, pid, f } = await setup()
    await cmd(db, 'editor@example.com', 'construction', 'createPour', [pid, 'Footings', null, 0])
    const pour = (await state(db)).pours[0]
    await cmd(db, 'editor@example.com', 'construction', 'addPourItems', [pour.id, [{ foundationId: f.id, units: [1, 2], components: 'footing' }]])
    const [a, b] = (await state(db)).pourItems
    expect((await cmd(db, 'editor@example.com', 'construction', 'recordPour', [a.id, { pouredM3: 3, complete: false, date: null }, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'construction', 'recordPour', [b.id, { pouredM3: 6, complete: true, date: TODAY }, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'construction', 'completePour', [pour.id, TODAY, TODAY])).status).toBe(200)
    const s = await state(db)
    expect(s.pours[0]).toMatchObject({ status: 'completed', completedDate: TODAY })
    expect(s.pourItems.map((i: { pouredM3: number; completedDate: string | null }) => [i.pouredM3, i.completedDate])).toEqual([[3, null], [6, TODAY]])
    expect(() => db.raw.exec(`INSERT INTO pour_items (id, pour_id, foundation_id, unit_no, component, plinth_id, component_key, completed_date, seq) VALUES ('dup', '${pour.id}', '${f.id}', 2, 'footing', NULL, 'footing', '${TODAY}', 9)`)).toThrow()
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('refuses an edit that would remove a plinth with pour records, and keeps every id', async () => {
    const { db, pid, f, A, B } = await setup()
    await cmd(db, 'editor@example.com', 'construction', 'createPour', [pid, 'Pour A', null, 0])
    const pour = (await state(db)).pours[0]
    await cmd(db, 'editor@example.com', 'construction', 'addPourItems', [pour.id, [{ foundationId: f.id, units: [1], components: 'plinth' }]])
    const before = (await state(db)).plinths.map((p: { id: string }) => p.id)
    const gs = (await state(db)).anchorageGroups
    const r = await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [f.id, { groups: [{ id: gs[0].id, anchorageTypeId: A, count: 1 }, { id: gs[1].id, anchorageTypeId: B, count: 1 }] }])
    expect(r.status).toBe(422)
    expect((await state(db)).plinths.map((p: { id: string }) => p.id)).toEqual(before)
  })
})

describe('migration 0010', () => {
  it('turns existing plinths into anchorage groups without changing any plinth, assignment or record', () => {
    const db = createTestDb({ migrate: false })
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql']) applyMigrationFile(db.raw, f)
    db.raw.exec("INSERT INTO companies (id, name) VALUES ('c', 'C'); INSERT INTO projects (id, company_id, name, job_number, status) VALUES ('p', 'c', 'P', '1', 'planning'); INSERT INTO areas (id, project_id, name, sequence) VALUES ('a', 'p', 'A', 1)")
    db.raw.exec("INSERT INTO anchorage_types (id, project_id, code, description, seq) VALUES ('t1', 'p', 'T1', '', 0)")
    db.raw.exec("INSERT INTO foundations (id, area_id, number, description, notes, seq) VALUES ('f1', 'a', '1', '', '', 0), ('f2', 'a', '2', '', '', 1)")
    db.raw.exec("INSERT INTO plinths (id, foundation_id, idx, anchorage_type_id, notes, seq) VALUES ('f1-p1', 'f1', 1, 't1', 'n', 0), ('f1-p2', 'f1', 2, 't1', '', 1), ('f1-p3', 'f1', 3, NULL, '', 2), ('f2-p1', 'f2', 1, NULL, '', 3)")
    const before = db.raw.prepare('SELECT id, foundation_id, idx, anchorage_type_id, notes FROM plinths ORDER BY id').all()
    applyMigrationFile(db.raw, '0010_foundation_configuration_and_pours.sql')
    expect(db.raw.prepare('SELECT id, foundation_id, idx, anchorage_type_id, notes FROM plinths ORDER BY id').all()).toEqual(before)
    expect(db.raw.prepare('SELECT foundation_id, anchorage_type_id AS t, plinth_count AS n FROM foundation_anchorage_groups ORDER BY foundation_id, seq').all()).toEqual([{ foundation_id: 'f1', t: 't1', n: 2 }, { foundation_id: 'f1', t: null, n: 1 }, { foundation_id: 'f2', t: null, n: 1 }])
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM plinths WHERE group_id IS NULL').get()).toEqual({ n: 0 })
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '10' })
    expect(count(db, 'foundations')).toBe(2)
  })
})
