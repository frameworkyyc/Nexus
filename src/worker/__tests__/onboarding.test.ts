import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { TABLES } from '../db'
import { clock, NOW, TODAY } from './helpers'
import { applyMigrationFile, createTestDb, type TestDb } from './sqliteD1'

/** A new installation: migrations only, no fixture data, then everything is created by people through the API. */
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
const fresh = () => { const db = createTestDb({ seed: false }); give(db, 'admin@example.com', 'admin'); give(db, 'editor@example.com', 'editor'); give(db, 'viewer@example.com', 'viewer'); return db }
const material = (over: Record<string, unknown> = {}) => ({ areaId: '', foundationId: '', anchorageTypeId: '', category: 'bolt', name: 'Anchor bolt', description: '', specification: '', size: '', requiredQty: 4, unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '', ...over })

describe('a genuinely empty installation', () => {
  it('has no operational records at all: schema and system rows only', () => {
    const db = createTestDb({ seed: false })
    const system = new Set(['schema_info', 'module_versions', 'write_guard'])
    const configured = new Set(['suppliers', 'category_suppliers']) // the one confirmed preference: Anchor bolts → Nucor
    for (const t of TABLES) { if (!configured.has(t.name)) expect(count(db, t.name), t.name).toBe(0) }
    for (const t of ['change_log', 'user_roles', 'role_audit', 'material_audit']) expect(count(db, t), t).toBe(0)
    expect([...system].every((t) => count(db, t) >= 0)).toBe(true)
    expect(db.raw.prepare('SELECT name FROM suppliers').all()).toEqual([{ name: 'Nucor' }])
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '20' })
  })

  it('migrations contain no inserts of operational data (reference data lives in seeds/, never in migrations)', () => {
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql']) {
      const sql = readFileSync(`migrations/${f}`, 'utf8').replace(/--.*$/gm, '')
      const inserts = [...sql.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/gi)].map((m) => m[1])
      expect(inserts.filter((t) => !['schema_info', 'module_versions', 'suppliers', 'category_suppliers'].includes(t)), f).toEqual([])
    }
    expect(readFileSync('migrations/0002_seed_reef_and_fleet.sql', 'utf8')).not.toMatch(/REEF|T6010|Progressive/i)
  })

  it('serves empty state for every module', async () => {
    const db = fresh()
    const c = (await as(db, 'viewer@example.com', 'GET', '/api/state/construction')).body.state
    expect(c.company).toEqual({ id: '', name: '' })
    expect([c.projects, c.areas, c.foundations, c.plinths, c.anchorageTypes, c.activities].every((x) => x.length === 0)).toBe(true)
    const f = (await as(db, 'viewer@example.com', 'GET', '/api/state/fleet')).body.state
    expect(Object.values(f).every((x) => Array.isArray(x) && x.length === 0)).toBe(true)
    const m = (await as(db, 'viewer@example.com', 'GET', '/api/state/materials')).body.state
    expect([m.lines, m.manual, m.history].every((x) => x.length === 0)).toBe(true)
  })

  it('the configured initial administrator can complete onboarding; nobody else becomes an administrator', async () => {
    const db = createTestDb({ seed: false })
    const env = { INITIAL_ADMIN_EMAIL: 'owner@example.com' }
    expect((await cmd(db, 'stranger@example.com', 'construction', 'createOrganization', [{ name: 'Intruder Ltd' }], env)).status).toBe(403)
    expect(count(db, 'companies')).toBe(0)
    const r = await cmd(db, 'owner@example.com', 'construction', 'createOrganization', [{ name: 'Northline Construction', location: 'Calgary, AB' }], env)
    expect(r.status).toBe(200)
    expect(db.raw.prepare('SELECT name, location FROM companies').get()).toEqual({ name: 'Northline Construction', location: 'Calgary, AB' })
    expect(db.raw.prepare('SELECT email, role FROM user_roles').all()).toEqual([{ email: 'owner@example.com', role: 'admin' }])
  })
})

