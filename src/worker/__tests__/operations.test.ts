import { describe, expect, it } from 'vitest'
import { importWorkbookFile } from '@/domains/construction/tracker/import'
import { areaSummary, deliveryState, materialsProgress, receivedOf, remainingOf } from '@/domains/construction/tracker/selectors'
import { sampleWorkbook } from '@/domains/construction/__tests__/xlsxBuilder'
import type { TrackerState } from '@/domains/construction/tracker/types'
import { loadRows, tablesOf } from '../db'
import { command, rid, session, TODAY, type Session } from './helpers'
import { createTestDb } from './sqliteD1'

const SHA = 'a'.repeat(64)
async function importSample(s: Session, sha: string | null = SHA, requestId = rid()) {
  const parsed = await importWorkbookFile(sampleWorkbook())
  return command(s, 'materials', 'importTracker', [parsed, { fileName: 'tracker.xlsx', fileSize: 1234, sha256: sha, importedAt: 'client-time-ignored' }], requestId)
}
const tracker = async (s: Session): Promise<TrackerState> => (await s.call('GET', '/api/state/materials')).body.state
const lineAt = (t: TrackerState, row: number) => t.lines.find((l) => l.source.row === row)!

describe('validation and error handling', () => {
  it('rejects invalid commands without writing anything', async () => {
    const s = session()
    const before = (await s.call('GET', '/api/state/fleet')).body
    const bad = await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-21', reading: -5, note: '' }, TODAY])
    expect(bad.status).toBe(422)
    expect(bad.body.error).toMatch(/greater than zero/)
    expect((await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-12-01', reading: 20_000, note: '' }, TODAY])).body.error).toMatch(/future/)
    const after = (await s.call('GET', '/api/state/fleet')).body
    expect(after.version).toBe(before.version)
    expect(after.state).toEqual(before.state)
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM change_log').first<{ n: number }>())?.n).toBe(0)
  })

  it('rejects unknown modules, unknown commands, malformed requests and a wrong device clock', async () => {
    const s = session()
    expect((await command(s, 'nope', 'x', [])).status).toBe(400)
    expect((await command(s, 'fleet', 'doesNotExist', [])).body.code).toBe('unsupported')
    expect((await command(s, 'materials', 'clearTracker', [])).body.code).toBe('unsupported') // destructive: not available
    expect((await command(s, 'construction', 'allocate', [[], TODAY])).body.code).toBe('unsupported') // demonstration-only
    expect((await s.call('POST', '/api/commands', { module: 'fleet', name: 'recordOdometer', args: [], requestId: 'x', clientToday: TODAY })).body.error).toMatch(/request id/)
    expect((await s.call('POST', '/api/commands', { module: 'fleet', name: 'recordOdometer', args: 'no', requestId: rid(), clientToday: TODAY })).body.error).toMatch(/list/)
    expect((await s.call('POST', '/api/commands', { module: 'fleet', name: 'recordOdometer', args: [], requestId: rid(), clientToday: '2025-01-01' })).body.code).toBe('clock')
    expect((await s.call('POST', '/api/commands', undefined)).status).toBe(400)
    expect((await s.call('GET', '/api/state/zzz')).status).toBe(404)
    expect((await s.call('GET', '/api/nothing')).status).toBe(404)
  })

  it('reports a database integrity failure as a conflict and changes nothing', async () => {
    const s = session()
    s.db.failNextBatch('FOREIGN KEY constraint failed')
    const r = await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY])
    expect(r.status).toBe(409)
    expect((await s.call('GET', '/api/state/fleet')).body.state.odometer).toHaveLength(1)
  })

  it('returns a safe error (no internals) for an unexpected failure', async () => {
    const s = session()
    s.env.DB = { ...s.db.d1, prepare: () => { throw new Error('secret internal detail') } }
    const r = await s.call('GET', '/api/state/fleet')
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toMatch(/secret/)
  })

  it('refuses requests when no database is bound', async () => {
    const s = session()
    s.env.DB = undefined
    expect((await s.call('GET', '/api/session')).body.code).toBe('no-database')
    expect((await s.call('GET', '/api/health')).body).toMatchObject({ database: false })
  })
})

