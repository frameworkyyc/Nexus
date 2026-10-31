import { readdirSync } from 'node:fs'
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
import { refreshRequirements } from '@/domains/construction/tracker/requirements'
import { procurementRows } from '@/domains/construction/tracker/procurement'
const count = (db: TestDb, table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const fresh = async () => { const db = createTestDb({ seed: false }); give(db, 'admin@example.com', 'admin'); give(db, 'editor@example.com', 'editor'); give(db, 'viewer@example.com', 'viewer'); await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }]); return db }
const get = async (db: TestDb, module: string) => (await as(db, 'viewer@example.com', 'GET', `/api/state/${module}`)).body.state
const bolt = { kind: 'bolt', qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm', thread: 'both-ends', topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }

async function setup() {
  const db = await fresh()
  const pid = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'Plant' }])).body.state.projects[0].id
  await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, 'E-House', []])
  await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [pid, 'A', 'Type A'])
  const c0 = await get(db, 'construction')
  const A = c0.anchorageTypes[0].id; const aid = c0.areas[0].id
  expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [bolt, { kind: 'template', qty: 1, spec: '19 mm plywood' }]])).status).toBe(200)
  expect((await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'OP-1', '', null, 12, { groups: [{ anchorageTypeId: A, count: 3 }] }])).status).toBe(200)
  return { db, pid, A, aid }
}

describe('anchorage library → material requirements on the server', () => {
  it('only admins configure anchorage types', async () => {
    const { db, A } = await setup()
    expect((await cmd(db, 'editor@example.com', 'construction', 'setAnchorageComponents', [A, []])).status).toBe(403)
    expect((await cmd(db, 'viewer@example.com', 'construction', 'setAnchorageComponents', [A, []])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [{ ...bolt, diameter: '' }]])).status).toBe(422)
    expect(db.raw.prepare('SELECT kind, qty, diameter, length, thread, top_thread, nuts_per_bolt FROM anchorage_components ORDER BY seq').all()).toEqual([
      { kind: 'bolt', qty: 4, diameter: 'M25', length: 900, thread: 'both-ends', top_thread: 100, nuts_per_bolt: 2 }, { kind: 'template', qty: 1, diameter: '', length: null, thread: null, top_thread: null, nuts_per_bolt: 0 }])
  })

  it('a delivery on a calculated requirement is saved once, with who and when; recalculation never touches it', async () => {
    const { db, A } = await setup()
    // What the app shows: the saved records with the calculated requirements brought up to date.
    const view = () => get(db, 'materials').then(async (m) => refreshRequirements(m, await get(db, 'construction'), { log: false }))
    let t = await view()
    const nut = t.manual.find((l: { component: string }) => l.component === 'Nut')!
    expect(nut.requiredQty).toBe(288)
    expect(count(db, 'manual_materials')).toBe(0) // calculated, not yet acted on: nothing stored
    expect((await cmd(db, 'viewer@example.com', 'materials', 'addReceipt', [nut.id, { date: '2026-10-20', qty: 100, reference: 'DN-1', note: '' }, TODAY])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'addReceipt', [nut.id, { date: '2026-10-20', qty: 100, reference: 'DN-1', note: 'checked' }, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'materials', 'addReceipt', [nut.id, { date: '2026-10-21', qty: 88, reference: 'DN-2', note: '' }, TODAY])).status).toBe(200)
    expect(count(db, 'manual_materials')).toBe(4) // the four calculated requirements, each once
    const rec = db.raw.prepare("SELECT receipt_date, qty, reference, recorded_by, recorded_at FROM manual_material_receipts ORDER BY seq").all() as { recorded_by: string; recorded_at: string }[]
    expect(rec).toHaveLength(2)
    expect(rec[0]).toMatchObject({ qty: 100, reference: 'DN-1', recorded_by: 'editor@example.com' })
    expect(rec[0].recorded_at).toMatch(/^2026-10-/)
    expect(db.raw.prepare("SELECT origin, qty_basis, requirement_removed FROM manual_materials WHERE id = ?").get(nut.id)).toEqual({ origin: 'anchorage', qty_basis: 'fixed', requirement_removed: 0 })
    // the foundation grows: the requirement follows, the deliveries stay
    const c = await get(db, 'construction')
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [c.foundations[0].id, { quantity: 20 }])).status).toBe(200)
    t = await view()
    expect(t.manual.find((l: { id: string }) => l.id === nut.id)).toMatchObject({ requiredQty: 480 })
    expect((await cmd(db, 'editor@example.com', 'materials', 'setOrdered', [nut.id, 480])).status).toBe(200) // an ordinary change persists the recalculation and logs it
    const saved = db.raw.prepare('SELECT required_qty, ordered_qty FROM manual_materials WHERE id = ?').get(nut.id)
    expect(saved).toEqual({ required_qty: 480, ordered_qty: 480 })
    expect(count(db, 'manual_material_receipts')).toBe(2)
    expect(db.raw.prepare("SELECT summary FROM material_audit WHERE material_id = ? AND action = 'quantity'").all(nut.id).length).toBeGreaterThan(0)
    // the configuration changes so the nuts no longer apply: kept, flagged, with its deliveries
    expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [{ ...bolt, nutsPerBolt: 0 }]])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'materials', 'setNotes', [nut.id, 'spec changed'])).status).toBe(200)
    expect(db.raw.prepare('SELECT required_qty, requirement_removed, ordered_qty FROM manual_materials WHERE id = ?').get(nut.id)).toEqual({ required_qty: 0, requirement_removed: 1, ordered_qty: 480 })
    expect(count(db, 'manual_material_receipts')).toBe(2)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('quantities entered per plinth are calculated and saved, and the server enforces the same rules', async () => {
    const { db, aid } = await setup()
    const f = (await get(db, 'construction')).foundations[0].id
    const item = { areaId: aid, foundationId: f, anchorageTypeId: '', category: 'other', name: 'Grout', description: '', specification: '', size: '', requiredQty: 2, basis: 'per-plinth', unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '' }
    expect((await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[item]])).status).toBe(200)
    expect(db.raw.prepare('SELECT required_qty, qty_basis, qty_each FROM manual_materials WHERE name = ?').get('Grout')).toEqual({ required_qty: 72, qty_basis: 'per-plinth', qty_each: 2 }) // 2 × 12 × 3
    expect((await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[{ ...item, name: 'Grout 2', foundationId: '' }]])).status).toBe(422)
  })
})

