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
const veh = (u: string) => ({ unitNumber: u, kind: 'vehicle', year: 2022, make: 'Ford', model: 'F-550', vin: '', licencePlate: '', notes: '' })
const acc = (typeId: string | null, over: Record<string, unknown> = {}) => ({ typeId, name: '', description: '', specification: '', cost: null, warranty: '', notes: '', ...over })
const fleet = async (db: TestDb) => (await as(db, 'viewer@example.com', 'GET', '/api/state/fleet')).body.state

describe('accessory type directory', () => {
  it('adds an accessory by type alone; two vehicles share a type but keep separate records', async () => {
    const db = await fresh()
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('T6010'), null, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('T6005'), null, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', ['Tidy Tank'])).status).toBe(200)
    let f = await fleet(db)
    const type = f.accessoryTypes[0]
    expect(type).toMatchObject({ name: 'Tidy Tank', archived: false })
    const [a, b] = f.vehicles.map((v: { id: string }) => v.id)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessory', [a, acc(type.id, { specification: '750 L', description: 'Aluminum fuel tank' }), { date: null, odometer: null }, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessory', [b, acc(type.id, { specification: '500 L' }), { date: null, odometer: null }, TODAY])).status).toBe(200)
    f = await fleet(db) // read back from D1: persistence
    expect(f.accessories).toHaveLength(2)
    expect(f.accessories.map((x: { typeId: string; name: string }) => [x.typeId, x.name])).toEqual([[type.id, ''], [type.id, '']])
    expect(f.accessories.map((x: { specification: string }) => x.specification)).toEqual(['750 L', '500 L'])
    expect(new Set(f.accessories.map((x: { placements: { vehicleId: string }[] }) => x.placements[0].vehicleId))).toEqual(new Set([a, b]))
    expect(f.accessories[0].id).not.toBe(f.accessories[1].id)
  })

  it('refuses duplicate type names (case, spacing) but keeps similar spellings distinct', async () => {
    const db = await fresh()
    await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', ['Tidy Tank'])
    for (const dup of ['tidy tank', '  TIDY   tank ']) expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', [dup])).status).toBe(422)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', ['Tidy Tanks'])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', ['x'])).status).toBe(422)
    expect(count(db, 'accessory_types')).toBe(2)
  })

  it('only admins rename and archive; archived types stay on accessories but are refused for new ones; renaming updates everywhere', async () => {
    const db = await fresh()
    await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('T6010'), null, TODAY])
    await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', ['Tidy Tank'])
    let f = await fleet(db); const id = f.accessoryTypes[0].id; const v = f.vehicles[0].id
    await cmd(db, 'editor@example.com', 'fleet', 'addAccessory', [v, acc(id), { date: null, odometer: null }, TODAY])
    expect((await cmd(db, 'editor@example.com', 'fleet', 'renameAccessoryType', [id, 'Fuel Tank'])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'setAccessoryTypeArchived', [id, true])).status).toBe(403)
    expect((await cmd(db, 'viewer@example.com', 'fleet', 'addAccessoryType', ['Radio'])).status).toBe(403)
    expect((await cmd(db, 'viewer@example.com', 'fleet', 'addAccessory', [v, acc(id), { date: null, odometer: null }, TODAY])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'fleet', 'renameAccessoryType', [id, 'Fuel Tank'])).status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'fleet', 'setAccessoryTypeArchived', [id, true])).status).toBe(200)
    f = await fleet(db)
    expect(f.accessoryTypes[0]).toMatchObject({ id, name: 'Fuel Tank', archived: true })
    expect(f.accessories[0].typeId).toBe(id)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessory', [v, acc(id), { date: null, odometer: null }, TODAY])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'fleet', 'setAccessoryTypeArchived', [id, false])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addAccessory', [v, acc(id), { date: null, odometer: null }, TODAY])).status).toBe(200)
  })

  it('a type in use cannot be removed from the database', async () => {
    const db = await fresh()
    await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('T6010'), null, TODAY])
    await cmd(db, 'editor@example.com', 'fleet', 'addAccessoryType', ['Tidy Tank'])
    const f = await fleet(db)
    await cmd(db, 'editor@example.com', 'fleet', 'addAccessory', [f.vehicles[0].id, acc(f.accessoryTypes[0].id), { date: null, odometer: null }, TODAY])
    expect(() => db.raw.exec('DELETE FROM accessory_types')).toThrow()
  })
})

describe('migration 0009', () => {
  it('links legacy accessories by their category, keeps custom names and blanks only names that repeat the type', () => {
    const db = createTestDb({ migrate: false })
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql']) applyMigrationFile(db.raw, f)
    db.raw.exec("DELETE FROM accessory_placements; DELETE FROM accessories;")
    db.raw.exec(`INSERT INTO accessories (id, name, category, description, specification, seq) VALUES
      ('a1', 'Tidy Tank', 'tidy-tank', 'old', '750 L', 0), ('a2', '500 L fuel unit', 'tidy-tank', '', '500 L', 1), ('a3', 'Spotlight', 'other', '', '', 2), ('a4', 'Light bar', 'light-bar', '', '', 3)`)
    applyMigrationFile(db.raw, '0009_accessory_type_directory.sql')
    expect(db.raw.prepare('SELECT id, name FROM accessory_types ORDER BY id').all()).toEqual([{ id: 'aty-light-bar', name: 'Light bar' }, { id: 'aty-tidy-tank', name: 'Tidy tank' }])
    expect(db.raw.prepare('SELECT id, type_id AS t, name, description FROM accessories ORDER BY id').all()).toEqual([
      { id: 'a1', t: 'aty-tidy-tank', name: '', description: 'old' }, { id: 'a2', t: 'aty-tidy-tank', name: '500 L fuel unit', description: '' },
      { id: 'a3', t: null, name: 'Spotlight', description: '' }, { id: 'a4', t: 'aty-light-bar', name: '', description: '' }])
    expect(count(db, 'accessories')).toBe(4)
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '9' })
  })
})