describe('onboarding sequence persists in the database', () => {
  it('organization → project → area → foundations → anchorage → materials → fleet', async () => {
    const db = fresh()
    // Only admins create the organization, once.
    expect((await cmd(db, 'editor@example.com', 'construction', 'createOrganization', [{ name: 'X Co' }])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'a' }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline', contactEmail: 'not-an-email' }])).status).toBe(422)
    const org = await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline', legalName: 'Northline Ltd.', location: 'Calgary', contactEmail: 'ops@northline.example' }])
    expect(org.status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Second' }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'updateOrganization', [{ website: 'https://northline.example' }])).body.state.company).toMatchObject({ name: 'Northline', website: 'https://northline.example', legalName: 'Northline Ltd.' })

    // Project: only the name is required; starts completely empty.
    expect((await cmd(db, 'editor@example.com', 'construction', 'createProject', [{ name: 'Plant Expansion' }])).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: '' }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'P', startDate: '2026-02-30' }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'Plant Expansion', startDate: '2026-06-01', endDate: '2026-01-01' }])).status).toBe(422)
    const proj = await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'Plant Expansion', jobNumber: '1001', client: 'Acme', description: 'Foundations', startDate: '2026-03-01', endDate: '2026-12-01' }])
    expect(proj.status).toBe(200)
    const pid = proj.body.state.projects[0].id
    expect(db.raw.prepare('SELECT name, job_number, client, status, description, start_date, end_date FROM projects').get()).toEqual({ name: 'Plant Expansion', job_number: '1001', client: 'Acme', status: 'planning', description: 'Foundations', start_date: '2026-03-01', end_date: '2026-12-01' })
    expect([count(db, 'areas'), count(db, 'foundations'), count(db, 'manual_materials'), count(db, 'vehicles'), count(db, 'vehicle_assignments')]).toEqual([0, 0, 0, 0, 0]) // nothing preloaded
    expect((await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'plant expansion' }])).status).toBe(422) // duplicate name

    // Area with foundations, then more foundations in bulk.
    const area = await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, 'North Yard', [{ number: 'N-01', description: 'Pump pad', plinthCount: 2 }], { identifier: 'NY', description: 'Staging area' }])
    expect(area.status).toBe(200)
    const aid = area.body.state.areas[0].id
    expect(db.raw.prepare('SELECT name, identifier, description, archived FROM areas').get()).toEqual({ name: 'North Yard', identifier: 'NY', description: 'Staging area', archived: 0 })
    const bulk = await cmd(db, 'admin@example.com', 'construction', 'addFoundations', [aid, [{ number: 'N-02', description: '', plinthCount: 1 }, { number: 'N-03', description: 'Tank', plinthCount: 4 }]])
    expect(bulk.status).toBe(200)
    expect(count(db, 'foundations')).toBe(3)
    expect((await cmd(db, 'admin@example.com', 'construction', 'addFoundations', [aid, [{ number: 'N-04', description: '', plinthCount: 1 }, { number: 'n-02', description: '', plinthCount: 1 }]])).status).toBe(422) // duplicate: nothing added
    expect(count(db, 'foundations')).toBe(3)
    expect((await cmd(db, 'editor@example.com', 'construction', 'addFoundations', [aid, [{ number: 'N-09', description: '', plinthCount: 1 }]])).status).toBe(403)

    // Anchorage library.
    expect((await cmd(db, 'editor@example.com', 'construction', 'addAnchorageType', [pid, 'AB-101', 'Four 3/4 in bolts'])).status).toBe(403)
    const anc = await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [pid, 'AB-101', 'Four 3/4 in bolts'])
    expect(anc.status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [pid, 'ab-101', ''])).status).toBe(422) // never a duplicate definition
    const ancId = anc.body.state.anchorageTypes[0].id
    expect(db.raw.prepare('SELECT project_id, code, description FROM anchorage_types').get()).toEqual({ project_id: pid, code: 'AB-101', description: 'Four 3/4 in bolts' })

    // Materials use exactly what was configured, including the confirmed preferred supplier.
    const fid = bulk.body.state.foundations.find((f: { number: string }) => f.number === 'N-03').id
    const mat = await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[material({ areaId: aid, foundationId: fid, anchorageTypeId: ancId, supplierId: 'sup-nucor' })]])
    expect(mat.status).toBe(200)
    expect(db.raw.prepare('SELECT area_id, foundation_id, anchorage_type_id, supplier_id, location, anchorage_ref FROM manual_materials').get()).toEqual({ area_id: aid, foundation_id: fid, anchorage_type_id: ancId, supplier_id: 'sup-nucor', location: 'N-03', anchorage_ref: 'AB-101' })
    expect((await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[material({ areaId: aid, name: 'x', anchorageTypeId: 'anc-not-real' })]])).status).toBe(422)
    // Anchorage and area cannot be archived while in use.
    expect((await cmd(db, 'admin@example.com', 'construction', 'archiveAnchorageType', [ancId, true])).body.error).toMatch(/1 active material uses/)
    expect((await cmd(db, 'admin@example.com', 'construction', 'archiveArea', [aid, true])).body.error).toMatch(/1 active material is assigned/)

    // Fleet needs the organization and takes its project list from the server.
    const veh = await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [{ unitNumber: 'EQ-1', kind: 'equipment', year: 2022, make: 'Cat', model: '320', vin: '', licencePlate: '', notes: '' }, pid, TODAY])
    expect(veh.status).toBe(200)
    expect(db.raw.prepare('SELECT unit_number, kind, company_id FROM vehicles').get()).toEqual({ unit_number: 'EQ-1', kind: 'equipment', company_id: org.body.state.company.id })
    expect(db.raw.prepare('SELECT project_id FROM vehicle_assignments').get()).toEqual({ project_id: pid })
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [{ unitNumber: 'eq-1', kind: 'vehicle', year: 2022, make: 'a', model: 'b', vin: '', licencePlate: '', notes: '' }, null, TODAY])).status).toBe(422)
    expect((await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [{ unitNumber: 'EQ-2', kind: 'vehicle', year: 2022, make: 'a', model: 'b', vin: '', licencePlate: '', notes: '' }, 'proj-ghost', TODAY])).status).toBe(422)
    expect((await cmd(db, 'viewer@example.com', 'fleet', 'addVehicle', [{ unitNumber: 'EQ-3', kind: 'vehicle', year: 2022, make: 'a', model: 'b', vin: '', licencePlate: '', notes: '' }, null, TODAY])).status).toBe(403)
    // The client's own list of valid projects is ignored: the server checks its records.
    const vid = veh.body.state.vehicles[0].id
    expect((await cmd(db, 'editor@example.com', 'fleet', 'reassignVehicle', [vid, 'proj-ghost', ['proj-ghost'], TODAY])).status).toBe(422)

    // Records are visible to another user's session and survive (the database is the only store).
    for (const who of ['viewer@example.com', 'editor@example.com']) {
      const c = (await as(db, who, 'GET', '/api/state/construction')).body.state
      expect(c.projects.map((p: { name: string }) => p.name)).toEqual(['Plant Expansion'])
      expect(c.foundations.map((f: { number: string }) => f.number).sort()).toEqual(['N-01', 'N-02', 'N-03'])
      expect((await as(db, who, 'GET', '/api/state/fleet')).body.state.vehicles.map((v: { unitNumber: string }) => v.unitNumber)).toEqual(['EQ-1'])
      expect((await as(db, who, 'GET', '/api/state/materials')).body.state.manual).toHaveLength(1)
    }
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('fleet cannot be added before the organization exists', async () => {
    const db = fresh()
    const r = await cmd(db, 'editor@example.com', 'fleet', 'addVehicle', [{ unitNumber: 'T1', kind: 'vehicle', year: 2024, make: 'Ford', model: 'F-350', vin: '', licencePlate: '', notes: '' }, null, TODAY])
    expect(r.status).toBe(422)
    expect(r.body.error).toMatch(/Create the organization/)
    expect(count(db, 'vehicles')).toBe(0)
  })

  it('areas and foundations: rename, archive and restore never disturb relationships', async () => {
    const db = fresh()
    await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }])
    const pid = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'P1' }])).body.state.projects[0].id
    const a = (await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, 'Alpha', [{ number: '1-01', description: '', plinthCount: 1 }]])).body.state
    const aid = a.areas[0].id, fid = a.foundations[0].id
    expect((await cmd(db, 'admin@example.com', 'construction', 'editArea', [aid, { name: 'Alpha Yard' }])).status).toBe(200)
    expect(db.raw.prepare('SELECT id, name FROM areas').get()).toEqual({ id: aid, name: 'Alpha Yard' })
    expect(db.raw.prepare('SELECT area_id FROM foundations WHERE id = ?').get(fid)).toEqual({ area_id: aid })
    expect((await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, 'alpha yard', []])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'archiveArea', [aid, true])).status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'construction', 'addFoundations', [aid, [{ number: '1-02', description: '', plinthCount: 1 }]])).body.error).toMatch(/archived/)
    expect((await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[material({ areaId: aid })]])).body.error).toMatch(/archived/)
    expect((await cmd(db, 'admin@example.com', 'construction', 'archiveArea', [aid, false])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[material({ areaId: aid })]])).status).toBe(200)
  })

  it('projects are isolated: another project’s areas and foundations are not on offer', async () => {
    const db = fresh()
    await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }])
    const p1 = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'P1' }])).body.state.projects[0].id
    const s = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'P2' }])).body.state
    const p2 = s.projects.find((p: { name: string }) => p.name === 'P2').id
    await cmd(db, 'admin@example.com', 'construction', 'createArea', [p1, 'Alpha', [{ number: '1-01', description: '', plinthCount: 1 }]])
    const c = (await cmd(db, 'admin@example.com', 'construction', 'createArea', [p2, 'Alpha', [{ number: '1-01', description: '', plinthCount: 1 }]])).body.state // same names, different project
    expect(c.areas).toHaveLength(2)
    expect(new Set(c.areas.map((a: { id: string }) => a.id)).size).toBe(2)
    expect(new Set(c.foundations.map((f: { id: string }) => f.id)).size).toBe(2)
    await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [p1, 'AB-1', ''])
    expect((await cmd(db, 'admin@example.com', 'construction', 'addAnchorageType', [p2, 'AB-1', ''])).status).toBe(200) // codes are per project
  })
})