describe('migration 0012', () => {
  it('keeps existing materials and deliveries exactly, adds the new columns with safe defaults', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec("INSERT INTO manual_materials (id, area, category, name, required_qty, ordered_qty, seq) VALUES ('mm-1', 'Area', 'bolt', 'Bolt', 10, 8, 0)")
    db.raw.exec("INSERT INTO manual_material_receipts (id, material_id, receipt_date, qty, reference, note, recorded_by, seq) VALUES ('r-1', 'mm-1', '2026-10-01', 5, 'DN', '', 'a@example.com', 0)")
    const before = [db.raw.prepare('SELECT * FROM manual_materials').all(), db.raw.prepare('SELECT * FROM manual_material_receipts').all()]
    applyMigrationFile(db.raw, '0012_anchorage_components_requirements_deliveries.sql')
    const m = db.raw.prepare('SELECT * FROM manual_materials').get() as Record<string, unknown>
    for (const [k, v] of Object.entries(before[0][0] as Record<string, unknown>)) expect(m[k]).toEqual(v)
    expect(m).toMatchObject({ origin: 'manual', derive_key: null, qty_basis: 'fixed', qty_each: null, calc_json: '', requirement_removed: 0 })
    const r = db.raw.prepare('SELECT * FROM manual_material_receipts').get() as Record<string, unknown>
    for (const [k, v] of Object.entries(before[1][0] as Record<string, unknown>)) expect(r[k]).toEqual(v)
    expect(r.recorded_at).toBe('')
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '12' })
    expect(() => db.raw.exec("INSERT INTO manual_materials (id, area, category, name, required_qty, derive_key, origin, seq) VALUES ('d1', 'A', 'nut', 'Nut', 1, 'k', 'anchorage', 1), ('d2', 'A', 'nut', 'Nut', 1, 'k', 'anchorage', 2)")).toThrow() // one row per calculated requirement
  })
})

describe('migration 0013', () => {
  it('adds the centre hole column; existing sole plates keep no hole', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec('PRAGMA foreign_keys = OFF') // only the column is under test, not the project it hangs off
    db.raw.exec("INSERT INTO anchorage_types (id, project_id, code, description, seq) VALUES ('at-1', 'p-1', 'A', 'A', 0)")
    db.raw.exec("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, size, seq) VALUES ('c-1', 'at-1', 'sole-plate', 2, '300 x 300', 0)")
    applyMigrationFile(db.raw, '0013_sole_plate_center_hole.sql')
    expect(db.raw.prepare('SELECT qty, size, center_hole FROM anchorage_components').get()).toEqual({ qty: 2, size: '300 x 300', center_hole: null })
    expect(() => db.raw.exec("UPDATE anchorage_components SET center_hole = 0")).toThrow()
    db.raw.exec('UPDATE anchorage_components SET center_hole = 40')
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '13' })
  })
})

describe('migration 0014', () => {
  it('adds headed stud columns; existing embed plates keep no studs', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec('PRAGMA foreign_keys = OFF')
    db.raw.exec("INSERT INTO anchorage_types (id, project_id, code, description, seq) VALUES ('at-1', 'p-1', 'A', 'A', 0)")
    db.raw.exec("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, size, seq) VALUES ('c-1', 'at-1', 'embed-plate', 3, '300 x 300', 0)")
    applyMigrationFile(db.raw, '0014_embed_plate_headed_studs.sql')
    expect(db.raw.prepare('SELECT qty, size, stud_count, stud_diameter, stud_length FROM anchorage_components').get()).toEqual({ qty: 3, size: '300 x 300', stud_count: null, stud_diameter: null, stud_length: null })
    expect(() => db.raw.exec('UPDATE anchorage_components SET stud_count = 0')).toThrow()
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '14' })
  })
})

