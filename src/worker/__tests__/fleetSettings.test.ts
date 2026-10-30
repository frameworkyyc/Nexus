import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW, TODAY } from './helpers'
import { applyMigrationFile, applySeeds, createTestDb, type TestDb } from './sqliteD1'

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
const fresh = async () => { const db = createTestDb({ seed: false }); give(db, 'admin@example.com', 'admin'); give(db, 'editor@example.com', 'editor'); give(db, 'viewer@example.com', 'viewer'); await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }]); return db }
const veh = (u: string, kind = 'vehicle', meterUnit = 'km') => ({ unitNumber: u, kind, year: 2022, make: 'Ford', model: 'F-550', vin: '', licencePlate: '', notes: '', meterUnit })
const fleet = async (db: TestDb) => (await as(db, 'viewer@example.com', 'GET', '/api/state/fleet')).body.state
const insp = (over: Record<string, unknown> = {}) => ({ date: '2026-10-20', submittedBy: 'Sam', notes: '', defects: [], ...over })

describe('fleet lifespan settings and inspections on the server', () => {
  it('categories are an admin setting; any editor can assign an asset and set its own estimate; everything persists', async () => {
    const db = await fresh()
    await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('T6010'), null, TODAY])
    const v = (await fleet(db)).vehicles[0].id
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addFleetCategory', ['Trucks', 'km', 180000])).status).toBe(403)
    expect((await cmd(db, 'viewer@example.com', 'fleet', 'addFleetCategory', ['Trucks', 'km', 180000])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'fleet', 'addFleetCategory', ['Trucks', 'km', 180000])).status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'fleet', 'addFleetCategory', [' trucks', 'km', null])).status).toBe(422)
    const cat = (await fleet(db)).categories[0]
    expect(cat).toMatchObject({ name: 'Trucks', meterUnit: 'km', defaultLife: 180000, archived: false })
    expect((await cmd(db, 'viewer@example.com', 'fleet', 'setVehicleCategory', [v, cat.id])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'setVehicleCategory', [v, cat.id])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'setVehiclePlanning', [v, { expectedLifeKm: 150000, inspectionIntervalDays: null }])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'updateFleetCategory', [cat.id, { defaultLife: 1 }])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'fleet', 'updateFleetCategory', [cat.id, { defaultLife: 200000 }])).status).toBe(200)
    expect(db.raw.prepare('SELECT category_id, expected_life_km, meter_unit FROM vehicles').get()).toEqual({ category_id: cat.id, expected_life_km: 150000, meter_unit: 'km' })
    expect(db.raw.prepare('SELECT default_life FROM fleet_categories').get()).toEqual({ default_life: 200000 })
  })

  it('an inspection updates the meter, schedules the next oil change without recording one, and stays only submitted', async () => {
    const db = await fresh()
    await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('T6010'), null, TODAY])
    const v = (await fleet(db)).vehicles[0].id
    expect((await cmd(db, 'viewer@example.com', 'fleet', 'submitInspection', [v, insp({ meterReading: 100000 }), TODAY])).status).toBe(403)
    const r = await cmd(db, 'editor@example.com', 'fleet', 'submitInspection', [v, insp({ meterReading: 100000, nextOilDue: 105000, reportedCondition: 'fair', defects: ['Leak'] }), TODAY])
    expect(r.status).toBe(200)
    expect(db.raw.prepare('SELECT meter_reading, reported_condition, next_oil_due, review, condition FROM inspections').get()).toEqual({ meter_reading: 100000, reported_condition: 'fair', next_oil_due: 105000, review: 'submitted', condition: null })
    expect(db.raw.prepare('SELECT reading, unit, review FROM odometer_readings').get()).toEqual({ reading: 100000, unit: 'km', review: 'valid' })
    expect(db.raw.prepare('SELECT odometer, service_type FROM service_targets').get()).toEqual({ odometer: 105000, service_type: 'Oil change' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM maintenance_records').get()).toEqual({ n: 0 })
    // an older inspection cannot replace the newer reading
    await cmd(db, 'editor@example.com', 'fleet', 'recordOdometer', [v, { date: '2026-10-21', reading: 101000, note: '' }, TODAY])
    expect((await cmd(db, 'editor@example.com', 'fleet', 'submitInspection', [v, insp({ date: '2026-10-15', meterReading: 120000 }), TODAY])).status).toBe(200)
    expect(db.raw.prepare("SELECT review FROM odometer_readings WHERE reading = 120000").get()).toEqual({ review: 'needs-review' })
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('equipment counts operating hours with one decimal', async () => {
    const db = await fresh()
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [veh('EX-1', 'equipment', 'h'), null, TODAY])).status).toBe(200)
    const v = (await fleet(db)).vehicles[0]
    expect(v.meterUnit).toBe('h')
    expect((await cmd(db, 'editor@example.com', 'fleet', 'submitInspection', [v.id, insp({ meterReading: 1234.5, nextOilDue: 1500 }), TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'recordOdometer', [v.id, { date: '2026-10-21', reading: 1235.55, note: '' }, TODAY])).status).toBe(422)
    expect(db.raw.prepare('SELECT reading, unit FROM odometer_readings').get()).toEqual({ reading: 1234.5, unit: 'h' })
    expect((await cmd(db, 'editor@example.com', 'fleet', 'setVehicleMeterUnit', [v.id, 'km'])).status).toBe(422)
  })
})

describe('migration 0011', () => {
  it('keeps every existing meter reading and vehicle exactly, and adds the new columns with safe defaults', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    applySeeds(db.raw)
    const before = db.raw.prepare('SELECT * FROM odometer_readings ORDER BY id').all()
    const vehicles = db.raw.prepare('SELECT id, unit_number, expected_life_km FROM vehicles ORDER BY id').all()
    expect(before.length).toBeGreaterThan(0)
    applyMigrationFile(db.raw, '0011_fleet_lifespan_settings_and_inspection_readings.sql')
    expect(db.raw.prepare('SELECT * FROM odometer_readings ORDER BY id').all()).toEqual(before)
    expect(db.raw.prepare('SELECT id, unit_number, expected_life_km FROM vehicles ORDER BY id').all()).toEqual(vehicles)
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM vehicles WHERE meter_unit = 'km' AND category_id IS NULL").get()).toEqual({ n: vehicles.length })
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM inspections WHERE meter_reading IS NULL AND reported_condition IS NULL AND next_oil_due IS NULL").get()).toEqual(db.raw.prepare('SELECT COUNT(*) AS n FROM inspections').get())
    db.raw.exec("INSERT INTO odometer_readings (id, vehicle_id, reading_date, reading, unit, review, seq) VALUES ('h1', (SELECT id FROM vehicles LIMIT 1), '2026-10-01', 12.5, 'h', 'valid', 999)")
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '11' })
  })
})