describe('no duplicates', () => {
  it('a retried request id is answered, not applied twice', async () => {
    const s = session()
    const id = rid()
    const args = ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY]
    const first = await command(s, 'fleet', 'recordOdometer', args, id)
    const again = await command(s, 'fleet', 'recordOdometer', args, id)
    expect(first.status).toBe(200)
    expect(again.body.replayed).toBe(true)
    expect(again.body.state.odometer).toHaveLength(2) // seed reading + one, not two
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM change_log').first<{ n: number }>())?.n).toBe(1)
  })

  it('the same reading entered twice with different request ids is refused by the business rule', async () => {
    const s = session()
    const args = ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY]
    await command(s, 'fleet', 'recordOdometer', args)
    expect((await command(s, 'fleet', 'recordOdometer', args)).body.error).toMatch(/already recorded/)
  })

  it('two devices saving at the same moment both succeed and nothing is lost', async () => {
    const a = session()
    const b = session(a.db)
    const [x, y] = await Promise.all([
      command(a, 'fleet', 'recordOdometer', ['veh-T6005', { date: '2026-10-20', reading: 8_000, note: 'a' }, TODAY]),
      command(b, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-20', reading: 12_000, note: 'b' }, TODAY]),
    ])
    expect([x.status, y.status]).toEqual([200, 200])
    const f = (await a.call('GET', '/api/state/fleet')).body.state
    expect(f.odometer.map((r: { reading: number }) => r.reading).sort((x: number, y: number) => x - y)).toEqual([8_000, 11_856, 12_000])
  })

  it('a write that lost a race is re-evaluated against the newer records', async () => {
    const s = session()
    // Simulate another device landing a change between this request's read and its write by bumping the version once.
    let bumped = false
    const real = s.db.d1.batch.bind(s.db.d1)
    s.env.DB = { ...s.db.d1, prepare: s.db.d1.prepare, batch: async (stmts) => { if (!bumped && stmts.length > 2) { bumped = true; s.db.raw.exec("UPDATE module_versions SET version = version + 1 WHERE module = 'fleet'") } return real(stmts) } }
    const r = await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY])
    expect(r.status).toBe(200)
    expect(r.body.state.odometer).toHaveLength(2)
  })
})