describe('procurement on the server', () => {
  const rowsOf = async (db: TestDb) => {
    const m = await get(db, 'materials'); const c = await get(db, 'construction')
    return procurementRows(refreshRequirements(m, c, { log: false }), c)
  }
  it('orders and bulk deliveries are saved once per requirement, with permissions, who and when', async () => {
    const { db, A } = await setup()
    const bolts = (await rowsOf(db)).find((r) => r.name === 'Anchor bolt')!
    const nuts = (await rowsOf(db)).find((r) => r.name === 'Nut')!
    expect(bolts.required).toBe(144)
    const order = { number: 'PO-77', supplier: 'Nucor', date: '2026-10-20', lines: [{ key: bolts.key, qty: 144 }, { key: nuts.key, qty: 288 }] }
    expect((await cmd(db, 'viewer@example.com', 'materials', 'createPurchaseOrder', [order, TODAY])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [order, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [order, TODAY])).status).toBe(422) // duplicate PO number
    expect(db.raw.prepare('SELECT po_number, supplier, created_by FROM purchase_orders').all()).toEqual([{ po_number: 'PO-77', supplier: 'Nucor', created_by: 'editor@example.com' }])
    expect(count(db, 'purchase_order_lines')).toBe(2)
    expect((await rowsOf(db)).find((r) => r.name === 'Anchor bolt')).toMatchObject({ ordered: 144, status: 'ordered' })
    const poId = (db.raw.prepare('SELECT id FROM purchase_orders').get() as { id: string }).id
    const delivery = { orderId: poId, date: '2026-10-20', reference: 'DN-9', lines: [{ key: bolts.key, qty: 100 }, { key: nuts.key, qty: 288 }] }
    expect((await cmd(db, 'viewer@example.com', 'materials', 'recordDelivery', [delivery, TODAY])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'recordDelivery', [delivery, TODAY])).status).toBe(200)
    expect(db.raw.prepare('SELECT reference, received_by, received_at FROM procurement_deliveries').get()).toMatchObject({ reference: 'DN-9', received_by: 'editor@example.com' })
    expect(count(db, 'procurement_delivery_lines')).toBe(2)
    expect(count(db, 'manual_material_receipts')).toBe(0) // nothing against individual foundations
    expect(count(db, 'material_allocations')).toBe(0)
    expect((await rowsOf(db)).find((r) => r.name === 'Anchor bolt')).toMatchObject({ received: 100, outstanding: 44, status: 'partial', allocated: 0 })
    // the foundation grows: required follows, the order and delivery are untouched
    const c = await get(db, 'construction')
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [c.foundations[0].id, { quantity: 20 }])).status).toBe(200)
    expect((await rowsOf(db)).find((r) => r.name === 'Anchor bolt')).toMatchObject({ required: 240, ordered: 144, received: 100, toOrder: 96 })
    expect(count(db, 'purchase_order_lines')).toBe(2)
    // allocation: separate from receiving
    expect((await cmd(db, 'editor@example.com', 'materials', 'setAllocations', [bolts.key, [{ foundationId: c.foundations[0].id, qty: 60 }]])).status).toBe(200)
    expect(db.raw.prepare('SELECT qty, allocated_by FROM material_allocations').all()).toEqual([{ qty: 60, allocated_by: 'editor@example.com' }])
    expect((await cmd(db, 'editor@example.com', 'materials', 'setAllocations', [bolts.key, [{ foundationId: c.foundations[0].id, qty: 999 }]])).status).toBe(422)
    // voiding needs an admin and is refused while the material is allocated
    const dl = (db.raw.prepare('SELECT id FROM procurement_deliveries').get() as { id: string }).id
    expect((await cmd(db, 'editor@example.com', 'materials', 'voidDelivery', [dl])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'materials', 'voidDelivery', [dl])).status).toBe(422)
    expect((await cmd(db, 'editor@example.com', 'materials', 'setAllocations', [bolts.key, [{ foundationId: c.foundations[0].id, qty: 0 }]])).status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'materials', 'voidDelivery', [dl])).status).toBe(200)
    expect(count(db, 'procurement_deliveries')).toBe(0)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
    // the history records each step
    expect(db.raw.prepare("SELECT action FROM material_audit WHERE action IN ('order','delivery','allocation') ORDER BY seq").all().map((r) => (r as { action: string }).action)).toEqual(['order', 'delivery', 'allocation', 'allocation', 'delivery'])
    void A
  })
})

describe('migration 0015', () => {
  it('adds the procurement tables without touching existing materials or receipts', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec("INSERT INTO manual_materials (id, area, category, name, required_qty, ordered_qty, seq) VALUES ('mm-1', 'Area', 'bolt', 'Bolt', 10, 8, 0)")
    db.raw.exec("INSERT INTO manual_material_receipts (id, material_id, receipt_date, qty, reference, note, recorded_by, seq) VALUES ('r-1', 'mm-1', '2026-10-01', 5, 'DN', '', 'a@example.com', 0)")
    const before = [db.raw.prepare('SELECT * FROM manual_materials').all(), db.raw.prepare('SELECT * FROM manual_material_receipts').all()]
    applyMigrationFile(db.raw, '0015_procurement.sql')
    expect([db.raw.prepare('SELECT * FROM manual_materials').all(), db.raw.prepare('SELECT * FROM manual_material_receipts').all()]).toEqual(before)
    for (const t of ['purchase_orders', 'purchase_order_lines', 'procurement_deliveries', 'procurement_delivery_lines', 'material_allocations']) expect(count(db, t)).toBe(0)
    expect(() => db.raw.exec("INSERT INTO purchase_order_lines (id, order_id, group_key, qty, seq) VALUES ('l', 'missing', 'k', 1, 0)")).toThrow() // lines belong to an order
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '15' })
  })
})

describe('footing anchor bolts on the server', () => {
  it('are saved with the foundation, need no plinths, feed Materials and Procurement, and survive a backup', async () => {
    const { db, aid } = await setup()
    const fb = { qty: 4, diameter: '3/4"', length: 460, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 6, washersPerBolt: 2 }
    expect((await cmd(db, 'editor@example.com', 'construction', 'createFoundation', [aid, 'FB-1', '', null, 7, { bolts: [fb] }])).status).toBe(403) // structure is admin-only, as before
    expect((await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'FB-1', '', null, 7, { bolts: [{ ...fb, diameter: '' }] }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'FB-1', '', null, 7, { bolts: [fb] }])).status).toBe(200)
    expect(db.raw.prepare('SELECT qty, diameter, length, thread, nuts_per_bolt, washers_per_bolt FROM foundation_bolts').all()).toEqual([{ qty: 4, diameter: '3/4"', length: 460, thread: 'all-thread', nuts_per_bolt: 6, washers_per_bolt: 2 }])
    const fid = (db.raw.prepare("SELECT id FROM foundations WHERE number = 'FB-1'").get() as { id: string }).id
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM plinths WHERE foundation_id = ?').get(fid) as { n: number }).n).toBe(0) // no artificial plinth records
    expect(count(db, 'plinths')).toBe(3) // OP-1's own three, unchanged
    const m = await get(db, 'materials'); const c = await get(db, 'construction')
    const rows = procurementRows(refreshRequirements(m, c, { log: false }), c)
    expect(rows.find((r) => r.name === 'Anchor bolt' && /3\/4/.test(r.specification))).toMatchObject({ required: 28, status: 'pending' })
    expect(rows.find((r) => r.name === 'Nut' && /3\/4/.test(r.specification))).toMatchObject({ required: 168 })
    expect(rows.find((r) => r.name === 'Washer' && /3\/4/.test(r.specification))).toMatchObject({ required: 56 })
    // editing the footing quantity moves the requirement; clearing the bolts removes it
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { quantity: 10 }])).status).toBe(200)
    expect(procurementRows(refreshRequirements(m, await get(db, 'construction'), { log: false }), await get(db, 'construction')).find((r) => r.name === 'Anchor bolt' && /3\/4/.test(r.specification))!.required).toBe(40)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
    const backup = (await as(db, 'admin@example.com', 'GET', '/api/backup')).body
    expect(backup.tables.foundation_bolts).toHaveLength(1)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { bolts: [] }])).status).toBe(200)
    expect(count(db, 'foundation_bolts')).toBe(0)
  })
})

