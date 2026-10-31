import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { resetAuthCache } from '../auth'
import { clock, NOW, TODAY } from './helpers'
import { applyMigrationFile, createTestDb, type TestDb } from './sqliteD1'
import { installLegacyReceiptCommands } from './legacyCommands'

installLegacyReceiptCommands()

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
/** A request from a verified Access identity (a real signed token), against the given database. */
async function as(db: TestDb, email: string, method: string, path: string, body?: unknown, env: Partial<Env> = {}, headers: Record<string, string> = {}) {
  resetAuthCache()
  const full: Env = { DB: db.d1, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, NEXUS_ENV: 'staging', ...env }
  const res = await handleApi(new Request(`https://staging.nexus.example${path}`, { method, headers: { 'cf-access-jwt-assertion': await token(email), 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), full, clock(), certs)
  return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}
let n = 0
const cmd = (db: TestDb, email: string, name: string, args: unknown[], extra: Record<string, unknown> = {}, env: Partial<Env> = {}, headers: Record<string, string> = {}) =>
  as(db, email, 'POST', '/api/commands', { module: 'materials', name, args, requestId: `req-rbac-${Date.now().toString(36)}-${n++}-xxxxxxxx`, clientToday: TODAY, ...extra }, env, headers)
const material = (over: Record<string, unknown> = {}) => ({
  areaId: 'mole-sieve', foundationId: '', anchorageTypeId: '', category: 'bolt', name: 'Anchor bolt', description: '', specification: 'Gr.36', size: '3/4"', requiredQty: 10, unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '', ...over,
})

function setup() {
  const db = createTestDb()
  give(db, 'admin@example.com', 'admin')
  give(db, 'editor@example.com', 'editor')
  give(db, 'viewer@example.com', 'viewer')
  return db
}
const count = (db: TestDb, table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('server-side authorization on every mutation', () => {
  it('rejects anyone with no assigned role, for reads and writes — being signed in grants nothing', async () => {
    const db = setup()
    const read = await as(db, 'stranger@example.com', 'GET', '/api/state/materials')
    expect(read).toMatchObject({ status: 403, body: { code: 'no-role' } })
    const write = await cmd(db, 'stranger@example.com', 'addMaterials', [[material()]])
    expect(write).toMatchObject({ status: 403, body: { code: 'no-role' } })
    expect(count(db, 'manual_materials')).toBe(0)
    const session = await as(db, 'stranger@example.com', 'GET', '/api/session')
    expect(session.body).toMatchObject({ user: 'stranger@example.com', role: null, permissions: [] })
  })

  it('fails closed when the roles table cannot be read (migration not applied)', async () => {
    const db = createTestDb()
    db.raw.exec('DROP TABLE user_roles')
    expect((await as(db, 'admin@example.com', 'GET', '/api/state/materials', undefined, { INITIAL_ADMIN_EMAIL: 'admin@example.com' })).status).toBe(403)
    expect((await cmd(db, 'admin@example.com', 'addMaterials', [[material()]])).status).toBe(403)
  })

  it('a viewer can read but every direct API mutation is refused', async () => {
    const db = setup()
    expect((await as(db, 'viewer@example.com', 'GET', '/api/state/materials')).status).toBe(200)
    for (const [name, args] of [
      ['addMaterials', [[material()]]], ['editMaterial', ['mm-x', { notes: 'x' }]], ['bulkEditMaterials', [['mm-x'], { supplier: 'x' }]], ['archiveMaterials', [['mm-x'], true]],
      ['addReceipt', ['mm-x', { date: TODAY, qty: 1, reference: '', note: '' }, TODAY]], ['removeReceipt', ['mm-x', 'rc-x']], ['setNotes', ['mm-x', 'n']], ['setOrdered', ['mm-x', 1]], ['confirmNoReceipts', ['mm-x', true]],
    ] as [string, unknown[]][]) {
      const r = await cmd(db, 'viewer@example.com', name, args)
      expect(r, name).toMatchObject({ status: 403, body: { code: 'forbidden' } })
    }
    const fleet = await as(db, 'viewer@example.com', 'POST', '/api/commands', { module: 'fleet', name: 'recordOdometer', args: ['veh-T6005', { date: TODAY, reading: 1, note: '' }, TODAY], requestId: 'req-viewer-fleet-xxxx', clientToday: TODAY })
    expect(fleet.status).toBe(403)
    expect(count(db, 'manual_materials')).toBe(0)
    expect(count(db, 'change_log')).toBe(0)
  })

  it('a viewer cannot reach backups, integrity, migration or role management', async () => {
    const db = setup()
    for (const [m, p, b] of [['GET', '/api/backup'], ['GET', '/api/integrity'], ['POST', '/api/migrate/preview', {}], ['POST', '/api/migrate/apply', {}], ['GET', '/api/roles'], ['POST', '/api/roles', { email: 'viewer@example.com', role: 'admin' }]] as [string, string, unknown?][]) {
      expect((await as(db, 'viewer@example.com', m, p, b)).status, p).toBe(403)
      expect((await as(db, 'editor@example.com', m, p, b)).status, `editor ${p}`).toBe(403)
    }
    expect(db.raw.prepare("SELECT role FROM user_roles WHERE email = 'viewer@example.com'").get()).toEqual({ role: 'viewer' })
  })

  it('an editor adds, edits, bulk-edits and records deliveries, but cannot archive or void receipts', async () => {
    const db = setup()
    const add = await cmd(db, 'editor@example.com', 'addMaterials', [[material(), material({ name: 'Nut', category: 'nut' })]])
    expect(add.status).toBe(200)
    const [a, b] = add.body.state.manual
    expect((await cmd(db, 'editor@example.com', 'editMaterial', [a.id, { requiredQty: 12 }])).status).toBe(200)
    expect((await cmd(db, 'editor@example.com', 'bulkEditMaterials', [[a.id, b.id], { supplier: 'Acme' }])).status).toBe(200)
    const rec = await cmd(db, 'editor@example.com', 'addReceipt', [a.id, { date: TODAY, qty: 5, reference: 'DN-1', note: '' }, TODAY])
    expect(rec.status).toBe(200)
    expect(rec.body.state.manual[0].receipts[0].by).toBe('editor@example.com')
    expect((await cmd(db, 'editor@example.com', 'archiveMaterials', [[a.id], true])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'removeReceipt', [a.id, rec.body.state.manual[0].receipts[0].id])).status).toBe(403)
    expect((await cmd(db, 'editor@example.com', 'clearTracker', [])).status).toBe(400) // never a server command
    expect(count(db, 'manual_material_receipts')).toBe(1)
  })

  it('an admin can archive and void; unknown commands need admin', async () => {
    const db = setup()
    const add = await cmd(db, 'admin@example.com', 'addMaterials', [[material()]])
    const id = add.body.state.manual[0].id
    await cmd(db, 'admin@example.com', 'addReceipt', [id, { date: TODAY, qty: 5, reference: '', note: '' }, TODAY])
    const state = (await as(db, 'admin@example.com', 'GET', '/api/state/materials')).body.state
    expect((await cmd(db, 'admin@example.com', 'removeReceipt', [id, state.manual[0].receipts[0].id])).status).toBe(200)
    expect((await cmd(db, 'admin@example.com', 'archiveMaterials', [[id], true])).body.state.manual[0].archived).toBe(true)
  })

  it('ignores any role the client claims', async () => {
    const db = setup()
    const forged: Record<string, string>[] = [{ 'x-nexus-role': 'admin' }, { 'x-role': 'admin' }, { 'cf-access-authenticated-user-email': 'admin@example.com' }]
    for (const h of forged) expect((await cmd(db, 'viewer@example.com', 'addMaterials', [[material()]], { role: 'admin', actor: 'admin@example.com', permissions: ['materials.add'] }, {}, h)).status).toBe(403)
    expect(count(db, 'manual_materials')).toBe(0)
    // a token for one identity cannot act as another
    expect((await as(db, 'viewer@example.com', 'POST', '/api/roles', { email: 'viewer@example.com', role: 'admin' }, {}, { 'x-nexus-role': 'admin' })).status).toBe(403)
  })

  it('records the verified identity and server time in the history, whatever the client says', async () => {
    const db = setup()
    const r = await cmd(db, 'editor@example.com', 'addMaterials', [[material()]], { actor: 'someone-else@example.com' })
    expect(r.status).toBe(200)
    const rows = db.raw.prepare('SELECT actor, action, at FROM material_audit').all() as { actor: string; action: string; at: string }[]
    expect(rows).toEqual([{ actor: 'editor@example.com', action: 'created', at: NOW.toISOString() }])
    expect(db.raw.prepare('SELECT actor FROM change_log').all()).toEqual([{ actor: 'editor@example.com' }])
    expect(db.raw.prepare('SELECT created_by FROM manual_materials').get()).toEqual({ created_by: 'editor@example.com' })
  })

  it('the history cannot be changed through the database layer the app uses', async () => {
    const db = setup()
    await cmd(db, 'editor@example.com', 'addMaterials', [[material()]])
    expect(() => db.raw.exec("UPDATE material_audit SET summary = 'edited'")).toThrow(/append-only/)
  })

  it('refuses invalid input before anything is written', async () => {
    const db = setup()
    expect((await cmd(db, 'editor@example.com', 'addMaterials', [[material({ requiredQty: -3 })]])).status).toBe(422)
    expect((await cmd(db, 'editor@example.com', 'addMaterials', [[material({ name: '' })]])).status).toBe(422)
    expect(count(db, 'manual_materials')).toBe(0)
    expect(count(db, 'material_audit')).toBe(0)
  })

  it('refuses a duplicate on the server too, and a repeated request is not applied twice', async () => {
    const db = setup()
    await cmd(db, 'editor@example.com', 'addMaterials', [[material()]])
    expect((await cmd(db, 'editor@example.com', 'addMaterials', [[material()]])).status).toBe(422)
    const id = 'req-idem-aaaaaaaaaaaa'
    await cmd(db, 'editor@example.com', 'addMaterials', [[material({ name: 'Other' })]], { requestId: id })
    await cmd(db, 'editor@example.com', 'addMaterials', [[material({ name: 'Other' })]], { requestId: id })
    expect(count(db, 'manual_materials')).toBe(2)
  })
})

describe('role assignment and the first administrator', () => {
  it('nobody becomes an administrator just by signing in, even with the right-looking email', async () => {
    const db = createTestDb()
    expect((await as(db, 'admin@example.com', 'GET', '/api/state/materials')).status).toBe(403)
    expect((await as(db, 'owner@example.com', 'GET', '/api/session')).body.role).toBeNull()
    expect(count(db, 'user_roles')).toBe(0)
  })

  it('INITIAL_ADMIN_EMAIL provisions the first administrator only, only for that verified identity, and only while none exists', async () => {
    const db = createTestDb()
    const env = { INITIAL_ADMIN_EMAIL: 'First.Admin@Example.com' }
    expect((await as(db, 'someone@example.com', 'GET', '/api/session', undefined, env)).body.role).toBeNull()
    const first = await as(db, 'first.admin@example.com', 'GET', '/api/session', undefined, env)
    expect(first.body.role).toBe('admin')
    expect(db.raw.prepare('SELECT email, role, assigned_by FROM user_roles').all()).toEqual([{ email: 'first.admin@example.com', role: 'admin', assigned_by: 'bootstrap:INITIAL_ADMIN_EMAIL' }])
    expect(count(db, 'role_audit')).toBe(1)
    // once an administrator exists the setting does nothing more: demoted or removed, the person is not re-promoted
    await as(db, 'first.admin@example.com', 'POST', '/api/roles', { email: 'second@example.com', role: 'admin' }, env)
    await as(db, 'second@example.com', 'POST', '/api/roles', { email: 'first.admin@example.com', role: null }, env)
    expect((await as(db, 'first.admin@example.com', 'GET', '/api/session', undefined, env)).body.role).toBeNull()
  })

  it('without INITIAL_ADMIN_EMAIL the first admin must be provisioned directly in the database', async () => {
    const db = createTestDb()
    expect((await as(db, 'first.admin@example.com', 'GET', '/api/session')).body.role).toBeNull()
  })

  it('admins manage roles; every change is logged; the last administrator cannot be removed', async () => {
    const db = setup()
    const r = await as(db, 'admin@example.com', 'POST', '/api/roles', { email: 'New.Person@Example.com', role: 'editor' })
    expect(r.status).toBe(200)
    expect(r.body.roles.find((x: { email: string }) => x.email === 'new.person@example.com')).toMatchObject({ role: 'editor', assignedBy: 'admin@example.com' })
    expect((await as(db, 'new.person@example.com', 'POST', '/api/commands', { module: 'materials', name: 'addMaterials', args: [[material()]], requestId: 'req-newperson-aaaaaa', clientToday: TODAY })).status).toBe(200)
    await as(db, 'admin@example.com', 'POST', '/api/roles', { email: 'new.person@example.com', role: 'viewer' })
    expect((await as(db, 'new.person@example.com', 'POST', '/api/commands', { module: 'materials', name: 'addMaterials', args: [[material({ name: 'x' })]], requestId: 'req-newperson-bbbbbb', clientToday: TODAY })).status).toBe(403)
    expect((await as(db, 'admin@example.com', 'POST', '/api/roles', { email: 'admin@example.com', role: 'editor' })).body.code).toBe('last-admin')
    expect((await as(db, 'admin@example.com', 'POST', '/api/roles', { email: 'admin@example.com', role: null })).body.code).toBe('last-admin')
    expect((await as(db, 'admin@example.com', 'POST', '/api/roles', { email: 'not-an-email', role: 'viewer' })).status).toBe(400)
    expect((await as(db, 'admin@example.com', 'POST', '/api/roles', { email: 'x@example.com', role: 'owner' })).status).toBe(400)
    const log = db.raw.prepare('SELECT actor, target, from_role, to_role FROM role_audit ORDER BY id').all()
    expect(log).toEqual([{ actor: 'admin@example.com', target: 'new.person@example.com', from_role: null, to_role: 'editor' }, { actor: 'admin@example.com', target: 'new.person@example.com', from_role: 'editor', to_role: 'viewer' }])
  })
})

describe('environments without real authentication', () => {
  it('the public demo has no API at all, so no role can reach data', async () => {
    const db = setup()
    for (const p of ['/api/state/materials', '/api/commands', '/api/roles', '/api/session']) expect((await as(db, 'admin@example.com', p === '/api/commands' ? 'POST' : 'GET', p, p === '/api/commands' ? {} : undefined, { NEXUS_ENV: 'demo' })).status).toBe(404)
    expect(count(db, 'manual_materials')).toBe(0)
  })

  it('with Access unconfigured nobody can read or write, whatever else is set', async () => {
    const db = setup()
    const res = await handleApi(new Request('https://staging.nexus.example/api/commands', { method: 'POST', body: '{}', headers: { 'x-nexus-role': 'admin' } }), { DB: db.d1, NEXUS_ENV: 'staging', DEV_BYPASS_AUTH: 'true', DEV_BYPASS_ROLE: 'admin', INITIAL_ADMIN_EMAIL: 'admin@example.com' }, clock())
    expect(res.status).toBe(503) // the development bypass is honoured for localhost only
  })

  it('the localhost development identity takes its role from DEV_BYPASS_ROLE and can be set to none', async () => {
    const db = createTestDb()
    const local = (role: string | undefined) => handleApi(new Request('http://localhost/api/state/materials'), { DB: db.d1, DEV_BYPASS_AUTH: 'true', NEXUS_ENV: 'test', DEV_BYPASS_ROLE: role }, clock()).then((r) => r.status)
    expect(await local('viewer')).toBe(200)
    expect(await local('none')).toBe(403)
  })
})

describe('migration 0005 on an existing database', () => {
  it('adds the new structures without changing or losing any existing material record', () => {
    const db = createTestDb({ migrate: false })
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql']) db.raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
    db.raw.exec(readFileSync('seeds/reef/0002_seed_reef_and_fleet.sql', 'utf8'))
    db.raw.exec("INSERT INTO material_import_batches (id, file_name, file_size, sha256, imported_at, counts_json, seq) VALUES ('b1','w.xlsx',1,NULL,'2026-10-01T00:00:00Z','{}',0)")
    db.raw.exec("INSERT INTO material_lines (id, batch_id, source_sheet, source_row, area, footing_type, anchorage_type, footings, plinths, bolts, component, category, required_qty, calc_json, source_status, seq) VALUES ('l1','b1','Material List',4,'North','F1','A1',1,1,1,'Bolt','bolt',24,'{}','Delivered',0)")
    db.raw.exec("INSERT INTO material_line_ops (line_id, ordered_qty, confirmed_no_receipts, notes) VALUES ('l1', 24, 0, 'kept')")
    db.raw.exec("INSERT INTO material_receipts (id, line_id, receipt_date, qty, reference, note, seq) VALUES ('rc1','l1','2026-10-05',10,'DN','n',0)")
    const before = db.raw.prepare('SELECT * FROM material_lines').all()
    applyMigrationFile(db.raw, '0005_materials_management_and_roles.sql')
    expect(db.raw.prepare('SELECT * FROM material_lines').all()).toEqual(before)
    expect(db.raw.prepare('SELECT line_id, ordered_qty, notes, supplier, archived FROM material_line_ops').get()).toEqual({ line_id: 'l1', ordered_qty: 24, notes: 'kept', supplier: '', archived: 0 })
    expect(db.raw.prepare('SELECT id, qty, recorded_by FROM material_receipts').get()).toEqual({ id: 'rc1', qty: 10, recorded_by: '' }) // never attributed after the fact
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '5' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM user_roles').get()).toEqual({ n: 0 }) // no one is given a role by the migration
  })
})

/* ── Material entry references (migration 0006) ─────────────────────────── */

const admin = 'admin@example.com', editor = 'editor@example.com', viewer = 'viewer@example.com'
const construct = (db: TestDb, email: string, name: string, args: unknown[]) => as(db, email, 'POST', '/api/commands', { module: 'construction', name, args, requestId: `req-con-${Date.now().toString(36)}-${n++}-xxxxxxxx`, clientToday: TODAY })

describe('materials reference project records on the server', () => {
  it('migration 0006 seeds only the confirmed preference: Anchor Bolts → Nucor', async () => {
    const db = setup()
    expect(db.raw.prepare('SELECT category, supplier_id FROM category_suppliers').all()).toEqual([{ category: 'bolt', supplier_id: 'sup-nucor' }])
    expect(db.raw.prepare('SELECT id, name, name_key FROM suppliers').all()).toEqual([{ id: 'sup-nucor', name: 'Nucor', name_key: 'nucor' }])
    const state = (await as(db, viewer, 'GET', '/api/state/materials')).body.state
    expect(state.preferredSuppliers).toEqual({ bolt: 'sup-nucor' })
    expect(state.suppliers.map((s: { name: string }) => s.name)).toEqual(['Nucor'])
  })

  it('rejects arbitrary text and unknown or mismatched records, with nothing saved', async () => {
    const db = setup()
    for (const bad of [{ areaId: 'Mole Sieve' }, { areaId: 'no-such-area' }, { foundationId: 'typed-by-hand' }, { anchorageTypeId: 'made-up' }, { supplierId: 'Nucor' }]) {
      const r = await cmd(db, editor, 'addMaterials', [[material(bad)]])
      expect(r.status, JSON.stringify(bad)).toBe(422)
    }
    expect(count(db, 'manual_materials')).toBe(0)
  })

  it('stores ids, verifies the foundation belongs to the area, and follows a rename', async () => {
    const db = setup()
    const f = await construct(db, admin, 'createFoundation', ['mole-sieve', '21-01', 'Pump pad', 2])
    expect(f.status).toBe(200)
    const fid = f.body.state.foundations.find((x: { number: string }) => x.number === '21-01').id
    const other = await construct(db, admin, 'createFoundation', ['piperack', '31-01', '', 1])
    const oid = other.body.state.foundations.find((x: { number: string }) => x.number === '31-01').id
    expect((await cmd(db, editor, 'addMaterials', [[material({ foundationId: oid })]])).status).toBe(422) // another area's foundation
    const ok = await cmd(db, editor, 'addMaterials', [[material({ foundationId: fid, supplierId: 'sup-nucor' })]])
    expect(ok.status).toBe(200)
    expect(db.raw.prepare('SELECT area_id, foundation_id, supplier_id, location, supplier FROM manual_materials').get()).toEqual({ area_id: 'mole-sieve', foundation_id: fid, supplier_id: 'sup-nucor', location: '21-01', supplier: 'Nucor' })
    // renaming never breaks the association, and the material's own row does not change
    expect((await construct(db, admin, 'renameFoundation', [fid, '21-01A'])).status).toBe(200)
    expect(db.raw.prepare('SELECT foundation_id, location FROM manual_materials').get()).toEqual({ foundation_id: fid, location: '21-01' })
    expect(db.raw.prepare('SELECT number FROM foundations WHERE id = ?').get(fid)).toEqual({ number: '21-01A' })
    expect((await as(db, admin, 'GET', '/api/integrity')).body.ok).toBe(true)
  })

  it('only Admins create, rename, edit and archive foundations or set up areas; Editors and Viewers cannot', async () => {
    const db = setup()
    for (const [name, args] of [['createFoundation', ['mole-sieve', '21-09', '', 1]], ['renameFoundation', ['x', 'y']], ['editFoundation', ['x', { description: 'd' }]], ['archiveFoundation', ['x', true]], ['createArea', ['reef', 'New Area', []]]] as [string, unknown[]][]) {
      expect((await construct(db, editor, name, args)).status, `editor ${name}`).toBe(403)
      expect((await construct(db, viewer, name, args)).status, `viewer ${name}`).toBe(403)
    }
    expect(count(db, 'foundations')).toBe(0)
    expect((await construct(db, admin, 'createFoundation', ['mole-sieve', '21-09', '', 1])).status).toBe(200)
    expect((await construct(db, admin, 'createFoundation', ['mole-sieve', '21-09', '', 1])).status).toBe(422) // duplicate
    const area = await construct(db, admin, 'createArea', ['reef', 'Control Building', [{ number: '61-01', description: '', plinthCount: 2 }]])
    expect(area.status).toBe(200)
    expect(db.raw.prepare("SELECT a.name, f.number FROM areas a JOIN foundations f ON f.area_id = a.id WHERE a.name = 'Control Building'").get()).toEqual({ name: 'Control Building', number: '61-01' })
  })

  it('other construction edits keep their existing Editor permission', async () => {
    const db = setup()
    await construct(db, admin, 'createFoundation', ['mole-sieve', '21-01', '', 1])
    expect((await construct(db, editor, 'setFoundationNotes', ['f-mole-sieve-21-01', 'note'])).status).toBe(200)
  })

  it('archiving a foundation checks materials on the server, from the database', async () => {
    const db = setup()
    const f = await construct(db, admin, 'createFoundation', ['mole-sieve', '21-01', '', 1])
    const fid = f.body.state.foundations[0].id
    const m = await cmd(db, editor, 'addMaterials', [[material({ foundationId: fid })]])
    expect((await construct(db, admin, 'archiveFoundation', [fid, true])).body.error).toMatch(/1 active material is assigned/)
    await cmd(db, admin, 'archiveMaterials', [[m.body.state.manual[0].id], true])
    expect((await construct(db, admin, 'archiveFoundation', [fid, true])).status).toBe(200)
    expect(db.raw.prepare('SELECT archived FROM foundations WHERE id = ?').get(fid)).toEqual({ archived: 1 })
    expect((await cmd(db, editor, 'addMaterials', [[material({ foundationId: fid, name: 'again' })]])).status).toBe(422) // not selectable once archived
  })

  it('Editors can add a supplier and choose any; only Admins change preferred suppliers or the directory', async () => {
    const db = setup()
    expect((await cmd(db, viewer, 'addSupplier', ['Hilti'])).status).toBe(403)
    const add = await cmd(db, editor, 'addSupplier', ['Hilti'])
    expect(add.status).toBe(200)
    expect((await cmd(db, editor, 'addSupplier', ['HILTI Inc.'])).status).toBe(422) // duplicate by normalised name
    expect((await cmd(db, editor, 'addSupplier', ['nucor'])).status).toBe(422)
    expect(count(db, 'suppliers')).toBe(2)
    for (const [name, args] of [['setPreferredSupplier', ['nut', 'sup-hilti']], ['renameSupplier', ['sup-hilti', 'Hilti Canada']], ['archiveSupplier', ['sup-hilti', true]]] as [string, unknown[]][]) {
      expect((await cmd(db, editor, name, args)).status, `editor ${name}`).toBe(403)
    }
    expect((await cmd(db, admin, 'setPreferredSupplier', ['nut', 'sup-hilti'])).status).toBe(200)
    expect(db.raw.prepare("SELECT supplier_id FROM category_suppliers WHERE category = 'nut'").get()).toEqual({ supplier_id: 'sup-hilti' })
    // editors still override per material
    const m = await cmd(db, editor, 'addMaterials', [[material({ supplierId: 'sup-hilti' })]])
    expect(m.body.state.manual[0].supplierId).toBe('sup-hilti')
    // changing the preference leaves existing materials alone
    await cmd(db, admin, 'setPreferredSupplier', ['nut', null])
    expect(db.raw.prepare('SELECT supplier_id FROM manual_materials').get()).toEqual({ supplier_id: 'sup-hilti' })
    expect(db.raw.prepare("SELECT action, actor FROM material_audit WHERE action = 'configured' ORDER BY seq").all().every((r) => (r as { actor: string }).actor.length > 0)).toBe(true)
  })

  it('the database itself refuses a second supplier with the same normalised name', () => {
    const db = setup()
    expect(() => db.raw.exec("INSERT INTO suppliers (id, name, name_key, seq) VALUES ('sup-x', 'NUCOR', 'nucor', 5)")).toThrow(/UNIQUE/)
  })

  it('legacy text materials stay readable and are not rewritten by unrelated edits', async () => {
    const db = setup()
    // an entry from before 0006: text only, no ids
    db.raw.exec("INSERT INTO manual_materials (id, area, location, anchorage_ref, category, name, required_qty, unit, supplier, seq) VALUES ('mm-legacy', 'Mole Sieve', 'F-typed', 'AB-9', 'bolt', 'Legacy bolt', 5, 'ea', 'Some Vendor', 0)")
    const state = (await as(db, viewer, 'GET', '/api/state/materials')).body.state
    expect(state.manual[0]).toMatchObject({ area: 'Mole Sieve', footingType: 'F-typed', anchorageType: 'AB-9', supplier: 'Some Vendor', areaId: null, supplierId: null })
    const r = await cmd(db, editor, 'editMaterial', ['mm-legacy', { notes: 'checked' }])
    expect(r.status).toBe(200)
    expect(db.raw.prepare('SELECT area, location, anchorage_ref, supplier, area_id, supplier_id, notes FROM manual_materials').get()).toEqual({ area: 'Mole Sieve', location: 'F-typed', anchorage_ref: 'AB-9', supplier: 'Some Vendor', area_id: null, supplier_id: null, notes: 'checked' })
    // linking is an explicit edit and is audited
    const link = await cmd(db, editor, 'editMaterial', ['mm-legacy', { areaId: 'mole-sieve', supplierId: 'sup-nucor' }])
    expect(link.status).toBe(200)
    expect(db.raw.prepare('SELECT area_id, supplier_id, supplier FROM manual_materials').get()).toEqual({ area_id: 'mole-sieve', supplier_id: 'sup-nucor', supplier: 'Nucor' })
    expect(count(db, 'material_audit')).toBe(2)
  })

  it('migration 0006 on an existing database keeps every record and links nothing by itself', () => {
    const db = createTestDb({ migrate: false })
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql', '0004_vehicle_planning_and_demo_inspections.sql', '0005_materials_management_and_roles.sql']) db.raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
    db.raw.exec(readFileSync('seeds/reef/0002_seed_reef_and_fleet.sql', 'utf8'))
    db.raw.exec("INSERT INTO foundations (id, area_id, number, description, notes, seq) VALUES ('f1', 'mole-sieve', '21-01', 'd', 'n', 0)")
    db.raw.exec("INSERT INTO manual_materials (id, area, location, anchorage_ref, category, name, required_qty, supplier, seq) VALUES ('mm1', 'Mole Sieve', '21-01', 'AB-1', 'bolt', 'Bolt', 5, 'Vendor', 0)")
    applyMigrationFile(db.raw, '0006_material_entry_references.sql')
    expect(db.raw.prepare('SELECT id, number, description, notes, archived FROM foundations').get()).toEqual({ id: 'f1', number: '21-01', description: 'd', notes: 'n', archived: 0 })
    expect(db.raw.prepare('SELECT area, location, anchorage_ref, supplier, area_id, foundation_id, supplier_id FROM manual_materials').get()).toEqual({ area: 'Mole Sieve', location: '21-01', anchorage_ref: 'AB-1', supplier: 'Vendor', area_id: null, foundation_id: null, supplier_id: null })
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '6' })
  })
})