describe('Materials: workbook import, receipts and review', () => {
  it('importing the workbook once saves requirements, source references, formulas, comments and flags for any device', async () => {
    const laptop = session()
    const phone = session(laptop.db)
    const r = await importSample(laptop)
    expect(r.status).toBe(200)
    const t = await tracker(phone)
    expect(t.lines).toHaveLength(14)
    expect(t.summary).toHaveLength(9)
    expect(t.anchorage).toHaveLength(2)
    expect(lineAt(t, 4)).toMatchObject({ source: { sheet: 'Material List', row: 4 }, component: '3/4" x 460mm Bolt', requiredQty: 24, sourceStatus: 'Delivered', calc: { formula: 'D4*E4*F4', recomputed: 24 } })
    expect(lineAt(t, 4).sourceNotes[0]).toMatch(/Ordered as/) // workbook comment kept
    expect(t.flags.length).toBeGreaterThan(0)
    expect(t.meta).toMatchObject({ fileName: 'tracker.xlsx', sha256: SHA })
    expect(t.meta!.importedAt).not.toBe('client-time-ignored') // the server stamps the time
  })

  it('stores source facts and operational edits in separate tables', async () => {
    const s = session()
    await importSample(s)
    const id = lineAt(await tracker(s), 4).id
    await command(s, 'materials', 'addReceipt', [id, { date: '2026-10-10', qty: 10, reference: 'PS-1', note: '' }, TODAY])
    await command(s, 'materials', 'setOrdered', [id, 24])
    const lines = await s.db.d1.prepare('SELECT * FROM material_lines WHERE id = ?').bind(id).first<Record<string, unknown>>()
    expect(lines).not.toHaveProperty('ordered_qty')
    expect(lines).not.toHaveProperty('received')
    expect(await s.db.d1.prepare('SELECT ordered_qty FROM material_line_ops WHERE line_id = ?').bind(id).first()).toMatchObject({ ordered_qty: 24 })
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM material_receipts WHERE line_id = ?').bind(id).first<{ n: number }>())?.n).toBe(1)
  })

  it('a workbook status is not a delivery; confirmed deliveries, including partial ones, are', async () => {
    const s = session()
    await importSample(s)
    let t = await tracker(s)
    const bolt = lineAt(t, 4), washer = lineAt(t, 5), nut = lineAt(t, 6)
    expect(bolt.sourceStatus).toBe('Delivered')
    expect(deliveryState(bolt)).toBe('none-received') // reported only
    expect(receivedOf(bolt)).toBe(0)
    expect(remainingOf(bolt)).toBe(bolt.requiredQty) // workbook says delivered, but nothing has been confirmed here
    await command(s, 'materials', 'addReceipt', [bolt.id, { date: '2026-10-10', qty: 10, reference: 'PS-1', note: '' }, TODAY])
    await command(s, 'materials', 'addReceipt', [bolt.id, { date: '2026-10-15', qty: 8, reference: 'PS-2', note: '' }, TODAY])
    await command(s, 'materials', 'confirmNoReceipts', [washer.id, true])
    t = await tracker(s)
    expect(deliveryState(lineAt(t, 4))).toBe('partial')
    expect([receivedOf(lineAt(t, 4)), remainingOf(lineAt(t, 4))]).toEqual([18, 6])
    expect(lineAt(t, 4).receipts.map((r) => r.reference)).toEqual(['PS-1', 'PS-2']) // multiple deliveries, in order
    expect(deliveryState(lineAt(t, 5))).toBe('none-received')
    expect(remainingOf(lineAt(t, 5))).toBe(48)
    expect(remainingOf(nut)).toBe(nut.requiredQty)
  })

  it('a recorded receipt is reflected in the dashboard figures', async () => {
    const s = session()
    await importSample(s)
    const before = materialsProgress((await tracker(s)).lines.filter((l) => l.area === 'North Area'))
    expect(before.percent).toBe(0) // delivered per workbook, nothing confirmed
    const t = await tracker(s)
    await command(s, 'materials', 'addReceipt', [lineAt(t, 4).id, { date: '2026-10-10', qty: 24, reference: '', note: '' }, TODAY])
    const after = materialsProgress((await tracker(s)).lines.filter((l) => l.area === 'North Area'))
    expect(after.percent).toBe(Math.round((1 / 10) * 100))
    expect(areaSummary((await tracker(s)).lines).find((g) => g.component === '3/4" x 460mm Bolt' && g.area === 'North Area')).toMatchObject({ received: 24 })
  })

  it('rejects invalid receipts and keeps removal history out of the database', async () => {
    const s = session()
    await importSample(s)
    const id = lineAt(await tracker(s), 4).id
    expect((await command(s, 'materials', 'addReceipt', [id, { date: '2026-10-10', qty: 0, reference: '', note: '' }, TODAY])).status).toBe(422)
    expect((await command(s, 'materials', 'addReceipt', [id, { date: '2026-12-10', qty: 1, reference: '', note: '' }, TODAY])).status).toBe(422)
    const ok = await command(s, 'materials', 'addReceipt', [id, { date: '2026-10-10', qty: 5, reference: '', note: '' }, TODAY])
    const rec = lineAt(ok.body.state, 4).receipts[0].id
    await command(s, 'materials', 'removeReceipt', [id, rec])
    expect(lineAt(await tracker(s), 4).receipts).toEqual([])
  })

  it('importing the same file again is a no-op; a changed file merges without touching operational edits', async () => {
    const s = session()
    await importSample(s)
    const id = lineAt(await tracker(s), 4).id
    await command(s, 'materials', 'addReceipt', [id, { date: '2026-10-10', qty: 10, reference: 'PS-1', note: '' }, TODAY])
    await command(s, 'materials', 'setNotes', [id, 'check thread'])
    const same = await importSample(s)
    expect(same.body.noop).toBe('already-imported')
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM material_import_batches').first<{ n: number }>())?.n).toBe(1)
    // A revised workbook (new fingerprint) with one footing group removed.
    const revised = await importWorkbookFile(sampleWorkbook())
    revised.lines = revised.lines.filter((l) => l.footingType !== 'F-02')
    const r = await command(s, 'materials', 'importTracker', [revised, { fileName: 'tracker-v2.xlsx', fileSize: 5, sha256: 'b'.repeat(64), importedAt: '' }])
    expect(r.status).toBe(200)
    const t = await tracker(s)
    const kept = t.lines.find((l) => l.id === id)!
    expect(kept.receipts).toHaveLength(1)
    expect(kept.notes).toBe('check thread')
    expect(t.lines).toHaveLength(9)
    expect(t.meta!.fileName).toBe('tracker-v2.xlsx')
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM material_import_batches').first<{ n: number }>())?.n).toBe(2) // history of imports kept
  })

  it('a removed source row that holds receipts is kept, flagged as removed, in its original batch', async () => {
    const s = session()
    await importSample(s)
    const f02 = (await tracker(s)).lines.find((l) => l.footingType === 'F-02' && l.category === 'bolt')!
    await command(s, 'materials', 'addReceipt', [f02.id, { date: '2026-10-10', qty: 2, reference: '', note: '' }, TODAY])
    const revised = await importWorkbookFile(sampleWorkbook())
    revised.lines = revised.lines.filter((l) => l.footingType !== 'F-02')
    await command(s, 'materials', 'importTracker', [revised, { fileName: 'v2.xlsx', fileSize: 5, sha256: 'c'.repeat(64), importedAt: '' }])
    const t = await tracker(s)
    expect(t.lines.filter((l) => l.sourceRemoved).map((l) => l.id)).toEqual([f02.id])
    const row = await s.db.d1.prepare('SELECT batch_id FROM material_lines WHERE id = ?').bind(f02.id).first<{ batch_id: string }>()
    expect(row?.batch_id).toMatch(/^batch-aaaaaaaaaaaa/)
  })

  it('review flags can be acknowledged and the acknowledgement persists', async () => {
    const s = session()
    await importSample(s)
    const flag = (await tracker(s)).flags.find((f) => f.severity === 'review')!
    await command(s, 'materials', 'acknowledgeFlag', [flag.id, 'checked with supplier', TODAY, true])
    expect((await tracker(s)).acknowledged[flag.id]).toEqual({ date: TODAY, note: 'checked with supplier' })
    await command(s, 'materials', 'acknowledgeFlag', [flag.id, '', TODAY, false])
    expect((await tracker(s)).acknowledged[flag.id]).toBeUndefined()
  })

  it('refuses a malformed import before touching the database', async () => {
    const s = session()
    const r = await command(s, 'materials', 'importTracker', [{ lines: 'x' }, { fileName: 'a', fileSize: 1, sha256: null, importedAt: '' }])
    expect(r.status).toBe(400)
    const parsed = await importWorkbookFile(sampleWorkbook())
    parsed.lines[0].requiredQty = -1
    expect((await command(s, 'materials', 'importTracker', [parsed, { fileName: 'a', fileSize: 1, sha256: null, importedAt: '' }])).body.error).toMatch(/invalid quantity/)
    expect((await tracker(s)).lines).toEqual([])
  })

  it('does not bundle any demonstration materials: an empty server tracker is empty', async () => {
    const s = session()
    const t = await tracker(s)
    expect(t).toMatchObject({ meta: null, lines: [], summary: [], anchorage: [], flags: [] })
  })
})