describe('Cloudflare configuration', () => {
  const wrangler = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  it('staging is bound to nexus-staging only; production and the public demo have no database binding', () => {
    expect(wrangler.previews.d1_databases).toEqual([{ binding: 'DB', database_name: 'nexus-staging', database_id: '8efc35c6-e125-4c17-99b4-92ba89672150', migrations_dir: 'migrations' }])
    expect(JSON.stringify(wrangler)).not.toContain('nexus-production')
    expect(wrangler.d1_databases).toBeUndefined()
    expect(wrangler.vars.NEXUS_ENV).toBe('demo')
    expect(wrangler.previews.vars.NEXUS_ENV).toBe('staging')
  })
})

describe('foundation quantity on the server', () => {
  async function setupArea() {
    const db = fresh()
    await cmd(db, 'admin@example.com', 'construction', 'createOrganization', [{ name: 'Northline' }])
    const pid = (await cmd(db, 'admin@example.com', 'construction', 'createProject', [{ name: 'P1' }])).body.state.projects[0].id
    const aid = (await cmd(db, 'admin@example.com', 'construction', 'createArea', [pid, 'E-House', []])).body.state.areas[0].id
    return { db, pid, aid }
  }
  const row = (db: TestDb, name: string) => db.raw.prepare('SELECT id, quantity, plinths_per_foundation AS per FROM foundations WHERE number = ?').get(name) as { id: string; quantity: number; per: number | null }

  it('stores quantity and plinths per foundation in the database, one row per name, and shows them after a reload', async () => {
    const { db, aid } = await setupArea()
    const r = await cmd(db, 'admin@example.com', 'construction', 'addFoundations', [aid, [{ number: 'FND-101', description: 'E-House foundation', plinthCount: 4, quantity: 18 }, { number: 'FND-102', description: '', plinthCount: null, quantity: 6 }, { number: 'FND-103', description: '' , plinthCount: 2 }]])
    expect(r.status).toBe(200)
    expect(count(db, 'foundations')).toBe(3) // not 18 + 6 + 1
    expect(row(db, 'FND-101')).toMatchObject({ quantity: 18, per: 4 })
    expect(row(db, 'FND-102')).toMatchObject({ quantity: 6, per: null }) // unknown stays unknown
    expect(row(db, 'FND-103')).toMatchObject({ quantity: 1, per: 2 }) // default 1
    expect(count(db, 'plinths')).toBe(6) // 4 + 0 + 2 plinth records, not multiplied by quantity
    const state = (await as(db, 'viewer@example.com', 'GET', '/api/state/construction')).body.state
    expect(state.foundations.map((f: { number: string; quantity: number; plinthsPerFoundation: number | null }) => [f.number, f.quantity, f.plinthsPerFoundation])).toEqual([['FND-101', 18, 4], ['FND-102', 6, null], ['FND-103', 1, 2]])
  })

  it('rejects zero, negative and decimal quantities, and the database refuses them too', async () => {
    const { db, aid } = await setupArea()
    for (const q of [0, -1, 2.5]) expect((await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, `X-${n++}`, '', 1, q])).status, String(q)).toBe(422)
    expect(count(db, 'foundations')).toBe(0)
    expect(() => db.raw.exec("INSERT INTO foundations (id, area_id, number, quantity, seq) VALUES ('f-x', '" + aid + "', 'Z', 0, 0)")).toThrow(/CHECK/)
  })

  it('edits the quantity through the API; only Admins may', async () => {
    const { db, aid } = await setupArea()
    await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'FND-101', '', 4, 18])
    const { id } = row(db, 'FND-101')
    for (const who of ['editor@example.com', 'viewer@example.com']) expect((await cmd(db, who, 'construction', 'editFoundation', [id, { quantity: 2 }])).status).toBe(403)
    expect(row(db, 'FND-101').quantity).toBe(18)
    expect((await cmd(db, 'admin@example.com', 'construction', 'editFoundation', [id, { quantity: 20 }])).status).toBe(200)
    expect(row(db, 'FND-101')).toMatchObject({ id, quantity: 20, per: 4 })
    expect((await cmd(db, 'admin@example.com', 'construction', 'editFoundation', [id, { quantity: 0 }])).status).toBe(422)
    expect((await cmd(db, 'admin@example.com', 'construction', 'editFoundation', [id, { plinthsPerFoundation: 6 }])).status).toBe(200)
    expect(count(db, 'plinths')).toBe(6)
    expect((await as(db, 'admin@example.com', 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('materials keep their stable foundation reference and quantities when the foundation quantity changes or it is renamed', async () => {
    const { db, aid } = await setupArea()
    await cmd(db, 'admin@example.com', 'construction', 'createFoundation', [aid, 'FND-101', '', 4, 18])
    const { id } = row(db, 'FND-101')
    const add = await cmd(db, 'editor@example.com', 'materials', 'addMaterials', [[material({ areaId: aid, foundationId: id, requiredQty: 24 })]])
    expect(add.status).toBe(200)
    await cmd(db, 'admin@example.com', 'construction', 'editFoundation', [id, { quantity: 40 }])
    await cmd(db, 'admin@example.com', 'construction', 'renameFoundation', [id, 'FND-101A'])
    expect(db.raw.prepare('SELECT foundation_id, required_qty FROM manual_materials').get()).toEqual({ foundation_id: id, required_qty: 24 })
    expect((await cmd(db, 'admin@example.com', 'construction', 'archiveFoundation', [id, true])).body.error).toMatch(/1 active material is assigned/)
    const m = (await as(db, 'viewer@example.com', 'GET', '/api/state/materials')).body.state
    expect(m.manual[0]).toMatchObject({ foundationId: id, footingType: 'FND-101', requiredQty: 24 }) // snapshot text kept; display follows the record
  })

  it('migration 0008 keeps every existing foundation: same id, quantity 1, plinths per foundation = its existing plinth records', () => {
    const db = createTestDb({ migrate: false })
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql', '0006_material_entry_references.sql', '0007_fresh_install_organization_projects.sql']) applyMigrationFile(db.raw, f)
    db.raw.exec("INSERT INTO companies (id, name) VALUES ('c', 'C'); INSERT INTO projects (id, company_id, name, job_number, status) VALUES ('p', 'c', 'P', '1', 'planning'); INSERT INTO areas (id, project_id, name, sequence) VALUES ('a', 'p', 'A', 1)")
    db.raw.exec("INSERT INTO foundations (id, area_id, number, description, notes, seq) VALUES ('f-a-1', 'a', '1', 'd', 'n', 0), ('f-a-2', 'a', '2', '', '', 1)")
    db.raw.exec("INSERT INTO plinths (id, foundation_id, idx, notes, seq) VALUES ('f-a-1-p1', 'f-a-1', 1, '', 0), ('f-a-1-p2', 'f-a-1', 2, '', 1)")
    const before = db.raw.prepare('SELECT id, area_id, number, description, notes FROM foundations ORDER BY id').all()
    applyMigrationFile(db.raw, '0008_foundation_quantity.sql')
    expect(db.raw.prepare('SELECT id, area_id, number, description, notes FROM foundations ORDER BY id').all()).toEqual(before)
    expect(db.raw.prepare('SELECT id, quantity, plinths_per_foundation AS per FROM foundations ORDER BY id').all()).toEqual([{ id: 'f-a-1', quantity: 1, per: 2 }, { id: 'f-a-2', quantity: 1, per: 0 }])
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM plinths').get()).toEqual({ n: 2 })
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '8' })
  })
})
