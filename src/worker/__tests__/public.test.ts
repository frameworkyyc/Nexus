import { describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { TABLES } from '../db'
import { HIDDEN_COLUMNS, HIDDEN_TABLES, REVIEWED_PUBLIC, SENSITIVE_NAME } from '../publicView'
import { readOnlyDb } from '../publicApi'
import { clock, command, session, TODAY } from './helpers'
import { createTestDb, type TestDb } from './sqliteD1'

/** The public, view-only site and the staging-style (signed-in) API, both reading and writing ONE database. */
const publicEnv = (db: TestDb): Env => ({ DB: db.d1, NEXUS_ENV: 'public' })
async function pub(db: TestDb, method: string, path: string, init: RequestInit = {}) {
  const res = await handleApi(new Request(`https://nexus.example${path}`, { method, ...init }), publicEnv(db), clock())
  const text = await res.text()
  let body: any = null // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body, text, headers: res.headers }
}
/** A fingerprint of everything that could change: row counts of every table and the module versions. */
const fingerprint = (db: TestDb) => {
  const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name)
  return JSON.stringify(tables.map((t) => [t, db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()])) + JSON.stringify(db.raw.prepare('SELECT * FROM module_versions').all())
}

const SECRETS = ['jo.private@example.com', '1HGBH41JXMN109186', 'PLATE-777', 'Nucor Secret Supply', 'PO-SECRET-42', 'internal note xyz', 'contact@acme.example']