describe('migration 0016', () => {
  it('adds the footing bolts table without touching foundations or materials', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql', '0015_procurement.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    const before = [db.raw.prepare('SELECT * FROM foundations').all(), db.raw.prepare('SELECT * FROM manual_materials').all()]
    applyMigrationFile(db.raw, '0016_footing_anchor_bolts.sql')
    expect([db.raw.prepare('SELECT * FROM foundations').all(), db.raw.prepare('SELECT * FROM manual_materials').all()]).toEqual(before)
    expect(count(db, 'foundation_bolts')).toBe(0)
    expect(() => db.raw.exec("INSERT INTO foundation_bolts (id, foundation_id, qty, seq) VALUES ('b', 'missing', 1, 0)")).toThrow()
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '16' })
  })
})

describe('installation tracking on the server', () => {
  it('is saved separately from delivery and allocation, with permissions, who and when', async () => {
    const { db } = await setup()
    const rows = async () => { const m = await get(db, 'materials'); const c = await get(db, 'construction'); return procurementRows(refreshRequirements(m, c, { log: false }), c) }
    const bolts = (await rows()).find((r) => r.name === 'Anchor bolt')!
    const inst = (qty: number) => ({ key: bolts.key, qty, date: '2026-10-20', note: 'crew A' })
    expect((await cmd(db, 'editor@example.com', 'materials', 'recordInstallation', [inst(10), TODAY])).status).toBe(422) // nothing received yet
    expect((await cmd(db, 'editor@example.com', 'materials', 'recordDelivery', [{ date: '2026-10-19', lines: [{ key: bolts.key, qty: 100 }] }, TODAY])).status).toBe(200)
    expect((await cmd(db, 'viewer@example.com', 'materials', 'recordInstallation', [inst(10), TODAY])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'recordInstallation', [inst(10), TODAY])).status).toBe(200)
    expect(db.raw.prepare('SELECT qty, note, recorded_by FROM material_installations').all()).toEqual([{ qty: 10, note: 'crew A', recorded_by: 'editor@example.com' }])
    expect(count(db, 'material_allocations')).toBe(0)
    expect(await rows().then((r) => r.find((x) => x.name === 'Anchor bolt'))).toMatchObject({ received: 100, installed: 10, stage: 'partially-installed' })
    const id = (db.raw.prepare('SELECT id FROM material_installations').get() as { id: string }).id
    expect((await cmd(db, 'editor@example.com', 'materials', 'voidInstallation', [id])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'materials', 'voidInstallation', [id])).status).toBe(200)
    expect(count(db, 'material_installations')).toBe(0)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })
})

describe('migration 0017', () => {
  it('adds the installations table without touching existing records', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql', '0015_procurement.sql', '0016_footing_anchor_bolts.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    const before = db.raw.prepare('SELECT * FROM purchase_orders').all()
    applyMigrationFile(db.raw, '0017_material_installations.sql')
    expect(db.raw.prepare('SELECT * FROM purchase_orders').all()).toEqual(before)
    expect(count(db, 'material_installations')).toBe(0)
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '17' })
  })
})

describe('individual foundations on the server', () => {
  it('are saved with the foundation, feed Materials and Procurement, reconcile with the quantity and survive a backup', async () => {
    const { db, A, aid } = await setup()
    const emb = { kind: 'embed-plate', qty: 1, size: '16 x 320 x 520 mm' }
    expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [bolt, { kind: 'template', qty: 1, spec: '19 mm plywood' }, emb]])).status).toBe(200)
    const comp = db.raw.prepare("SELECT id FROM anchorage_components WHERE kind = 'embed-plate'").get() as { id: string }
    const fid = (db.raw.prepare("SELECT id FROM foundations WHERE number = 'OP-1'").get() as { id: string }).id
    const units = [{ label: 'A-1', embeds: [{ componentId: comp.id, qty: 1 }] }, { label: 'A-2', embeds: [{ componentId: comp.id, qty: 2 }] }, { label: 'B-1' }]
    expect((await cmd(db, 'editor@example.com', 'construction', 'setFoundationUnits', [fid, units])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'setFoundationUnits', [fid, [{ label: 'A-1' }, { label: 'a-1' }]])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'setFoundationUnits', [fid, Array.from({ length: 13 }, (_, i) => ({ label: `U${i}` }))])).status).toBe(422) // quantity is 12
    expect((await cmd(db, 'admin@example.com', 'construction', 'setFoundationUnits', [fid, units])).status).toBe(200)
    expect(db.raw.prepare('SELECT label FROM foundation_units ORDER BY seq').all()).toEqual([{ label: 'A-1' }, { label: 'A-2' }, { label: 'B-1' }])
    expect(count(db, 'foundation_unit_embeds')).toBe(2)
    const m = await get(db, 'materials'); const c = await get(db, 'construction')
    const rows = procurementRows(refreshRequirements(m, c, { log: false }), c)
    // 36 anchorages of type A; 2 of the 12 footings have their own plates: 10 footings × 3 plinths × 1 + 1 + 2
    expect(rows.find((r) => r.category === 'embed-plate')).toMatchObject({ required: 10 * 3 + 3 })
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { quantity: 2 }])).status).toBe(422) // would leave 3 individual foundations with no footing
    expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [bolt]])).status).toBe(422) // embed plate in use
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
    const backup = (await as(db, 'admin@example.com', 'GET', '/api/backup')).body
    expect(backup.tables.foundation_units).toHaveLength(3)
    expect(backup.tables.foundation_unit_embeds).toHaveLength(2)
    expect((await cmd(db, 'admin@example.com', 'construction', 'setFoundationUnits', [fid, []])).status).toBe(200)
    expect(count(db, 'foundation_units')).toBe(0)
    void aid
  })
})

