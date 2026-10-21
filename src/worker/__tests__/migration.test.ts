import { describe, expect, it } from 'vitest'
import * as T from '@/domains/construction/tracker/actions'
import { importWorkbookFile } from '@/domains/construction/tracker/import'
import { emptyTracker, type TrackerState } from '@/domains/construction/tracker/types'
import { sampleWorkbook } from '@/domains/construction/__tests__/xlsxBuilder'
import { buildSeed } from '@/domains/construction/seed'
import * as F from '@/domains/fleet/actions'
import { buildFleetSeed } from '@/domains/fleet/seed'
import type { FleetState } from '@/domains/fleet/types'
import type { MigrationBundle } from '../migrate'
import { command, rid, session, TODAY, type Session } from './helpers'

const run = <S>(s: S, r: (x: S) => { state?: S; error?: string }): S => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state! }

/** What a browser holds after real use: the seed plus the user's own entries. */
function localFleet(): FleetState {
  let f = buildFleetSeed()
  f = run(f, F.recordOdometer('veh-T6010', { date: '2026-10-19', reading: 12_000, note: 'local' }, TODAY))
  f = run(f, F.recordOdometer('veh-T6010', { date: '2026-10-20', reading: 12_400, note: '' }, TODAY))
  f = run(f, F.submitInspection('veh-T6010', { date: '2026-10-20', submittedBy: 'Clay', notes: '', defects: ['light'] }, TODAY))
  f = run(f, F.replaceTireSet('veh-T6010', { manufacturer: 'Nokian', model: 'Hakka', size: '', classes: ['winter'], studded: 'yes', origin: '', installDate: null, installOdometer: 12_400, condition: 'unknown', notes: '' }, { date: null, odometer: 12_400 }, TODAY))
  f = run(f, F.addAccessory('veh-T6010', { name: 'Light bar', category: 'light-bar', description: '', specification: '', cost: null, warranty: '', notes: '' }, { date: null, odometer: null }, TODAY))
  return f
}
async function localTracker(): Promise<TrackerState> {
  const parsed = await importWorkbookFile(sampleWorkbook())
  let t = run(emptyTracker(), T.importTracker(parsed, { fileName: 'tracker.xlsx', fileSize: 10, sha256: 'e'.repeat(64), importedAt: '2026-10-19T00:00:00Z' }))
  t = run(t, T.addReceipt(t.lines[3].id, { date: '2026-10-10', qty: 5, reference: 'PS-1', note: '' }, TODAY))
  t = run(t, T.confirmNoReceipts(t.lines[4].id, true))
  return t
}
const bundle = async (extra: Partial<MigrationBundle> = {}): Promise<MigrationBundle> => ({ format: 'nexus-browser-export', exportedAt: '2026-10-21T12:00:00Z', fleet: localFleet(), materials: await localTracker(), ...extra })
const preview = (s: Session, b: MigrationBundle) => s.call('POST', '/api/migrate/preview', { bundle: b })
const apply = (s: Session, b: MigrationBundle, extra: Record<string, unknown> = {}, requestId = rid()) => s.call('POST', '/api/migrate/apply', { bundle: b, confirmedReal: true, requestId, ...extra })
const rowsOf = (r: { body: { report: { modules: Record<string, { table: string; imported: number; identical: number; conflicts: unknown[]; blocked: { reason: string }[] }[]> } } }, mod: string, table: string) => r.body.report.modules[mod].find((t) => t.table === table)!

