import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handleApi, type Env } from '../api'
import { TABLES } from '../db'
import { HIDDEN_COLUMNS, HIDDEN_TABLES, REVIEWED_PUBLIC, SENSITIVE_NAME } from '../publicView'
import { readOnlyDb } from '../readOnlyDb'
import { clock, command, session, TODAY, NOW } from './helpers'
import { createTestDb, type TestDb } from './sqliteD1'

/** An in-memory stand-in for the private R2 bucket, recording every write. */
class MemoryBucket {
  objects = new Map<string, { body: string; meta: Record<string, string> }>()
  puts = 0
  failPuts = false
  async put(key: string, value: string, options?: { customMetadata?: Record<string, string> }) { if (this.failPuts) throw new Error('R2 unavailable'); this.puts++; this.objects.set(key, { body: value, meta: options?.customMetadata ?? {} }) }
  async head(key: string) { const o = this.objects.get(key); return o ? { customMetadata: o.meta } : null }
  async get(key: string) { const o = this.objects.get(key); return o ? { text: async () => o.body } : null }
  /** What the public site is given: the read side only. */
  reader() { return { get: (k: string) => this.get(k) } }
}
/** The public site: no database in its environment at all, and a throwing DB trap in case anything ever reaches for one. */
const publicEnv = (bucket: MemoryBucket, extra: Record<string, unknown> = {}): Env => {
  const env = { NEXUS_ENV: 'public', PUBLIC_SNAPSHOT: bucket.reader(), ...extra } as Env
  Object.defineProperty(env, 'DB', { get() { throw new Error('The public site must never touch a database.') }, enumerable: false })
  return env
}
async function pub(bucket: MemoryBucket, method: string, path: string, init: RequestInit = {}, extra: Record<string, unknown> = {}) {
  const res = await handleApi(new Request(`https://nexus.example${path}`, { method, ...init }), publicEnv(bucket, extra), clock())
  const text = await res.text()
  let body: any = null // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body, text, headers: res.headers }
}
/** A fingerprint of everything that could change in the editable database: row counts of every table and the module versions. */
const fingerprint = (db: TestDb) => {
  const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name)
  return JSON.stringify(tables.map((t) => [t, db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()])) + JSON.stringify(db.raw.prepare('SELECT * FROM module_versions').all())
}

const SECRETS = ['jo.private@example.com', '1HGBH41JXMN109186', 'PLATE-777', 'Nucor Secret Supply', 'PO-SECRET-42', 'internal note xyz', 'contact@acme.example']

async function populated() {
  const bucket = new MemoryBucket()
  const db = createTestDb({ seed: false })
  db.raw.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES ('jo.private@example.com', 'admin', 'test', '2026-10-21T00:00:00Z')").run()
  const s = session(db, { NEXUS_ENV: 'staging', PUBLIC_SNAPSHOT: bucket as never })
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
  // direct database edits (made outside Nexus's commands) then a fresh publish, as the scheduled publisher would do
  const { publishSnapshot } = await import('../snapshot')
  await publishSnapshot(db.d1, bucket, clock())
  return { db, s, pid, area, bucket }
}