describe('migration 0018', () => {
  it('adds the individual foundation tables without touching foundations', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql', '0015_procurement.sql', '0016_footing_anchor_bolts.sql', '0017_material_installations.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    const before = db.raw.prepare('SELECT * FROM foundations').all()
    applyMigrationFile(db.raw, '0018_individual_foundations.sql')
    expect(db.raw.prepare('SELECT * FROM foundations').all()).toEqual(before)
    expect(count(db, 'foundation_units')).toBe(0)
    expect(() => db.raw.exec("INSERT INTO foundation_units (id, foundation_id, label, seq) VALUES ('u', 'missing', 'A-1', 0)")).toThrow()
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '18' })
  })
})

describe('foundation embed plates on the server', () => {
  it('are saved with the foundation, feed Materials and Procurement, follow the quantity and survive a backup', async () => {
    const { db, A } = await setup()
    expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [bolt, { kind: 'embed-plate', qty: 1, size: '16 x 320 x 520 mm' }]])).status).toBe(200)
    const comp = (db.raw.prepare("SELECT id FROM anchorage_components WHERE kind = 'embed-plate'").get() as { id: string }).id
    const fid = (db.raw.prepare("SELECT id FROM foundations WHERE number = 'OP-1'").get() as { id: string }).id // 12 foundations × 3 plinths of A
    const embeds = [{ componentId: comp, qty: 2, mode: 'per-foundation' }]
    expect((await cmd(db, 'editor@example.com', 'construction', 'configureFoundation', [fid, { embeds }])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { embeds: [{ componentId: 'nope', qty: 1, mode: 'total' }] }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { embeds }])).status).toBe(200)
    expect(db.raw.prepare('SELECT qty, mode FROM foundation_embeds').all()).toEqual([{ qty: 2, mode: 'per-foundation' }])
    const rows = async () => { const m = await get(db, 'materials'); const c = await get(db, 'construction'); return procurementRows(refreshRequirements(m, c, { log: false }), c) }
    // 2 per foundation × 12 = 24; it replaces the anchorage type's own plate for this foundation (not 24 + 36)
    expect((await rows()).find((r) => r.category === 'embed-plate')).toMatchObject({ required: 24, status: 'pending' })
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { quantity: 20 }])).status).toBe(200)
    expect((await rows()).find((r) => r.category === 'embed-plate')!.required).toBe(40)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { embeds: [{ componentId: comp, qty: 5, mode: 'total' }] }])).status).toBe(200)
    expect((await rows()).find((r) => r.category === 'embed-plate')!.required).toBe(5)
    expect((await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [bolt]])).status).toBe(422) // plate in use
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
    expect((await as(db, 'admin@example.com', 'GET', '/api/backup')).body.tables.foundation_embeds).toHaveLength(1)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { embeds: [] }])).status).toBe(200)
    expect(count(db, 'foundation_embeds')).toBe(0)
  })
})

describe('migration 0019', () => {
  it('adds the foundation embed plates table without touching foundations', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql', '0015_procurement.sql', '0016_footing_anchor_bolts.sql', '0017_material_installations.sql', '0018_individual_foundations.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    const before = db.raw.prepare('SELECT * FROM foundations').all()
    applyMigrationFile(db.raw, '0019_foundation_embed_plates.sql')
    expect(db.raw.prepare('SELECT * FROM foundations').all()).toEqual(before)
    expect(count(db, 'foundation_embeds')).toBe(0)
    expect(() => db.raw.exec("INSERT INTO foundation_embeds (id, foundation_id, component_id, qty, mode, seq) VALUES ('e', 'missing', 'c', 1, 'total', 0)")).toThrow()
    expect(() => db.raw.exec("INSERT INTO foundation_embeds (id, foundation_id, component_id, qty, mode, seq) VALUES ('e', (SELECT id FROM foundations LIMIT 1), 'c', 1, 'each', 0)")).toThrow()
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '19' })
  })
})

