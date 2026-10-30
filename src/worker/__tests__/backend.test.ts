import { describe, expect, it } from 'vitest'
import { buildFleetSeed } from '@/domains/fleet/seed'
import { readFileSync } from 'node:fs'
import { oilIndicator, tireIndicator } from '@/domains/fleet/indicators'
import { activeTireSet, latestOdometer, serviceStatus, tireKm, fleetRow } from '@/domains/fleet/selectors'
import { fleetFromRows, fleetToRows } from '../repo/fleet'
import { loadRows, tablesOf } from '../db'
import { applyMigrationFile, createTestDb } from './sqliteD1'
import { command, session, TODAY } from './helpers'

describe('migrations', () => {
  it('create the schema and seed the real REEF project and fleet', async () => {
    const { d1, raw } = createTestDb()
    const v = (await d1.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").first<{ value: string }>())?.value
    expect(v).toBe('6')
    expect((await d1.prepare('SELECT COUNT(*) AS n FROM vehicles').first<{ n: number }>())?.n).toBe(4)
    expect((await d1.prepare('SELECT name FROM areas ORDER BY sequence').all<{ name: string }>()).results.map((r) => r.name)).toEqual(['Mole Sieve', 'Propane BOG', 'Piperack', 'Locomotive Shelter', 'E-House'])
    expect(raw.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
  })

  it('seed data equals the verified values supplied for T6010 and nothing else', async () => {
    const s = session()
    const { body } = await s.call('GET', '/api/state/fleet')
    const f = body.state
    const t = f.vehicles.find((v: { unitNumber: string }) => v.unitNumber === 'T6010')
    expect(latestOdometer(f, t.id)).toMatchObject({ reading: 11_856, date: null })
    expect(oilIndicator(f, t.id)).toMatchObject({ remaining: 1_695, dueAt: 13_551, intervalKm: 5_000, warnWithinKm: 2_000, status: 'warn' })
    expect(t).toMatchObject({ expectedLifeKm: 180_000, inspectionIntervalDays: null })
    expect(activeTireSet(f, t.id)).toMatchObject({ expectedLifeKm: 60_000 })
    expect(activeTireSet(f, t.id)).toMatchObject({ manufacturer: 'Bridgestone', model: 'Dueler A/T', installOdometer: 0, size: null, studded: 'unknown', condition: 'unknown' })
    expect(tireKm(f, activeTireSet(f, t.id)!)).toBe(11_856)
    expect(f.accessories).toHaveLength(1)
    expect(f.accessories[0]).toMatchObject({ name: '750 L Tidy Tank', cost: null, warranty: '' })
    // The only inspections are the four labelled demonstration samples: no inspector, results, condition or defects.
    expect(f.inspections).toHaveLength(4)
    expect(f.inspections.every((i: { demo: boolean; submittedBy: string; condition: unknown; defects: unknown[] }) => i.demo && i.submittedBy === '' && i.condition === null && i.defects.length === 0)).toBe(true)
    expect(f.maintenance).toEqual([]) // no completed oil change was invented for the calculated baseline
    expect(f.maintenance).toEqual([])
    expect(f.vehicles.every((v: { vin: unknown; licencePlate: unknown }) => v.vin === null && v.licencePlate === null)).toBe(true)
    for (const id of f.vehicles.map((v: { id: string }) => v.id).filter((id: string) => id !== t.id)) expect(latestOdometer(f, id)).toBeUndefined()
  })

  it('the server seed is identical to the browser seed, so migrating the two never conflicts', async () => {
    const s = session()
    const { body } = await s.call('GET', '/api/state/fleet')
    expect(body.state).toEqual(buildFleetSeed())
  })

  it('re-running the seed migration never overwrites newer information', async () => {
    const s = session()
    await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-20', reading: 12_500, note: '' }, TODAY])
    await command(s, 'fleet', 'replaceTireSet', ['veh-T6010', { manufacturer: 'Nokian', model: 'Hakka', size: '', classes: ['winter'], studded: 'yes', origin: '', installDate: null, installOdometer: 12_500, condition: 'unknown', notes: '' }, { date: null, odometer: 12_500 }, TODAY])
    applyMigrationFile(s.db.raw, '0002_seed_reef_and_fleet.sql')
    const { body } = await s.call('GET', '/api/state/fleet')
    expect(body.state.odometer.filter((r: { vehicleId: string }) => r.vehicleId === 'veh-T6010')).toHaveLength(2)
    expect(body.state.tireSets.filter((t: { vehicleId: string }) => t.vehicleId === 'veh-T6010')).toHaveLength(2)
    expect(latestOdometer(body.state, 'veh-T6010')?.reading).toBe(12_500)
  })

  it('enforce foreign keys and one-active-tire-set at the database level', async () => {
    const { raw } = createTestDb()
    expect(() => raw.exec("INSERT INTO odometer_readings (id, vehicle_id, reading_date, reading, unit, review, note, review_note, seq) VALUES ('x','nope','2026-01-01',5,'km','valid','','',0)")).toThrow(/FOREIGN KEY/)
    expect(() => raw.exec("INSERT INTO tire_sets (id, vehicle_id, manufacturer, model, classes_json, studded, origin, active, condition, notes, seq) VALUES ('t2','veh-T6010','a','b','[]','unknown','',1,'unknown','',9)")).toThrow(/UNIQUE/)
    expect(() => raw.exec("INSERT INTO odometer_readings (id, vehicle_id, reading_date, reading, unit, review, note, review_note, seq) VALUES ('y','veh-T6005','2026-01-01',-5,'km','valid','','',0)")).toThrow(/CHECK/)
  })
})

describe('repository mapping', () => {
  it('round-trips every fleet record through tables without loss or reordering', async () => {
    const s = session()
    await command(s, 'fleet', 'recordOdometer', ['veh-T6005', { date: '2026-10-19', reading: 8_000, note: 'n' }, TODAY])
    await command(s, 'fleet', 'recordOdometer', ['veh-T6005', { date: '2026-10-20', reading: 7_000, note: 'lower' }, TODAY])
    await command(s, 'fleet', 'submitInspection', ['veh-T6005', { date: '2026-10-20', submittedBy: 'Clay', notes: 'ok', defects: ['b', 'a'] }, TODAY])
    await command(s, 'fleet', 'addAccessory', ['veh-T6005', { name: 'Light bar', category: 'light-bar', description: '', specification: '', cost: 10.5, warranty: '', notes: '' }, { date: null, odometer: null }, TODAY])
    const rows = await loadRows(s.env.DB!, tablesOf('fleet'))
    const state = fleetFromRows(rows)
    expect(fleetToRows(state)).toEqual(rows)
    expect(state.inspections.find((i) => i.submittedBy === 'Clay')!.defects.map((d) => d.description)).toEqual(['b', 'a']) // order preserved
  })
})

describe('Fleet persists to the database', () => {
  it('a mileage update survives a refresh and is seen by a second device', async () => {
    const laptop = session()
    const phone = session(laptop.db) // another browser, same database
    const r = await command(laptop, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, TODAY])
    expect(r.status).toBe(200)
    expect(latestOdometer(r.body.state, 'veh-T6010')?.reading).toBe(12_000)
    const refresh = await laptop.call('GET', '/api/state/fleet')
    expect(latestOdometer(refresh.body.state, 'veh-T6010')?.reading).toBe(12_000)
    const other = await phone.call('GET', '/api/state/fleet')
    expect(latestOdometer(other.body.state, 'veh-T6010')?.reading).toBe(12_000)
    expect(oilIndicator(other.body.state, 'veh-T6010').remaining).toBe(1_551)
    expect(fleetRow(other.body.state, other.body.state.vehicles[0], TODAY).tireKm).toBe(12_000)
  })

  it('keeps the full odometer history, flags decreases, and never rewrites earlier readings', async () => {
    const s = session()
    for (const [d, km] of [['2026-10-15', 12_000], ['2026-10-20', 12_900], ['2026-10-21', 11_000]] as const) await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: d, reading: km, note: '' }, TODAY])
    const { body } = await s.call('GET', '/api/state/fleet')
    const mine = body.state.odometer.filter((r: { vehicleId: string }) => r.vehicleId === 'veh-T6010')
    expect(mine.map((r: { reading: number; review: string }) => [r.reading, r.review])).toEqual([[11_856, 'valid'], [12_000, 'valid'], [12_900, 'valid'], [11_000, 'needs-review']])
    expect(latestOdometer(body.state, 'veh-T6010')?.reading).toBe(12_900)
  })

  it('persists maintenance, service thresholds, tire replacement and accessory transfer with their history', async () => {
    const s = session()
    await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-20', reading: 13_000, note: '' }, TODAY])
    await command(s, 'fleet', 'setServiceTarget', ['veh-T6010', 13_551, '', TODAY, { serviceType: 'Oil change', warnWithinKm: 1000 }])
    await command(s, 'fleet', 'recordMaintenance', ['veh-T6010', { date: '2026-10-10', serviceType: 'Oil change', odometer: 12_000, description: 'synthetic', notes: '' }, TODAY])
    await command(s, 'fleet', 'replaceTireSet', ['veh-T6010', { manufacturer: 'Nokian', model: 'Hakka', size: '', classes: ['winter', 'all-terrain'], studded: 'yes', origin: '', installDate: '2026-10-20', installOdometer: 13_000, condition: 'unknown', notes: '' }, { date: '2026-10-20', odometer: 13_000 }, TODAY])
    await command(s, 'fleet', 'transferAccessory', ['acc-T6010-tidy-tank', 'veh-T6005', { date: '2026-10-21', fromOdometer: 13_000, toOdometer: null, note: 'moved' }, TODAY])
    const { body } = await s.call('GET', '/api/state/fleet')
    const f = body.state
    // The oil-change target is its own schedule; the seeded next service (13,551 km, untyped) is unaffected.
    expect(oilIndicator(f, 'veh-T6010')).toMatchObject({ remaining: 551, status: 'warn' })
    expect(oilIndicator(f, 'veh-T6010').consumedPercent).toBeCloseTo(64.5, 0)
    expect(serviceStatus(f, 'veh-T6010').target).toBeUndefined()
    expect(f.maintenance).toHaveLength(1)
    expect(f.tireSets.filter((t: { vehicleId: string }) => t.vehicleId === 'veh-T6010').map((t: { manufacturer: string; active: boolean }) => [t.manufacturer, t.active])).toEqual([['Bridgestone', false], ['Nokian', true]])
    expect(tireKm(f, f.tireSets.find((t: { manufacturer: string }) => t.manufacturer === 'Bridgestone'))).toBe(13_000)
    expect(f.tireSets.find((t: { manufacturer: string }) => t.manufacturer === 'Nokian').classes).toEqual(['winter', 'all-terrain'])
    expect(f.accessories).toHaveLength(1)
    expect(f.accessories[0].placements.map((p: { vehicleId: string; endReason: string | null }) => [p.vehicleId, p.endReason])).toEqual([['veh-T6010', 'transferred'], ['veh-T6005', null]])
  })

  it('persists the optional tire lifespan and replacement thresholds, and leaves them empty by default', async () => {
    const s = session()
    const before = (await s.call('GET', '/api/state/fleet')).body.state
    expect(activeTireSet(before, 'veh-T6010')).toMatchObject({ expectedLifeKm: 60_000, replaceAtMm: null })
    const id = activeTireSet(before, 'veh-T6010')!.id
    await command(s, 'fleet', 'updateTireSet', [id, { manufacturer: 'Bridgestone', model: 'Dueler A/T', size: '', classes: [], studded: 'unknown', origin: 'Original factory tires', installDate: null, installOdometer: 0, condition: 'unknown', notes: '', expectedLifeKm: 70_000, replaceAtMm: 3.5 }, TODAY])
    const after = (await s.call('GET', '/api/state/fleet')).body.state
    expect(activeTireSet(after, 'veh-T6010')).toMatchObject({ expectedLifeKm: 70_000, replaceAtMm: 3.5 })
    expect(tireIndicator(after, 'veh-T6010')).toMatchObject({ remainingKm: 70_000 - 11_856, status: 'ok' })
  })

  it('the tire-threshold migration upgrades an existing database without changing its rows', () => {
    const old = createTestDb({ migrate: false })
    for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql']) old.raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
    const rowBefore = old.raw.prepare("SELECT id, manufacturer, install_odometer FROM tire_sets WHERE vehicle_id = 'veh-T6010'").get()
    applyMigrationFile(old.raw, '0003_tire_thresholds.sql')
    expect(old.raw.prepare("SELECT id, manufacturer, install_odometer, expected_life_km, replace_at_mm FROM tire_sets WHERE vehicle_id = 'veh-T6010'").get()).toEqual({ ...rowBefore, expected_life_km: null, replace_at_mm: null })
    expect(() => old.raw.exec("UPDATE tire_sets SET expected_life_km = -1")).toThrow(/CHECK/)
    expect(() => old.raw.exec("UPDATE tire_sets SET replace_at_mm = 99")).toThrow(/CHECK/)
  })

  it('migration 0004 upgrades an existing database, fills only empty planning values and keeps genuine history', () => {
    const upgrade = (prepare: (raw: ReturnType<typeof createTestDb>['raw']) => void) => {
      const db = createTestDb({ migrate: false })
      for (const f of ['0001_core_schema.sql', '0002_seed_reef_and_fleet.sql', '0003_tire_thresholds.sql']) db.raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
      prepare(db.raw)
      applyMigrationFile(db.raw, '0004_vehicle_planning_and_demo_inspections.sql')
      return db.raw
    }
    // Fresh pre-0004 database: configured values and four labelled demo inspections are added.
    const fresh = upgrade(() => undefined)
    expect(fresh.prepare("SELECT expected_life_km FROM vehicles WHERE id = 'veh-T6010'").get()).toEqual({ expected_life_km: 180_000 })
    expect(fresh.prepare("SELECT service_type, warn_within_km, interval_km FROM service_targets WHERE id = 'svc-T6010-verified'").get()).toEqual({ service_type: 'Oil change', warn_within_km: 2_000, interval_km: 5_000 })
    expect(fresh.prepare("SELECT expected_life_km FROM tire_sets WHERE id = 'tire-T6010-1'").get()).toEqual({ expected_life_km: 60_000 })
    expect(fresh.prepare('SELECT inspection_date, demo, submitted_by, condition FROM inspections ORDER BY seq').all()).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18'].map((d) => ({ inspection_date: d, demo: 1, submitted_by: '', condition: null })))
    expect(fresh.prepare('SELECT COUNT(*) AS n FROM maintenance_records').get()).toEqual({ n: 0 }) // the 8,551 km baseline is not a record
    expect(fresh.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '4' })
    // A database where people already entered values and a real inspection: nothing is overwritten and no demo records are added.
    const used = upgrade((raw) => {
      raw.exec("UPDATE service_targets SET service_type = 'Brake service', warn_within_km = NULL WHERE id = 'svc-T6010-verified'")
      raw.exec("UPDATE tire_sets SET expected_life_km = 45000 WHERE id = 'tire-T6010-1'")
      raw.exec("INSERT INTO inspections (id, vehicle_id, inspection_date, submitted_by, notes, review, seq) VALUES ('real-1', 'veh-T6010', '2026-10-19', 'Real Inspector', 'genuine', 'submitted', 0)")
    })
    expect(used.prepare("SELECT service_type, warn_within_km, interval_km FROM service_targets WHERE id = 'svc-T6010-verified'").get()).toEqual({ service_type: 'Brake service', warn_within_km: null, interval_km: null })
    expect(used.prepare("SELECT expected_life_km FROM tire_sets WHERE id = 'tire-T6010-1'").get()).toEqual({ expected_life_km: 45_000 })
    expect(used.prepare('SELECT id, demo FROM inspections').all()).toEqual([{ id: 'real-1', demo: 0 }])
    expect(() => used.exec('UPDATE vehicles SET expected_life_km = -5')).toThrow(/CHECK/)
    expect(() => used.exec("UPDATE inspections SET demo = 2")).toThrow(/CHECK/)
  })

  it('an inspection never marks a vehicle healthy: condition stays unknown until reviewed', async () => {
    const s = session()
    await command(s, 'fleet', 'submitInspection', ['veh-T6010', { date: '2026-10-20', submittedBy: 'Clay', notes: '', defects: ['Cracked windshield'] }, TODAY])
    const genuine = (b: { state: { inspections: { demo: boolean }[] } }) => b.state.inspections.find((i) => !i.demo) as unknown as Record<string, unknown> & { id: string; defects: { status: string }[] }
    let { body } = await s.call('GET', '/api/state/fleet')
    expect(genuine(body)).toMatchObject({ review: 'submitted', condition: null })
    const id = genuine(body).id
    await command(s, 'fleet', 'reviewInspection', [id, { reviewedBy: 'John', note: '', condition: 'fair' }, TODAY])
    ;({ body } = await s.call('GET', '/api/state/fleet'))
    expect(genuine(body)).toMatchObject({ review: 'reviewed', condition: 'fair' })
    expect(genuine(body).defects[0].status).toBe('outstanding')
  })

  it('edits to the one vehicle record are visible from every view', async () => {
    const s = session()
    await command(s, 'fleet', 'updateVehicle', ['veh-T6010', { unitNumber: 'T6010', year: 2026, make: 'Ford', model: 'F-350', vin: 'ABC123', licencePlate: '', notes: 'crew cab' }])
    const { body } = await s.call('GET', '/api/state/fleet')
    expect(body.state.vehicles).toHaveLength(4)
    expect(body.state.vehicles[0]).toMatchObject({ vin: 'ABC123', notes: 'crew cab' })
    expect(body.state.assignments.filter((a: { vehicleId: string; endDate: null }) => a.vehicleId === 'veh-T6010' && a.endDate === null)).toHaveLength(1)
  })
})