describe('public view-only API (reads the sanitized snapshot, has no database)', () => {
  it('needs no sign-in and no database: it answers with no credentials, and describes itself as public and read-only', async () => {
    const { bucket } = await populated()
    const health = await pub(bucket, 'GET', '/api/health')
    expect(health.body).toEqual({ ok: true, environment: 'public', readOnly: true, database: true, access: true })
    const session1 = await pub(bucket, 'GET', '/api/session')
    expect(session1.status).toBe(200)
    expect(session1.body).toMatchObject({ user: 'Public visitor', role: 'viewer', permissions: ['view'], readOnly: true })
    expect(session1.body.asOf).toBe(NOW.toISOString())
    for (const m of ['fleet', 'materials', 'construction']) {
      const r = await pub(bucket, 'GET', `/api/state/${m}`)
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(r.headers.get('access-control-allow-origin')).toBeNull() // same-origin only
    }
    expect((await pub(bucket, 'GET', '/api/state/nope')).status).toBe(404)
  })

  it('refuses every way of changing anything, with or without a valid sign-in or an administrator identity, and neither the snapshot nor the database changes', async () => {
    const { db, bucket } = await populated()
    const before = fingerprint(db), snapshotBefore = bucket.objects.get('snapshot.json')!.body, puts = bucket.puts
    const body = JSON.stringify({ module: 'construction', name: 'createProject', args: [{ name: 'Hacked' }], requestId: 'req-pub-xxxxxxxxxxxx', clientToday: TODAY })
    const hdr = { 'content-type': 'application/json', 'cf-access-jwt-assertion': 'x.y.z', 'cf-access-authenticated-user-email': 'jo.private@example.com' }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const path of ['/api/commands', '/api/state/construction', '/api/state/materials', '/api/roles', '/api/migrate/apply', '/api/migrate/preview', '/api/session', '/api/snapshot']) {
        const r = await pub(bucket, method, path, { body: method === 'OPTIONS' ? undefined : body, headers: hdr })
        expect(r.status, `${method} ${path}`).toBe(405)
        expect(r.headers.get('allow')).toBe('GET, HEAD')
      }
    }
    expect(fingerprint(db)).toBe(before)
    expect(bucket.objects.get('snapshot.json')!.body).toBe(snapshotBefore)
    expect(bucket.puts).toBe(puts) // the public site cannot write to the bucket either
  })

  it('exposes only health, session and the three module states: no roles, backups, integrity, migration, command or snapshot endpoints, even by GET', async () => {
    const { bucket } = await populated()
    for (const path of ['/api/roles', '/api/backup', '/api/integrity', '/api/migrate/preview', '/api/migrate/apply', '/api/commands', '/api/snapshot', '/api/snapshot.json', '/snapshot.json', '/api/anything', '/api/state', '/api/state/construction/extra', '/api/state/..%2Froles', '/other']) {
      const r = await pub(bucket, 'GET', path)
      expect(r.status, path).toBe(404)
      expect(r.text).not.toMatch(/jo\.private|Nucor/)
    }
    expect((await pub(bucket, 'HEAD', '/api/state/materials')).status).toBe(200)
  })

  it('shows the same project data as staging, and a change made there is published and appears on the next public read', async () => {
    const { db, s, pid, bucket } = await populated()
    const read = async () => (await pub(bucket, 'GET', '/api/state/construction')).body
    const a = await read()
    const staging = (await s.call('GET', '/api/state/construction')).body
    expect(a.version).toBe(staging.version)
    expect(a.state.foundations.map((f: { number: string }) => f.number)).toEqual(staging.state.foundations.map((f: { number: string }) => f.number))
    const putsBefore = bucket.puts
    expect((await command(s, 'construction', 'createArea', [pid, 'Pipe Rack', []])).status).toBe(200) // the edit in the editable environment
    expect(bucket.puts).toBe(putsBefore + 1) // published automatically after the change
    const b = await read()
    expect(b.version).toBe(a.version + 1)
    expect(b.state.areas.map((x: { name: string }) => x.name)).toEqual(['E-House', 'Pipe Rack'])
    expect((await read()).version).toBe(b.version)
    expect(bucket.puts).toBe(putsBefore + 1) // public reads publish nothing
    // a rejected command changes nothing and publishes nothing
    expect((await command(s, 'construction', 'createArea', [pid, 'Pipe Rack', []])).status).toBe(422)
    expect(bucket.puts).toBe(putsBefore + 1)
    void db
  })

  it('shows project figures the pages need: foundations, quantities, orders, deliveries and fleet units', async () => {
    const { bucket } = await populated()
    const mat = (await pub(bucket, 'GET', '/api/state/materials')).body.state
    expect(mat.orders).toHaveLength(1)
    expect(mat.orders[0]).toMatchObject({ name: 'E-House bolts', date: '2026-10-20' })
    expect(mat.orderLines[0].qty).toBe(100)
    expect(mat.deliveryLines[0].qty).toBe(40)
    const fleet = (await pub(bucket, 'GET', '/api/state/fleet')).body.state
    expect(fleet.vehicles.map((v: { unitNumber: string }) => v.unitNumber)).toEqual(['T-1'])
    expect(fleet.vehicles[0]).toMatchObject({ make: 'Ford', model: 'F-150' })
  })

  it('the stored snapshot itself holds no people, e-mail addresses, contacts, vehicle identifiers, suppliers, PO numbers, history or internal notes', async () => {
    const { db, bucket } = await populated()
    const stored = bucket.objects.get('snapshot.json')!.body
    for (const secret of SECRETS) expect(stored, `snapshot must not contain ${secret}`).not.toContain(secret)
    expect(stored).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    for (const m of ['fleet', 'materials', 'construction']) {
      const r = await pub(bucket, 'GET', `/api/state/${m}`)
      for (const secret of SECRETS) expect(r.text, `${m} must not contain ${secret}`).not.toContain(secret)
    }
    const mat = (await pub(bucket, 'GET', '/api/state/materials')).body.state
    expect(mat.orders[0]).toMatchObject({ number: '', supplier: '', supplierId: null, notes: '', createdBy: '' })
    expect(mat.suppliers).toEqual([])
    expect(mat.history).toEqual([])
    expect(mat.deliveries[0]).toMatchObject({ by: '', reference: '', note: '' })
    const fleet = (await pub(bucket, 'GET', '/api/state/fleet')).body.state
    expect(fleet.vehicles[0]).toMatchObject({ vin: null, licencePlate: null, notes: '' })
    const con = (await pub(bucket, 'GET', '/api/state/construction')).body.state
    expect(con.company).toMatchObject({ name: 'Northline', contactName: '', contactEmail: '', contactPhone: '', notes: '' })
    // hiding is a projection, never a deletion: staging still has every record
    expect(db.raw.prepare('SELECT supplier, po_number FROM purchase_orders').get()).toEqual({ supplier: 'Nucor Secret Supply', po_number: 'PO-SECRET-42' })
    expect(db.raw.prepare('SELECT vin FROM vehicles').get()).toEqual({ vin: '1HGBH41JXMN109186' })
  })

  it('removes an e-mail address that turns up in free text anywhere (last safety net) before the snapshot is stored', async () => {
    const { db, bucket } = await populated()
    db.raw.prepare("UPDATE projects SET description = 'Contact someone@corp.example for access'").run()
    const { publishSnapshot } = await import('../snapshot')
    await publishSnapshot(db.d1, bucket, clock())
    expect(bucket.objects.get('snapshot.json')!.body).not.toContain('someone@corp.example')
    expect((await pub(bucket, 'GET', '/api/state/construction')).body.state.projects[0].description).toBe('Contact  for access')
  })

  it('is switched on by environment only, and the signed-in API still needs Cloudflare Access', async () => {
    const { db, bucket } = await populated()
    const accessEnv = { DB: db.d1, NEXUS_ENV: 'staging', ACCESS_TEAM_DOMAIN: 'https://t.cloudflareaccess.com', ACCESS_AUD: 'aud', PUBLIC_SNAPSHOT: bucket as never }
    expect((await handleApi(new Request('https://staging.example/api/state/materials'), accessEnv, clock())).status).toBe(401)
    expect((await handleApi(new Request('https://staging.example/api/state/materials?env=public', { headers: { 'x-nexus-env': 'public', 'cf-access-jwt-assertion': 'x' } }), accessEnv, clock())).status).toBe(401)
  })

  it('says so, and shows nothing, when nothing has been published, the bucket is missing, or the stored document is not usable', async () => {
    const empty = new MemoryBucket()
    const r = await pub(empty, 'GET', '/api/state/materials')
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('no-snapshot')
    const none = await handleApi(new Request('https://nexus.example/api/state/materials'), { NEXUS_ENV: 'public' }, clock())
    expect(none.status).toBe(503)
    expect((await handleApi(new Request('https://nexus.example/api/health'), { NEXUS_ENV: 'public' }, clock()).then((x) => x.json()))).toMatchObject({ database: false })
    empty.objects.set('snapshot.json', { body: '{"format":99}', meta: {} })
    expect((await pub(empty, 'GET', '/api/state/materials')).status).toBe(503)
    empty.objects.set('snapshot.json', { body: 'not json', meta: {} })
    expect((await pub(empty, 'GET', '/api/state/materials')).status).toBe(500)
  })
})