describe('embed plates created in a foundation, on the server', () => {
  it('are saved foundation-specific or to the library, feed Materials and Procurement, and survive a backup', async () => {
    const { db, aid } = await setup()
    const plate = { thickness: 16, width: 300, length: 300, unit: 'mm', studCount: 4, studDiameter: 19, studLength: 150 }
    await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'OP-2', '', null, 18, {}])
    const f2 = (db.raw.prepare("SELECT id FROM foundations WHERE number = 'OP-2'").get() as { id: string }).id
    const own = [{ plate, save: 'foundation', qty: 2, mode: 'per-foundation' }]
    expect((await cmd(db, 'editor@example.com', 'construction', 'configureFoundation', [f2, { embeds: own }])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [f2, { embeds: [{ ...own[0], plate: { ...plate, thickness: 0 } }] }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [f2, { embeds: own }])).status).toBe(200)
    expect(db.raw.prepare('SELECT component_id, thickness, width, length, stud_count, qty, mode FROM foundation_embeds').all()).toEqual([{ component_id: '', thickness: 16, width: 300, length: 300, stud_count: 4, qty: 2, mode: 'per-foundation' }])
    expect(count(db, 'library_embed_plates')).toBe(0)
    const rows = async () => { const m = await get(db, 'materials'); const c = await get(db, 'construction'); return procurementRows(refreshRequirements(m, c, { log: false }), c) }
    expect((await rows()).find((r) => r.category === 'embed-plate')).toMatchObject({ required: 36, status: 'pending' })
    // the same plate saved to the library from another foundation: reused, one library row, one consolidated requirement
    const f1 = (db.raw.prepare("SELECT id FROM foundations WHERE number = 'OP-1'").get() as { id: string }).id // 12 foundations
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [f1, { embeds: [{ plate, save: 'library', qty: 1, mode: 'per-foundation' }] }])).status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [f1, { embeds: [{ plate, save: 'library', qty: 1, mode: 'per-foundation' }] }])).status).toBe(200)
    expect(count(db, 'library_embed_plates')).toBe(1)
    expect(db.raw.prepare('SELECT created_by FROM library_embed_plates').get()).toEqual({ created_by: 'admin@example.com' })
    const embed = (await rows()).filter((r) => r.category === 'embed-plate')
    expect(embed).toHaveLength(2) // each foundation's plate is identified by its foundation: OP-1 and f2
    expect(embed.reduce((a, r) => a + r.required, 0)).toBe(36 + 12)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [f2, { quantity: 20 }])).status).toBe(200)
    expect((await rows()).filter((r) => r.category === 'embed-plate').reduce((a, r) => a + r.required, 0)).toBe(40 + 12)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
    const backup = (await as(db, 'admin@example.com', 'GET', '/api/backup')).body
    expect(backup.tables.library_embed_plates).toHaveLength(1)
    expect(backup.tables.foundation_embeds).toHaveLength(2)
  })
})

describe('migration 0020', () => {
  it('adds plate columns and the library table without touching existing embed plates', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql', '0015_procurement.sql', '0016_footing_anchor_bolts.sql', '0017_material_installations.sql', '0018_individual_foundations.sql', '0019_foundation_embed_plates.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec('PRAGMA foreign_keys = OFF')
    db.raw.exec("INSERT INTO foundation_embeds (id, foundation_id, component_id, qty, mode, seq) VALUES ('e1', 'f1', 'ac-1', 2, 'per-foundation', 0)")
    const before = db.raw.prepare('SELECT id, foundation_id, component_id, qty, mode FROM foundation_embeds').all()
    applyMigrationFile(db.raw, '0020_custom_embed_plates.sql')
    expect(db.raw.prepare('SELECT id, foundation_id, component_id, qty, mode FROM foundation_embeds').all()).toEqual(before)
    expect(db.raw.prepare('SELECT thickness, plate_unit, stud_count FROM foundation_embeds').get()).toEqual({ thickness: null, plate_unit: 'mm', stud_count: null })
    expect(count(db, 'library_embed_plates')).toBe(0)
    expect(() => db.raw.exec("INSERT INTO library_embed_plates (id, project_id, thickness, width, length, seq) VALUES ('l', 'p', 0, 1, 1, 0)")).toThrow() // sizes must be positive
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '20' })
  })
})

describe('footing anchor bolt quantity method on the server', () => {
  it('saves the method, keeps total bolts fixed when the quantity changes, and defaults to per foundation', async () => {
    const { db } = await setup() // OP-1: 12 foundations × 3 plinths of type A (4 bolts each)
    const fid = (db.raw.prepare("SELECT id FROM foundations WHERE number = 'OP-1'").get() as { id: string }).id
    const mk = (mode?: string) => ({ qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm', thread: 'both-ends', topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2, ...(mode ? { mode } : {}) })
    const rows = async () => { const m = await get(db, 'materials'); const c = await get(db, 'construction'); return procurementRows(refreshRequirements(m, c, { log: false }), c) }
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { bolts: [mk('each')] }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { bolts: [mk()] }])).status).toBe(200)
    expect(db.raw.prepare('SELECT mode FROM foundation_bolts').all()).toEqual([{ mode: 'per-foundation' }])
    const sum = async (cat: string) => (await rows()).filter((r) => r.category === cat).reduce((a, r) => a + r.required, 0) // typical and footing bolts are separate lines
    expect(await sum('bolt')).toBe(144 + 48) // typical 12×3×4, plus 4 × 12
    expect((await rows()).find((r) => r.category === 'bolt' && r.designation === 'OP-1')!.required).toBe(48)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { bolts: [mk('total')] }])).status).toBe(200)
    expect(db.raw.prepare('SELECT mode FROM foundation_bolts').all()).toEqual([{ mode: 'total' }])
    expect(await sum('bolt')).toBe(144 + 4)
    expect(await sum('nut')).toBe((144 + 4) * 2)
    expect((await cmd(db, 'admin@example.com', 'construction', 'configureFoundation', [fid, { quantity: 20 }])).status).toBe(200)
    expect(await sum('bolt')).toBe(240 + 4) // typical follows, total stays 4
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
    expect((await as(db, 'admin@example.com', 'GET', '/api/backup')).body.tables.foundation_bolts[0].mode).toBe('total')
  })
})