async function populated() {
  const db = createTestDb({ seed: false })
  db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES ('jo.private@example.com', 'admin', 'test', '2026-10-21T00:00:00Z')").run()
  const s = session(db, { NEXUS_ENV: 'staging' })
  const c = (m: string, n: string, a: unknown[]) => command(s, m, n, a)
  expect((await c('construction', 'createOrganization', [{ name: 'Northline' }])).status).toBe(200)
  const proj = await c('construction', 'createProject', [{ name: 'Terrestrial' }])
  const pid = proj.body.state.projects[0].id
  await c('construction', 'createArea', [pid, 'E-House', []])
  await c('construction', 'addAnchorageType', [pid, 'OP1-D2', 'Typical'])
  const st = (await s.call('GET', '/api/state/construction')).body.state
  const A = st.anchorageTypes[0].id, area = st.areas[0].id
  await c('construction', 'setAnchorageComponents', [A, [{ kind: 'bolt', qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm', thread: 'both-ends', topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }]])
  expect((await c('construction', 'createFoundation', [area, 'OP-1', 'Typical footing', null, 12, { groups: [{ anchorageTypeId: A, count: 3 }] }])).status).toBe(200)
  const veh = await c('fleet', 'addVehicle', [{ unitNumber: 'T-1', kind: 'vehicle', year: 2020, make: 'Ford', model: 'F-150', vin: '1HGBH41JXMN109186', licencePlate: 'PLATE-777', notes: 'internal note xyz' }, pid, TODAY])
  expect(veh.status).toBe(200)
  // a purchase order with a supplier, a PO number, notes and a person recorded
  const m = (await s.call('GET', '/api/state/materials')).body.state
  void m
  const { procurementRows } = await import('@/domains/construction/tracker/procurement')
  const { refreshRequirements } = await import('@/domains/construction/tracker/requirements')
  const mat = (await s.call('GET', '/api/state/materials')).body.state, con = (await s.call('GET', '/api/state/construction')).body.state
  const bolt = procurementRows(refreshRequirements(mat, con, { log: false }), con).find((r) => r.name === 'Anchor bolt')!
  const po = await c('materials', 'createPurchaseOrder', [{ name: 'E-House bolts', number: 'PO-SECRET-42', supplier: 'Nucor Secret Supply', date: '2026-10-20', notes: 'internal note xyz', lines: [{ key: bolt.key, qty: 100 }] }, TODAY])
  expect(po.status).toBe(200)
  const poId = po.body.state.orders[0].id
  expect((await c('materials', 'recordDelivery', [{ orderId: poId, date: '2026-10-21', reference: 'contact@acme.example', note: 'internal note xyz', lines: [{ key: bolt.key, qty: 40 }] }, TODAY])).status).toBe(200)
  await c('materials', 'addSupplier', ['Nucor Secret Supply'])
  db.raw.prepare("UPDATE foundations SET notes = 'internal note xyz'").run()
  db.raw.prepare("UPDATE companies SET contact_name = 'Jo Private', contact_email = 'contact@acme.example', contact_phone = '555-0100', notes = 'internal note xyz'").run()
  return { db, s, pid, area }
}

describe('public view-only API', () => {
  it('needs no sign-in: it answers with no credentials, headers or cookies, and only describes itself as public and read-only', async () => {
    const { db } = await populated()
    const health = await pub(db, 'GET', '/api/health')
    expect(health.body).toEqual({ ok: true, environment: 'public', readOnly: true, database: true, access: true })
    const session1 = await pub(db, 'GET', '/api/session')
    expect(session1.status).toBe(200)
    expect(session1.body).toMatchObject({ user: 'Public visitor', role: 'viewer', permissions: ['view'], readOnly: true })
    for (const m of ['fleet', 'materials', 'construction']) {
      const r = await pub(db, 'GET', `/api/state/${m}`)
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('access-control-allow-origin')).toBeNull() // same-origin only
    }
    expect((await pub(db, 'GET', '/api/state/nope')).status).toBe(404)
  })

  it('refuses every way of changing data, with or without a valid sign-in or an administrator identity, and changes nothing', async () => {
    const { db } = await populated()
    const before = fingerprint(db)
    const body = JSON.stringify({ module: 'construction', name: 'createProject', args: [{ name: 'Hacked' }], requestId: 'req-pub-xxxxxxxxxxxx', clientToday: TODAY })
    const hdr = { 'content-type': 'application/json', 'cf-access-jwt-assertion': 'x.y.z', 'cf-access-authenticated-user-email': 'jo.private@example.com' }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const path of ['/api/commands', '/api/state/construction', '/api/state/materials', '/api/roles', '/api/migrate/apply', '/api/migrate/preview', '/api/session']) {
        const r = await pub(db, method, path, { body: method === 'OPTIONS' ? undefined : body, headers: hdr })
        expect(r.status, `${method} ${path}`).toBe(405)
        expect(r.headers.get('allow')).toBe('GET, HEAD')
      }
    }
    expect(fingerprint(db)).toBe(before)
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM projects WHERE name = 'Hacked'").get()).toEqual({ n: 0 })
  })

  it('exposes only health, session and the three module states: no roles, backups, integrity, migration or command endpoints, even by GET', async () => {
    const { db } = await populated()
    for (const path of ['/api/roles', '/api/backup', '/api/integrity', '/api/migrate/preview', '/api/migrate/apply', '/api/commands', '/api/anything', '/api/state', '/api/state/construction/extra', '/api/state/..%2Froles', '/other']) {
      const r = await pub(db, 'GET', path)
      expect(r.status, path).toBe(404)
      expect(r.text).not.toMatch(/jo\.private|Nucor/)
    }
    const head = await pub(db, 'HEAD', '/api/state/materials')
    expect(head.status).toBe(200)
  })

  it('shows the same project data as the signed-in environment, and a change made there appears on the next public read', async () => {
    const { db, s, pid } = await populated()
    const read = async () => (await pub(db, 'GET', '/api/state/construction')).body
    const a = await read()
    const staging = (await s.call('GET', '/api/state/construction')).body
    expect(a.version).toBe(staging.version)
    expect(a.state.foundations.map((f: { number: string }) => f.number)).toEqual(staging.state.foundations.map((f: { number: string }) => f.number))
    expect(a.state.areas.map((x: { name: string }) => x.name)).toEqual(['E-House'])
    // an edit in the editable environment
    expect((await command(s, 'construction', 'createArea', [pid, 'Pipe Rack', []])).status).toBe(200)
    const b = await read()
    expect(b.version).toBe(a.version + 1)
    expect(b.state.areas.map((x: { name: string }) => x.name)).toEqual(['E-House', 'Pipe Rack'])
    // the public reading did not alter the version or anything else
    expect((await read()).version).toBe(b.version)
  })

  it('shows project figures the pages need: foundations, quantities, orders, deliveries and fleet units', async () => {
    const { db } = await populated()
    const mat = (await pub(db, 'GET', '/api/state/materials')).body.state
    expect(mat.orders).toHaveLength(1)
    expect(mat.orders[0]).toMatchObject({ name: 'E-House bolts', date: '2026-10-20' })
    expect(mat.orderLines[0].qty).toBe(100)
    expect(mat.deliveryLines[0].qty).toBe(40)
    const fleet = (await pub(db, 'GET', '/api/state/fleet')).body.state
    expect(fleet.vehicles.map((v: { unitNumber: string }) => v.unitNumber)).toEqual(['T-1'])
    expect(fleet.vehicles[0]).toMatchObject({ make: 'Ford', model: 'F-150' })
  })

  it('never returns people, e-mail addresses, contacts, vehicle identifiers, suppliers, PO numbers, history or internal notes', async () => {
    const { db } = await populated()
    for (const m of ['fleet', 'materials', 'construction']) {
      const r = await pub(db, 'GET', `/api/state/${m}`)
      for (const secret of SECRETS) expect(r.text, `${m} must not contain ${secret}`).not.toContain(secret)
      expect(r.text).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    }
    const mat = (await pub(db, 'GET', '/api/state/materials')).body.state
    expect(mat.orders[0]).toMatchObject({ number: '', supplier: '', supplierId: null, notes: '', createdBy: '' })
    expect(mat.suppliers).toEqual([])
    expect(mat.history).toEqual([])
    expect(mat.deliveries[0]).toMatchObject({ by: '', reference: '', note: '' })
    const fleet = (await pub(db, 'GET', '/api/state/fleet')).body.state
    expect(fleet.vehicles[0]).toMatchObject({ vin: null, licencePlate: null, notes: '' })
    const con = (await pub(db, 'GET', '/api/state/construction')).body.state
    expect(con.company).toMatchObject({ name: 'Northline', contactName: '', contactEmail: '', contactPhone: '', notes: '' })
    // the same records are still complete in the signed-in environment: hiding is a projection, never a deletion
    expect(db.raw.prepare('SELECT supplier, po_number FROM purchase_orders').get()).toEqual({ supplier: 'Nucor Secret Supply', po_number: 'PO-SECRET-42' })
    expect(db.raw.prepare('SELECT vin FROM vehicles').get()).toEqual({ vin: '1HGBH41JXMN109186' })
  })

  it('removes an e-mail address that turns up in free text anywhere (last safety net)', async () => {
    const { db } = await populated()
    db.raw.prepare("UPDATE projects SET description = 'Contact someone@corp.example for access'").run()
    const r = await pub(db, 'GET', '/api/state/construction')
    expect(r.text).not.toContain('someone@corp.example')
    expect(r.body.state.projects[0].description).toBe('Contact  for access')
  })

  it('is switched on by environment only: a request cannot choose it, and the signed-in API is untouched', async () => {
    const { db } = await populated()
    const staging = await handleApi(new Request('https://staging.example/api/state/materials'), { DB: db.d1, NEXUS_ENV: 'staging', ACCESS_TEAM_DOMAIN: 'https://t.cloudflareaccess.com', ACCESS_AUD: 'aud' }, clock())
    expect(staging.status).toBe(401) // still needs Cloudflare Access
    const spoof = await pub(db, 'GET', '/api/state/materials?env=public', { headers: { 'x-nexus-env': 'public' } })
    expect(spoof.status).toBe(200) // (this environment IS public; the point is the header and query do nothing elsewhere)
    const staging2 = await handleApi(new Request('https://staging.example/api/state/materials?env=public', { headers: { 'x-nexus-env': 'public', 'cf-access-jwt-assertion': 'x' } }), { DB: db.d1, NEXUS_ENV: 'staging', ACCESS_TEAM_DOMAIN: 'https://t.cloudflareaccess.com', ACCESS_AUD: 'aud' }, clock())
    expect(staging2.status).toBe(401)
  })

  it('without a database it says so and shows nothing', async () => {
    const r = await handleApi(new Request('https://nexus.example/api/state/materials'), { NEXUS_ENV: 'public' }, clock())
    expect(r.status).toBe(503)
    expect((await handleApi(new Request('https://nexus.example/api/health'), { NEXUS_ENV: 'public' }, clock()).then((x) => x.json()))).toMatchObject({ database: false })
  })
})

describe('the read-only database wrapper', () => {
  it('prepares SELECT statements only: no INSERT, UPDATE, DELETE, DROP, ALTER, PRAGMA, ATTACH, WITH-write or stacked statements, and statements cannot run()', async () => {
    const db = createTestDb({ seed: false })
    const ro = readOnlyDb(db.d1)
    expect(await ro.prepare('SELECT COUNT(*) AS n FROM projects').first()).toEqual({ n: 0 })
    expect((await ro.prepare('  select value from schema_info where key = ?').bind('schema_version').first())).toBeTruthy()
    for (const sql of [
      "INSERT INTO projects (id) VALUES ('x')", "UPDATE projects SET name = 'x'", 'DELETE FROM projects', 'DROP TABLE projects', 'ALTER TABLE projects ADD COLUMN x TEXT',
      'PRAGMA writable_schema = 1', "ATTACH DATABASE 'x' AS y", 'WITH t AS (SELECT 1) INSERT INTO projects SELECT * FROM t', 'REPLACE INTO projects (id) VALUES (1)',
      'SELECT 1; DROP TABLE projects', 'CREATE TABLE z (a)', 'VACUUM', '', '-- comment\nDELETE FROM projects', '/* x */ DELETE FROM projects',
    ]) expect(() => ro.prepare(sql), sql).toThrow(/read-only/)
    await expect(ro.prepare('SELECT 1').run()).rejects.toThrow(/read-only/)
    // batch() accepts only statements that were prepared through the guard
    expect(() => ro.batch([db.d1.prepare('DELETE FROM projects')])).toThrow(/read-only/)
    expect(await ro.batch([ro.prepare('SELECT 1 AS a')])).toBeTruthy()
    expect(Object.keys(ro).sort()).toEqual(['batch', 'prepare']) // no exec(), dump() or anything else to reach
  })
})

describe('the public policy covers every column that could hold personal or internal information', () => {
  it('every sensitive-looking column is either hidden or explicitly reviewed as public', () => {
    const undecided: string[] = []
    for (const t of TABLES) for (const col of t.columns) if (SENSITIVE_NAME.test(col) && !(col in HIDDEN_COLUMNS) && !(REVIEWED_PUBLIC as readonly string[]).includes(col)) undecided.push(`${t.name}.${col}`)
    expect(undecided).toEqual([])
  })
  it('hidden tables exist and no hidden column is misspelled', () => {
    const names = new Set(TABLES.map((t) => t.name))
    for (const t of HIDDEN_TABLES) expect(names.has(t) || ['category_suppliers', 'material_audit', 'suppliers'].includes(t)).toBe(true)
    const cols = new Set(TABLES.flatMap((t) => t.columns))
    for (const c of Object.keys(HIDDEN_COLUMNS)) expect(cols.has(c), c).toBe(true)
  })
})