describe('Construction progress persists', () => {
  const areaId = 'mole-sieve'
  const get = async (s: Session) => (await s.call('GET', '/api/state/construction')).body.state

  it('starts with the real project and areas and no foundations or invented progress', async () => {
    const st = await get(session())
    expect(st.projects.map((p: { id: string; name: string }) => p.name)).toEqual(['REEF'])
    expect(st.areas.map((a: { name: string }) => a.name)).toEqual(['Mole Sieve', 'Propane BOG', 'Piperack', 'Locomotive Shelter', 'E-House']) // project order, not alphabetical
    expect(st.foundations).toEqual([])
    expect(st.activities).toEqual([])
    expect(st.deliveries).toEqual([])
  })

  it('a foundation and its activity updates survive a refresh and appear on another device', async () => {
    const a = session()
    const b = session(a.db)
    expect((await command(a, 'construction', 'createFoundation', [areaId, '21-03', 'test footing', 2])).status).toBe(200)
    const fid = (await get(a)).foundations[0].id
    await command(a, 'construction', 'updateActivity', [`${fid}:formed`, { status: 'complete' }, TODAY])
    await command(a, 'construction', 'updateActivity', [`${fid}-p1:rebarBuilt`, { status: 'in-progress', notes: 'half done' }, TODAY])
    const st = await get(b)
    const act = (id: string) => st.activities.find((x: { id: string }) => x.id === id)
    expect(act(`${fid}:formed`)).toMatchObject({ status: 'complete', actualDate: TODAY })
    expect(act(`${fid}-p1:rebarBuilt`)).toMatchObject({ status: 'in-progress', notes: 'half done' })
    expect(act(`${fid}:poured`)).toMatchObject({ status: 'not-started', actualDate: null }) // missing record ≠ completed work
    expect(st.plinths).toHaveLength(2)
  })

  it('only recorded activities are stored; the rest are not-started by definition', async () => {
    const s = session()
    await command(s, 'construction', 'createFoundation', [areaId, '21-04', '', 3])
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM activities').first<{ n: number }>())?.n).toBe(0)
    const fid = (await get(s)).foundations[0].id
    await command(s, 'construction', 'updateActivity', [`${fid}:layout`, { status: 'complete' }, TODAY])
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM activities').first<{ n: number }>())?.n).toBe(1)
    await command(s, 'construction', 'updateActivity', [`${fid}:layout`, { status: 'not-started' }, TODAY])
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM activities').first<{ n: number }>())?.n).toBe(0) // reset to unrecorded
  })

  it('progress derives from saved records, through the same calculation the browser uses', async () => {
    const { computeStats, getIndex, foundationsOf } = await import('@/domains/construction/selectors')
    const s = session()
    await command(s, 'construction', 'createFoundation', [areaId, '21-05', '', 0])
    const fid = (await get(s)).foundations[0].id
    let st = await get(s)
    expect(computeStats(getIndex(st), foundationsOf(getIndex(st), areaId)).progress).toBe(0)
    for (const key of ['rebarBuilt', 'rebarInstalled', 'formed']) await command(s, 'construction', 'updateActivity', [`${fid}:${key}`, { status: 'complete' }, TODAY])
    st = await get(s)
    const stats = computeStats(getIndex(st), foundationsOf(getIndex(st), areaId))
    expect(stats.progress).toBe(67) // rebar + forming of three equal stages
    expect(stats.constructed).toBe(0)
    await command(s, 'construction', 'updateActivity', [`${fid}:poured`, { status: 'complete' }, TODAY])
    st = await get(s)
    expect(computeStats(getIndex(st), foundationsOf(getIndex(st), areaId))).toMatchObject({ progress: 100, constructed: 1 })
  })

  it('refuses duplicates, bad input and demonstration-only actions', async () => {
    const s = session()
    await command(s, 'construction', 'createFoundation', [areaId, '21-06', '', 1])
    expect((await command(s, 'construction', 'createFoundation', [areaId, '21-06', '', 1])).body.error).toMatch(/already exists/)
    expect((await command(s, 'construction', 'createFoundation', [areaId, 'bad number!', '', 1])).status).toBe(422)
    expect((await command(s, 'construction', 'createFoundation', [areaId, '21-07', '', 500])).status).toBe(422)
    expect((await command(s, 'construction', 'createFoundation', ['nope', '21-07', '', 1])).body.error).toMatch(/Area not found/)
    expect((await command(s, 'construction', 'updateActivity', ['missing:formed', { status: 'complete' }, TODAY])).body.error).toMatch(/not found/)
    expect((await command(s, 'construction', 'setReportedProgress', ['reef', 50])).body.code).toBe('unsupported')
    expect((await get(s)).foundations).toHaveLength(1)
  })

  it('project status is saved with its reason', async () => {
    const s = session()
    await command(s, 'construction', 'setProjectStatus', ['reef', 'at-risk', 'Waiting on anchor bolts'])
    expect((await get(s)).projects[0]).toMatchObject({ status: 'at-risk', statusNote: 'Waiting on anchor bolts' })
  })

  it('does not contain any demonstration project, supplier or purchase order', async () => {
    const st = await get(session())
    expect(JSON.stringify(st)).not.toMatch(/Northcoast|Ridley Terminals Partners|demonstration/i)
    const { rows } = { rows: await loadRows(session().env.DB!, tablesOf('construction')) }
    expect(rows.projects).toHaveLength(1)
  })
})

describe('shared data across sessions', () => {
  it('module versions increase with each saved change and are reported to every device', async () => {
    const a = session()
    const b = session(a.db)
    await command(a, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY])
    await command(a, 'construction', 'createFoundation', ['mole-sieve', '21-01', '', 1])
    const v = (await b.call('GET', '/api/session')).body
    expect(v.versions).toMatchObject({ fleet: 1, construction: 1, materials: 0 })
    expect(v).toMatchObject({ user: 'local-dev', environment: 'test' })
  })

  it('a fresh database is isolated: staging data never appears in another database', async () => {
    const staging = session()
    const other = session(createTestDb())
    await command(staging, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY])
    expect(latest((await other.call('GET', '/api/state/fleet')).body.state)).toBe(11_856)
    function latest(f: { odometer: { reading: number }[] }) { return Math.max(...f.odometer.map((r) => r.reading)) }
  })
})