describe('migration 0021', () => {
  it('adds the method with every existing footing bolt defaulting to per foundation', () => {
    const db = createTestDb({ migrate: false })
    const files = ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql', '0008_foundation_quantity.sql', '0009_accessory_type_directory.sql', '0010_foundation_configuration_and_pours.sql', '0011_fleet_lifespan_settings_and_inspection_readings.sql', '0012_anchorage_components_requirements_deliveries.sql', '0013_sole_plate_center_hole.sql', '0014_embed_plate_headed_studs.sql', '0015_procurement.sql', '0016_footing_anchor_bolts.sql', '0017_material_installations.sql', '0018_individual_foundations.sql', '0019_foundation_embed_plates.sql', '0020_custom_embed_plates.sql']
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec('PRAGMA foreign_keys = OFF')
    db.raw.exec("INSERT INTO foundation_bolts (id, foundation_id, qty, diameter, seq) VALUES ('b1', 'f1', 4, 'M25', 0)")
    applyMigrationFile(db.raw, '0021_footing_bolt_quantity_method.sql')
    expect(db.raw.prepare('SELECT qty, diameter, mode FROM foundation_bolts').get()).toEqual({ qty: 4, diameter: 'M25', mode: 'per-foundation' })
    expect(() => db.raw.exec("UPDATE foundation_bolts SET mode = 'each'")).toThrow()
    db.raw.exec("UPDATE foundation_bolts SET mode = 'total'")
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '21' })
  })
})

describe('procurement improvements on the server', () => {
  const ordersSetup = async () => {
    const { db, A } = await setup()
    const c = await get(db, 'construction')
    const rows = async () => { const m = await get(db, 'materials'); const cc = await get(db, 'construction'); return procurementRows(refreshRequirements(m, cc, { log: false }), cc) }
    return { db, A, c, rows }
  }

  it('orders without a PO number, then adds, corrects and clears it in place, with permissions and history; nothing else changes', async () => {
    const { db, rows } = await ordersSetup()
    const bolts = (await rows()).find((r) => r.name === 'Anchor bolt')!
    const order = { number: '', supplier: 'Nucor', date: '2026-10-20', lines: [{ key: bolts.key, qty: 100 }] }
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [order, TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [{ ...order, lines: [{ key: (await rows()).find((r) => r.name === 'Nut')!.key, qty: 5 }] }, TODAY])).status).toBe(200) // a second, also unnumbered
    expect(db.raw.prepare('SELECT po_number FROM purchase_orders ORDER BY seq').all()).toEqual([{ po_number: '' }, { po_number: '' }])
    expect((await rows()).find((r) => r.name === 'Anchor bolt')).toMatchObject({ ordered: 100, status: 'ordered' })
    const poId = (db.raw.prepare('SELECT id FROM purchase_orders ORDER BY seq').get() as { id: string }).id
    const linesBefore = db.raw.prepare('SELECT * FROM purchase_order_lines ORDER BY id').all()
    expect((await cmd(db, 'viewer@example.com', 'materials', 'setPurchaseOrderNumber', [poId, 'PO-5'])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderNumber', [poId, 'PO-5'])).status).toBe(200)
    expect(db.raw.prepare('SELECT po_number FROM purchase_orders WHERE id = ?').get(poId)).toEqual({ po_number: 'PO-5' })
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderNumber', [poId, 'PO-6'])).status).toBe(200) // correct it
    expect(count(db, 'purchase_orders')).toBe(2) // edited in place
    expect(db.raw.prepare('SELECT * FROM purchase_order_lines ORDER BY id').all()).toEqual(linesBefore)
    expect((await rows()).find((r) => r.name === 'Anchor bolt')).toMatchObject({ ordered: 100, status: 'ordered' })
    const other = (db.raw.prepare('SELECT id FROM purchase_orders ORDER BY seq DESC').get() as { id: string }).id
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderNumber', [other, 'po-6'])).status).toBe(422) // already used
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderNumber', [poId, ''])).status).toBe(200)
    expect(db.raw.prepare('SELECT po_number FROM purchase_orders WHERE id = ?').get(poId)).toEqual({ po_number: '' })
    const hist = db.raw.prepare("SELECT summary FROM material_audit WHERE summary LIKE 'PO number%' ORDER BY seq").all() as { summary: string }[]
    expect(hist.map((h) => h.summary.replace(/ \(.*/, ''))).toEqual(['PO number added: Not Assigned → PO-5', 'PO number changed: PO-5 → PO-6', 'PO number changed: PO-6 → Not Assigned'])
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('stores the anchorage designation on requirements and records, and keeps materials of different designations apart through a backup', async () => {
    const { db, A, rows } = await ordersSetup()
    const B = (await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [(await get(db, 'construction')).projects[0].id, 'B', 'Type B'])).body.state.anchorageTypes.find((t: { code: string }) => t.code === 'B').id
    await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [B, [{ kind: 'template', qty: 1, spec: '19 mm plywood' }]])
    await cmd(db, 'admin@example.com', 'construction', 'setAnchorageComponents', [A, [bolt, { kind: 'template', qty: 1, spec: '19 mm plywood' }]])
    const c = await get(db, 'construction')
    await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [c.areas[0].id, 'OP-B', '', null, 7, { groups: [{ anchorageTypeId: B, count: 1 }] }])
    const tpl = (await rows()).filter((r) => r.name === 'Plywood template' && r.required > 0)
    expect(tpl.map((r) => [r.designation, r.required])).toEqual([['A', 36], ['B', 7]])
    // an order and a delivery against one designation carry that designation
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [{ number: '', supplier: 'Lumber', date: '2026-10-20', lines: [{ key: tpl[1].key, qty: 7 }] }, TODAY])).status).toBe(200)
    expect(db.raw.prepare('SELECT designation, qty FROM purchase_order_lines').all()).toEqual([{ designation: 'B', qty: 7 }])
    expect(db.raw.prepare("SELECT designation FROM manual_materials WHERE origin = 'anchorage' AND name = 'Plywood template' ORDER BY designation").all()).toEqual([{ designation: 'A' }, { designation: 'B' }])
    const after = (await rows()).filter((r) => r.name === 'Plywood template' && r.required > 0)
    expect(after.map((r) => [r.designation, r.ordered])).toEqual([['A', 0], ['B', 7]])
    expect((await as(db, 'admin@example.com', 'GET', '/api/backup')).body.tables.purchase_order_lines[0].designation).toBe('B')
  })
})