describe('publishing the snapshot', () => {
  it('a failing bucket never fails or delays the change that triggered it, and the previous snapshot stays in place', async () => {
    const { s, pid, bucket } = await populated()
    const before = bucket.objects.get('snapshot.json')!.body
    bucket.failPuts = true
    expect((await command(s, 'construction', 'createArea', [pid, 'Pipe Rack', []])).status).toBe(200)
    expect(bucket.objects.get('snapshot.json')!.body).toBe(before)
    bucket.failPuts = false
    expect((await command(s, 'construction', 'createArea', [pid, 'Mole Sieve', []])).status).toBe(200)
    expect(JSON.parse(bucket.objects.get('snapshot.json')!.body).modules.construction.state.areas.map((a: { name: string }) => a.name)).toEqual(['E-House', 'Pipe Rack', 'Mole Sieve'])
  })

  it('uses waitUntil when the platform gives one, so the response does not wait for the bucket', async () => {
    const { db, bucket } = await populated()
    const pending: Promise<unknown>[] = []
    const env = { DB: db.d1, DEV_BYPASS_AUTH: 'true', NEXUS_ENV: 'staging', PUBLIC_SNAPSHOT: bucket as never } as Env
    const putsBefore = bucket.puts
    const res = await handleApi(new Request('http://localhost/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module: 'construction', name: 'createProject', args: [{ name: 'Second' }], requestId: 'req-wu-1234567890', clientToday: TODAY }) }), env, clock(), undefined, (p) => pending.push(p))
    expect(res.status).toBe(200)
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(bucket.puts).toBe(putsBefore + 1)
  })

  it('staging without the bucket binding simply does not publish', async () => {
    const db = createTestDb({ seed: false })
    const s = session(db, { NEXUS_ENV: 'staging' })
    expect((await command(s, 'construction', 'createOrganization', [{ name: 'Northline' }])).status).toBe(200)
  })

  it('refuses to publish a snapshot that is malformed or carries an e-mail address, leaving the previous one', async () => {
    const { assertPublishable } = await import('../snapshot')
    const { bucket } = await populated()
    const good = JSON.parse(bucket.objects.get('snapshot.json')!.body)
    expect(() => assertPublishable(good, JSON.stringify(good))).not.toThrow()
    expect(() => assertPublishable({ ...good, format: 2 }, JSON.stringify(good))).toThrow(/format/)
    expect(() => assertPublishable({ ...good, modules: { ...good.modules, fleet: undefined } }, '{}')).toThrow(/missing module fleet/)
    expect(() => assertPublishable(good, JSON.stringify({ ...good, x: 'a@b.example' }))).toThrow(/e-mail/)
  })
})

describe('the scheduled fallback publisher', () => {
  it('recovers a missed update: it republishes when module versions differ, does nothing when current, and refreshes an old snapshot anyway', async () => {
    const { refreshIfStale, MAX_SNAPSHOT_AGE_MS } = await import('../snapshot')
    const { db, pid, bucket } = await populated()
    const writer = { DB: db.d1, PUBLIC_SNAPSHOT: bucket }
    expect(await refreshIfStale(writer, clock())).toBe('current')
    // an edit whose publish was missed (staging had no bucket at the time)
    const blind = session(db, { NEXUS_ENV: 'staging' })
    expect((await command(blind, 'construction', 'createArea', [pid, 'Pipe Rack', []])).status).toBe(200)
    expect(JSON.parse(bucket.objects.get('snapshot.json')!.body).modules.construction.state.areas).toHaveLength(1) // the public site is stale
    const puts = bucket.puts
    expect(await refreshIfStale(writer, clock())).toBe('published')
    expect(bucket.puts).toBe(puts + 1)
    expect((await pub(bucket, 'GET', '/api/state/construction')).body.state.areas.map((a: { name: string }) => a.name)).toEqual(['E-House', 'Pipe Rack'])
    expect(await refreshIfStale(writer, clock())).toBe('current')
    expect(bucket.puts).toBe(puts + 1) // nothing changed: nothing written
    // a change made outside Nexus's commands is still picked up once the snapshot is old enough
    db.raw.prepare("UPDATE areas SET name = 'Pipe Rack 2' WHERE name = 'Pipe Rack'").run()
    expect(await refreshIfStale(writer, clock())).toBe('current')
    expect(await refreshIfStale(writer, clock(new Date(NOW.getTime() + MAX_SNAPSHOT_AGE_MS + 1000)))).toBe('published')
    expect((await pub(bucket, 'GET', '/api/state/construction')).body.state.areas.map((a: { name: string }) => a.name)).toContain('Pipe Rack 2')
  })

  it('publishes when there is no snapshot yet, and skips when it has no database or bucket', async () => {
    const { refreshIfStale } = await import('../snapshot')
    const db = createTestDb({ seed: false })
    const bucket = new MemoryBucket()
    expect(await refreshIfStale({ DB: db.d1, PUBLIC_SNAPSHOT: bucket }, clock())).toBe('published')
    expect(bucket.objects.has('snapshot.json')).toBe(true)
    expect(await refreshIfStale({ PUBLIC_SNAPSHOT: bucket }, clock())).toBe('skipped')
    expect(await refreshIfStale({ DB: db.d1 }, clock())).toBe('skipped')
  })

  it('the publisher Worker has no public surface and runs the check on schedule', async () => {
    const publisher = (await import('../publisher')).default
    const { db, pid, bucket } = await populated()
    expect((await publisher.fetch()).status).toBe(404)
    const blind = session(db, { NEXUS_ENV: 'staging' })
    await command(blind, 'construction', 'createArea', [pid, 'Pipe Rack', []])
    const pending: Promise<unknown>[] = []
    await publisher.scheduled({}, { DB: db.d1, PUBLIC_SNAPSHOT: bucket }, { waitUntil: (p) => pending.push(p) })
    await Promise.all(pending)
    expect(JSON.parse(bucket.objects.get('snapshot.json')!.body).modules.construction.state.areas.map((a: { name: string }) => a.name)).toEqual(['E-House', 'Pipe Rack'])
  })

  it('reads the database through the SELECT-only wrapper: it cannot be made to change staging records', async () => {
    const { buildSnapshot } = await import('../snapshot')
    const { db } = await populated()
    const before = fingerprint(db)
    const seen: string[] = []
    const spy = { prepare: (sql: string) => { seen.push(sql); return db.d1.prepare(sql) }, batch: (x: never) => db.d1.batch(x) }
    await buildSnapshot(spy as never, clock())
    expect(seen.length).toBeGreaterThan(10)
    expect(seen.every((q) => /^select\b/i.test(q.trim()))).toBe(true)
    expect(fingerprint(db)).toBe(before)
  })
})

describe('headers, indexing and separation', () => {
  it('every public API response asks search engines not to index, and carries the security headers; PUBLIC_INDEXABLE switches it', async () => {
    const { bucket } = await populated()
    for (const path of ['/api/health', '/api/session', '/api/state/materials', '/api/state/nope', '/api/roles']) {
      const r = await pub(bucket, 'GET', path)
      expect(r.headers.get('x-robots-tag'), path).toBe('noindex, nofollow, noarchive')
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
      expect(r.headers.get('x-frame-options')).toBe('DENY')
      expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    }
    expect((await pub(bucket, 'POST', '/api/commands')).headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect((await pub(bucket, 'GET', '/api/health', {}, { PUBLIC_INDEXABLE: 'true' })).headers.get('x-robots-tag')).toBeNull()
  })

  it('pages carry the same headers, robots.txt disallows everything, and nothing but GET is served', async () => {
    const worker = (await import('../index')).default
    const { bucket } = await populated()
    const assets = { fetch: async (r: Request) => new Response(new URL(r.url).pathname === '/missing' ? '<html>spa</html>' : '<html>app</html>', { headers: { 'content-type': 'text/html', etag: 'abc' } }) }
    const env = { ...publicEnv(bucket), ASSETS: assets } as never
    const page = await worker.fetch(new Request('https://nexus.example/projects/p1'), env)
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('<html>app</html>')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    const robots = await worker.fetch(new Request('https://nexus.example/robots.txt'), env)
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
    expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect((await worker.fetch(new Request('https://nexus.example/', { method: 'POST' }), env)).status).toBe(405)
    expect((await worker.fetch(new Request('https://nexus.example/api/state/materials'), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://nexus.example/x'), publicEnv(bucket) as never)).status).toBe(404) // no asset layer bound: nothing to serve
    const allowed = await worker.fetch(new Request('https://nexus.example/robots.txt'), { ...(env as object), PUBLIC_INDEXABLE: 'true' } as never)
    expect(await allowed.text()).toBe('User-agent: *\nAllow: /\n')
  })

  it('the public demo stays separate: its API is switched off before any bucket or database is considered', async () => {
    const trap = (name: string) => ({ get [name](): never { throw new Error(`demo must not touch ${name}`) } })
    const env = Object.defineProperties({ NEXUS_ENV: 'demo' } as Record<string, unknown>, { DB: Object.getOwnPropertyDescriptor(trap('DB'), 'DB')!, PUBLIC_SNAPSHOT: Object.getOwnPropertyDescriptor(trap('PUBLIC_SNAPSHOT'), 'PUBLIC_SNAPSHOT')! })
    for (const path of ['/api/health', '/api/state/materials', '/api/session']) {
      const r = await handleApi(new Request(`https://nexus.example${path}`), env as never, clock())
      expect(r.status).toBe(404)
      expect((await r.json()).code).toBe('demo')
    }
  })
})

describe('Cloudflare configuration', () => {
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))
  it('production (public) has no database binding, no credentials or Access settings, only the read bucket, and every request goes through the Worker', () => {
    const c = read('wrangler.production-public.example.jsonc')
    expect(c.vars.NEXUS_ENV).toBe('public')
    expect(Object.keys(c.vars)).toEqual(['NEXUS_ENV'])
    expect(c.d1_databases).toBeUndefined()
    expect(c.kv_namespaces).toBeUndefined()
    expect(c.r2_buckets).toEqual([{ binding: 'PUBLIC_SNAPSHOT', bucket_name: 'nexus-public-snapshot' }])
    expect(c.assets).toMatchObject({ binding: 'ASSETS', run_worker_first: true })
    expect(JSON.stringify(c)).not.toMatch(/ACCESS_|INITIAL_ADMIN|DEV_BYPASS|database_id/)
  })
  it('the local public config has no database either', () => {
    const c = read('wrangler.public.jsonc')
    expect(c.d1_databases).toBeUndefined()
    expect(c.vars.NEXUS_ENV).toBe('public')
  })
  it('the publisher has no public address and only the staging database (read in code) and the bucket', () => {
    const c = read('wrangler.publisher.jsonc')
    expect(c).toMatchObject({ name: 'nexus-publisher', workers_dev: false, preview_urls: false })
    expect(c.routes).toBeUndefined()
    expect(c.triggers.crons).toHaveLength(1)
    expect(c.d1_databases.map((d: { database_name: string }) => d.database_name)).toEqual(['nexus-staging'])
    expect(c.r2_buckets).toEqual([{ binding: 'PUBLIC_SNAPSHOT', bucket_name: 'nexus-public-snapshot' }])
  })
  it('the repository config is untouched: production is still the demo with no database or bucket until approval', () => {
    const c = read('wrangler.jsonc')
    expect(c.vars).toEqual({ NEXUS_ENV: 'demo' })
    expect(c.d1_databases).toBeUndefined()
    expect(c.r2_buckets).toBeUndefined()
    expect(c.assets.run_worker_first).toEqual(['/api/*'])
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