describe('browser-data migration', () => {
  it('previews without writing anything and shows what is new versus already on the server', async () => {
    const s = session()
    const r = await preview(s, await bundle())
    expect(r.status).toBe(200)
    expect(rowsOf(r, 'fleet', 'vehicles')).toMatchObject({ imported: 0, identical: 4 }) // the verified seed is already there
    expect(rowsOf(r, 'fleet', 'odometer_readings')).toMatchObject({ imported: 2, identical: 1 })
    expect(rowsOf(r, 'materials', 'material_lines')).toMatchObject({ imported: 14 })
    expect(r.body.report.imported).toBeGreaterThan(0)
    expect((await s.call('GET', '/api/state/fleet')).body.state.odometer).toHaveLength(1) // nothing was written
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM change_log').first<{ n: number }>())?.n).toBe(0)
  })

  it('imports history, tire sets, accessories, inspections and materials, and keeps their order', async () => {
    const s = session()
    // The browser replaced T6010's factory tires; the server still has them as the active set, so that is a conflict to decide.
    const b = await bundle()
    const held = await apply(s, b)
    expect(rowsOf(held, 'fleet', 'tire_sets').conflicts).toHaveLength(1)
    expect(rowsOf(held, 'fleet', 'tire_sets').blocked[0].reason).toMatch(/already active/)
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).tireSets).toHaveLength(1) // not silently replaced
    const r = await apply(s, b, { overwrite: ['tire_sets:tire-T6010-1'] })
    expect(r.body.error).toBeUndefined()
    expect(r.status).toBe(200)
    expect(r.body.integrity.ok).toBe(true)
    const f = (await s.call('GET', '/api/state/fleet')).body.state as FleetState
    expect(f.odometer.map((o) => o.reading)).toEqual([11_856, 12_000, 12_400])
    expect(f.tireSets.filter((t) => t.vehicleId === 'veh-T6010').map((t) => [t.manufacturer, t.active])).toEqual([['Bridgestone', false], ['Nokian', true]])
    expect(f.accessories.map((a) => a.name)).toEqual(['750 L Tidy Tank', 'Light bar'])
    expect(f.inspections.find((i) => !i.demo)!.defects[0].description).toBe('light')
    const t = (await s.call('GET', '/api/state/materials')).body.state as TrackerState
    expect(t.lines).toHaveLength(14)
    expect(t.lines[3].receipts).toHaveLength(1)
    expect(t.lines[4].confirmedNoReceipts).toBe(true)
    expect(t.lines[0].sourceStatus).toBe('Delivered') // reported status preserved, no receipt invented
  })

  it('is idempotent: importing the same browser data again adds nothing', async () => {
    const s = session()
    const b = await bundle()
    const keep = { overwrite: ['tire_sets:tire-T6010-1'] }
    await apply(s, b, keep)
    const second = await apply(s, b, keep)
    expect(second.body.report).toMatchObject({ imported: 0, conflicts: 0, blocked: 0 })
    expect(second.body.report.identical).toBeGreaterThan(0)
    const f = (await s.call('GET', '/api/state/fleet')).body.state as FleetState
    expect(f.odometer).toHaveLength(3)
    expect(f.vehicles).toHaveLength(4)
    expect(((await s.call('GET', '/api/state/materials')).body.state as TrackerState).lines).toHaveLength(14)
  })

  it('a repeated request id is recognised as already applied', async () => {
    const s = session()
    const b = await bundle()
    const id = rid()
    await apply(s, b, { overwrite: ['tire_sets:tire-T6010-1'] }, id)
    const again = await apply(s, b, { overwrite: ['tire_sets:tire-T6010-1'] }, id)
    expect(again.body.replayed).toBe(true)
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).odometer).toHaveLength(3)
  })

  it('an interrupted import changes nothing and can be retried', async () => {
    const s = session()
    const b = await bundle()
    s.db.failNextBatch('network lost mid-write')
    const failed = await apply(s, b)
    expect(failed.status).toBe(409)
    expect(failed.body.error).toMatch(/safe to retry/)
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).odometer).toHaveLength(1)
    expect(((await s.call('GET', '/api/state/materials')).body.state as TrackerState).lines).toHaveLength(0)
    const retried = await apply(s, b, { overwrite: ['tire_sets:tire-T6010-1'] })
    expect(retried.status).toBe(200)
    expect(retried.body.report.imported).toBeGreaterThan(0)
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).odometer).toHaveLength(3)
  })

  it('never overwrites newer server data without confirmation, and reports the conflict', async () => {
    const s = session()
    const b = await bundle()
    const localReading = b.fleet!.odometer[1]
    await apply(s, b, { overwrite: ['tire_sets:tire-T6010-1'] })
    // The server copy of that reading is changed afterwards (a newer decision made on another device).
    s.db.raw.prepare("UPDATE odometer_readings SET review = 'rejected', review_note = 'wrong' WHERE id = ?").run(localReading.id)
    const again = await apply(s, b)
    expect(rowsOf(again, 'fleet', 'odometer_readings').conflicts).toEqual([{ table: 'odometer_readings', id: localReading.id, differing: expect.arrayContaining(['review']) }])
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).odometer.find((o) => o.id === localReading.id)!.review).toBe('rejected') // kept
    const confirmed = await apply(s, b, { overwrite: [`odometer_readings:${localReading.id}`] })
    expect(confirmed.body.report.replaced).toBe(1)
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).odometer.find((o) => o.id === localReading.id)!.review).toBe('valid')
  })

  it('does not import a vehicle that would duplicate an existing unit number', async () => {
    const s = session()
    const b = await bundle()
    b.fleet!.vehicles.push({ id: 'veh-other', companyId: 'progressive', unitNumber: 't6010', year: 2020, make: 'X', model: 'Y', vin: null, licencePlate: null, notes: '', expectedLifeKm: null, inspectionIntervalDays: null })
    const r = await apply(s, b)
    expect(rowsOf(r, 'fleet', 'vehicles').blocked).toEqual([{ table: 'vehicles', id: 'veh-other', reason: expect.stringMatching(/unit_number/) }])
    expect(((await s.call('GET', '/api/state/fleet')).body.state as FleetState).vehicles).toHaveLength(4)
  })

  it('skips records whose parent is not on the server instead of creating orphans', async () => {
    const s = session()
    const b = await bundle()
    b.fleet!.odometer.push({ id: 'odo-orphan', vehicleId: 'veh-ghost', date: '2026-10-01', reading: 100, unit: 'km', review: 'valid', flag: null, correctsId: null, note: '', reviewNote: '', reviewedDate: null })
    const r = await apply(s, b)
    expect(rowsOf(r, 'fleet', 'odometer_readings').blocked[0]).toMatchObject({ id: 'odo-orphan', reason: expect.stringMatching(/vehicles record/) })
    expect(r.body.integrity.ok).toBe(true)
  })

  it('attaches receipts to a workbook that is already on the server without duplicating its lines', async () => {
    const s = session()
    const parsed = await importWorkbookFile(sampleWorkbook())
    await command(s, 'materials', 'importTracker', [parsed, { fileName: 'tracker.xlsx', fileSize: 10, sha256: 'e'.repeat(64), importedAt: '' }])
    const r = await apply(s, { format: 'nexus-browser-export', materials: await localTracker() })
    expect(rowsOf(r, 'materials', 'material_lines')).toMatchObject({ imported: 0, identical: 14 })
    expect(rowsOf(r, 'materials', 'material_receipts').imported).toBe(1)
    expect((await s.db.d1.prepare('SELECT COUNT(*) AS n FROM material_import_batches').first<{ n: number }>())?.n).toBe(1) // same file, same batch
    expect(((await s.call('GET', '/api/state/materials')).body.state as TrackerState).lines[3].receipts).toHaveLength(1)
  })

  it('refuses without explicit confirmation that the data is real', async () => {
    const s = session()
    const r = await s.call('POST', '/api/migrate/apply', { bundle: await bundle(), requestId: rid() })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('unconfirmed')
    expect(((await s.call('GET', '/api/state/materials')).body.state as TrackerState).lines).toHaveLength(0)
  })

  it('never imports demonstration construction data, even if it is in the file', async () => {
    const s = session()
    const b = { ...(await bundle()), construction: buildSeed(TODAY) } as unknown as MigrationBundle
    const r = await apply(s, b)
    expect(r.body.report.modules).not.toHaveProperty('construction')
    const st = (await s.call('GET', '/api/state/construction')).body.state
    expect(st.foundations).toEqual([])
    expect(st.projects).toHaveLength(1)
  })

  it('rejects files that are not browser exports or contain nothing to import', async () => {
    const s = session()
    expect((await s.call('POST', '/api/migrate/preview', { bundle: { format: 'nope' } })).status).toBe(400)
    expect((await s.call('POST', '/api/migrate/preview', { bundle: { format: 'nexus-browser-export' } })).body.error).toMatch(/no fleet or materials/)
    expect((await s.call('POST', '/api/migrate/preview', { bundle: { format: 'nexus-browser-export', fleet: { vehicles: [] } } })).body.error).toMatch(/incomplete/)
    expect((await s.call('POST', '/api/migrate/preview', {})).status).toBe(400)
  })
})