describe('migration 0022', () => {
  it('adds the designation columns without changing any existing procurement record', () => {
    const db = createTestDb({ migrate: false })
    const files = readdirSync(new URL('../../../migrations', import.meta.url)).filter((f) => f < '0022').sort()
    for (const f of files) applyMigrationFile(db.raw, f)
    db.raw.exec('PRAGMA foreign_keys = OFF')
    db.raw.exec("INSERT INTO purchase_orders (id, po_number, supplier, order_date, notes, cancelled, created_at, created_by, seq) VALUES ('po1', 'PO-1', 'Nucor', '2026-10-20', '', 0, '2026-10-20T00:00:00Z', 'x', 0)")
    db.raw.exec("INSERT INTO purchase_order_lines (id, order_id, group_key, area_id, area, category, name, specification, size, unit, qty, seq) VALUES ('l1', 'po1', 'k|bolt|anchor bolt|||ea', 'a1', 'E-House', 'bolt', 'Anchor bolt', 'M25', '', 'ea', 44, 0)")
    const before = db.raw.prepare('SELECT * FROM purchase_order_lines').get()
    applyMigrationFile(db.raw, '0022_procurement_designations.sql')
    expect(db.raw.prepare('SELECT * FROM purchase_order_lines').get()).toEqual({ ...(before as object), designation: '' })
    expect(db.raw.prepare('SELECT po_number, supplier FROM purchase_orders').get()).toEqual({ po_number: 'PO-1', supplier: 'Nucor' })
    for (const t of ['manual_materials', 'purchase_order_lines', 'procurement_delivery_lines', 'material_installations']) expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${t}') WHERE name = 'designation'`).get() as { n: number }).n).toBe(1)
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '22' })
  })
})

describe('optional supplier on the server', () => {
  it('orders without a supplier are saved, and the supplier is added and changed later with permissions and history', async () => {
    const { db, A } = await setup()
    void A
    const m = await get(db, 'materials'); const c = await get(db, 'construction')
    const bolts = procurementRows(refreshRequirements(m, c, { log: false }), c).find((r) => r.name === 'Anchor bolt')!
    const order = { number: '', supplier: '', date: '2026-10-20', lines: [{ key: bolts.key, qty: 10 }] }
    expect((await cmd(db, 'viewer@example.com', 'materials', 'createPurchaseOrder', [order, TODAY])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [order, TODAY])).status).toBe(200)
    expect(db.raw.prepare('SELECT po_number, supplier, supplier_id FROM purchase_orders').all()).toEqual([{ po_number: '', supplier: '', supplier_id: null }])
    const id = (db.raw.prepare('SELECT id FROM purchase_orders').get() as { id: string }).id
    expect((await cmd(db, 'viewer@example.com', 'materials', 'setPurchaseOrderSupplier', [id, null, 'Nucor'])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderSupplier', [id, null, 'Nucor'])).status).toBe(200)
    expect(db.raw.prepare('SELECT supplier FROM purchase_orders').get()).toEqual({ supplier: 'Nucor' })
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderSupplier', [id, 'missing', ''])).status).toBe(422)
    expect(count(db, 'purchase_order_lines')).toBe(1)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })
})

describe('order names on the server', () => {
  it('an order is saved with a name, renamed later with permissions and history, and an unnamed one stays unnamed', async () => {
    const { db } = await setup()
    const m = await get(db, 'materials'); const c = await get(db, 'construction')
    const bolts = procurementRows(refreshRequirements(m, c, { log: false }), c).find((r) => r.name === 'Anchor bolt')!
    const order = (name: string) => ({ name, number: '', supplier: '', date: '2026-10-20', lines: [{ key: bolts.key, qty: 10 }] })
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [order('E-House Anchor Bolts'), TODAY])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'materials', 'createPurchaseOrder', [order(''), TODAY])).status).toBe(200)
    expect(db.raw.prepare('SELECT name FROM purchase_orders ORDER BY seq').all()).toEqual([{ name: 'E-House Anchor Bolts' }, { name: '' }])
    expect((await get(db, 'materials')).orders.map((o: { name?: string }) => o.name)).toEqual(['E-House Anchor Bolts', undefined])
    const id = (db.raw.prepare('SELECT id FROM purchase_orders ORDER BY seq DESC').get() as { id: string }).id
    expect((await cmd(db, 'viewer@example.com', 'materials', 'setPurchaseOrderName', [id, 'Site Supplies'])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'materials', 'setPurchaseOrderName', [id, 'Site Supplies'])).status).toBe(200)
    expect(db.raw.prepare('SELECT name FROM purchase_orders WHERE id = ?').get(id)).toEqual({ name: 'Site Supplies' })
    expect(count(db, 'purchase_orders')).toBe(2)
    expect((await as(db, 'admin@example.com', 'GET', '/api/backup')).body.tables.purchase_orders.map((r: { name: string }) => r.name)).toContain('Site Supplies')
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })
})

describe('migration 0023', () => {
  it('adds the order name column without changing existing orders', () => {
    const db = createTestDb({ migrate: false })
    for (const f of readdirSync('migrations').filter((x) => x < '0023').sort()) applyMigrationFile(db.raw, f)
    db.raw.exec("INSERT INTO purchase_orders (id, po_number, supplier, order_date, notes, cancelled, created_at, created_by, seq) VALUES ('po1', 'PO-1', 'Nucor', '2026-10-20', 'n', 0, '2026-10-20T00:00:00Z', 'x', 0)")
    const before = db.raw.prepare('SELECT * FROM purchase_orders').get()
    applyMigrationFile(db.raw, '0023_purchase_order_names.sql')
    expect(db.raw.prepare('SELECT * FROM purchase_orders').get()).toEqual({ ...(before as object), name: '' })
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '23' })
  })
})
