import { matchRoutes, type RouteObject } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { constructionRoutes } from '@/domains/construction/routes'
import { fleetRoutes } from '../routes'
import * as A from '../actions'
import { oilIndicator } from '../indicators'
import { buildFleetSeed, applyVerifiedT6010, T6010_ID } from '../seed'
import { fleetPaths } from '../paths'
import {
  accessoriesOf, activeTireSet, currentOilTarget, conditionOf, currentVehicleOf, fleetRow, historyOf, lastService, latestOdometer, maintenanceOf, serviceStatus, tireKm, tireSetsOf, vehiclesForProject,
} from '../selectors'
import type { FleetState } from '../types'

const TODAY = '2026-10-21'
// Most tests exercise genuine records, so they start without the demonstration inspections (covered in demo.test).
const seed = () => { const s = buildFleetSeed(); return { ...s, inspections: s.inspections.filter((i) => !i.demo) } }
const apply = (s: FleetState, r: A.Reducer): FleetState => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: FleetState, r: A.Reducer) => r(s).error
const T6005 = 'veh-T6005'
const tire = (over: Partial<A.TireInput> = {}): A.TireInput => ({ manufacturer: 'Michelin', model: 'X-Ice', size: '', classes: ['winter'], studded: 'unknown', origin: '', installDate: null, installOdometer: 12_000, condition: 'unknown', notes: '', ...over })
const acc = (over: Partial<A.AccessoryInput> = {}): A.AccessoryInput => ({ name: 'Light bar', category: 'light-bar', description: '', specification: '', cost: null, warranty: '', notes: '', ...over })

describe('T6010 verified information', () => {
  const s = seed()
  const t = s.vehicles.find((v) => v.id === T6010_ID)!

  it('carries exactly the supplied values', () => {
    expect(t).toMatchObject({ unitNumber: 'T6010', year: 2026, make: 'Ford', model: 'F-350', vin: null, licencePlate: null })
    expect(vehiclesForProject(s, 'reef').map((v) => v.unitNumber)).toContain('T6010')
    expect(latestOdometer(s, T6010_ID)).toMatchObject({ reading: 11_856, unit: 'km', review: 'valid', date: null })
    expect(s.vehicles.find((v) => v.id === T6010_ID)).toMatchObject({ expectedLifeKm: 180_000, inspectionIntervalDays: null })
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ remaining: 1_695, dueAt: 13_551, status: 'warn' })
    expect(currentOilTarget(s, T6010_ID)).toMatchObject({ odometer: 13_551, serviceType: 'Oil change', intervalKm: 5_000, warnWithinKm: 2_000 })
  })

  it('has one oil-change schedule and no duplicate scheduled service, and invents no completed oil change', () => {
    expect(s.serviceTargets.filter((t) => t.vehicleId === T6010_ID)).toHaveLength(1)
    expect(serviceStatus(s, T6010_ID).target).toBeUndefined() // not a second, generic schedule
    expect(maintenanceOf(s, T6010_ID)).toEqual([]) // the 8,551 km baseline is calculated, never a record
    expect(lastService(s, T6010_ID, 'Oil change')).toBeUndefined()
  })

  it('has the factory tires with only the supplied facts', () => {
    const set = activeTireSet(s, T6010_ID)!
    expect(set).toMatchObject({ manufacturer: 'Bridgestone', model: 'Dueler A/T', origin: 'Original factory tires', installOdometer: 0, active: true })
    expect(tireKm(s, set)).toBe(11_856)
    expect(set).toMatchObject({ size: null, classes: [], studded: 'unknown', installDate: null, condition: 'unknown', treads: [] })
  })

  it('has the 750 L Tidy Tank with no invented date, cost or warranty', () => {
    const [x] = accessoriesOf(s, T6010_ID)
    expect(x.status).toBe('installed')
    expect(x.accessory).toMatchObject({ name: '750 L Tidy Tank', category: 'tidy-tank', specification: '750 L', cost: null, warranty: '' })
    expect(x.placement).toMatchObject({ installDate: null, installOdometer: null })
  })

  it('leaves other vehicles without any of this', () => {
    for (const id of [T6005, 'veh-LV167', 'veh-LV174']) {
      expect(latestOdometer(s, id)).toBeUndefined(); expect(activeTireSet(s, id)).toBeUndefined(); expect(accessoriesOf(s, id)).toEqual([]); expect(serviceStatus(s, id).target).toBeUndefined()
    }
  })

  it('adds the verified values to older saved data only where that part is still empty', () => {
    const own = apply({ ...seed(), odometer: [], serviceTargets: [], tireSets: [], accessories: [] }, A.recordOdometer(T6010_ID, { date: '2026-10-01', reading: 9_000, note: '' }, TODAY))
    const m = applyVerifiedT6010(own)
    expect(m.odometer).toHaveLength(1) // the person's own reading is not overwritten
    expect(m.tireSets).toHaveLength(1)
    expect(applyVerifiedT6010(m)).toEqual(m) // idempotent
  })
})

describe('tire kilometres', () => {
  it('is the latest valid odometer minus the installation odometer', () => {
    let s = seed()
    expect(tireKm(s, activeTireSet(s, T6010_ID)!)).toBe(11_856)
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-20', reading: 12_400, note: '' }, TODAY))
    expect(tireKm(s, activeTireSet(s, T6010_ID)!)).toBe(12_400)
  })

  it('ignores a reading that is held for review', () => {
    let s = seed()
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-20', reading: 5_000, note: '' }, TODAY)) // lower than 11,856 → held
    expect(latestOdometer(s, T6010_ID)?.reading).toBe(11_856)
    expect(tireKm(s, activeTireSet(s, T6010_ID)!)).toBe(11_856)
  })

  it('is unknown when the installation odometer or the vehicle reading is missing, never guessed', () => {
    let s = apply(seed(), A.addTireSet(T6005, tire({ installOdometer: null }), TODAY))
    expect(tireKm(s, activeTireSet(s, T6005)!)).toBeNull()
    s = apply(seed(), A.addTireSet(T6005, tire({ installOdometer: 0 }), TODAY))
    expect(tireKm(s, activeTireSet(s, T6005)!)).toBeNull() // no odometer reading for T6005
  })

  it('counts from a non-zero installation odometer', () => {
    let s = apply(seed(), A.recordOdometer(T6005, { date: '2026-10-10', reading: 30_000, note: '' }, TODAY))
    s = apply(s, A.addTireSet(T6005, tire({ installOdometer: 24_000 }), TODAY))
    expect(tireKm(s, activeTireSet(s, T6005)!)).toBe(6_000)
  })
})

describe('tire-set replacement and history', () => {
  it('keeps the replaced set, closes it with removal details, and leaves one active set', () => {
    let s = seed()
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-20', reading: 14_000, note: '' }, TODAY))
    s = apply(s, A.replaceTireSet(T6010_ID, tire({ manufacturer: 'Nokian', model: 'Hakkapeliitta', classes: ['winter'], studded: 'yes', installOdometer: 14_000, installDate: '2026-10-20' }), { date: '2026-10-20', odometer: 14_000 }, TODAY))
    const sets = tireSetsOf(s, T6010_ID)
    expect(sets).toHaveLength(2)
    expect(sets.filter((t) => t.active)).toHaveLength(1)
    expect(sets[0]).toMatchObject({ manufacturer: 'Nokian', active: true, studded: 'yes', classes: ['winter'] }) // active first
    expect(sets[1]).toMatchObject({ manufacturer: 'Bridgestone', active: false, removalOdometer: 14_000, removalDate: '2026-10-20', origin: 'Original factory tires' })
    expect(tireKm(s, sets[1])).toBe(14_000) // frozen at removal
    expect(tireKm(s, sets[0])).toBe(0)
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-21', reading: 14_250, note: '' }, TODAY))
    expect(tireKm(s, tireSetsOf(s, T6010_ID)[1])).toBe(14_000) // old set no longer accumulates
    expect(tireKm(s, tireSetsOf(s, T6010_ID)[0])).toBe(250)
    expect(historyOf(s, T6010_ID, (id) => id).map((h) => h.text)).toEqual(expect.arrayContaining(['Tires removed: Bridgestone Dueler A/T at 14,000 km', 'Tires installed: Nokian Hakkapeliitta at 14,000 km']))
  })

  it('refuses a second active set and impossible replacement figures', () => {
    const s = seed()
    expect(err(s, A.addTireSet(T6010_ID, tire(), TODAY))).toMatch(/already has an active/)
    expect(err(s, A.replaceTireSet(T6005, tire(), { date: null, odometer: null }, TODAY))).toMatch(/no active tire set/)
    expect(err(s, A.replaceTireSet(T6010_ID, tire({ installOdometer: 99_999 }), { date: null, odometer: null }, TODAY))).toMatch(/above the current odometer/)
    expect(err(s, A.replaceTireSet(T6010_ID, tire({ installOdometer: 11_000 }), { date: null, odometer: 11_856 }, TODAY))).toMatch(/lower odometer/)
    expect(err(s, A.replaceTireSet(T6010_ID, tire({ installOdometer: 11_856 }), { date: '2027-01-01', odometer: 11_856 }, TODAY))).toMatch(/not in the future/)
    expect(err(s, A.addTireSet(T6005, tire({ manufacturer: '', model: '' }), TODAY))).toMatch(/manufacturer or model/)
  })

  it('removing without replacement keeps the set and frees the active slot', () => {
    let s = seed()
    const id = activeTireSet(s, T6010_ID)!.id
    s = apply(s, A.removeTireSet(id, { date: null, odometer: 11_856 }, TODAY))
    expect(activeTireSet(s, T6010_ID)).toBeUndefined()
    expect(tireSetsOf(s, T6010_ID)).toHaveLength(1)
    expect(err(s, A.removeTireSet(id, { date: null, odometer: 1 }, TODAY))).toMatch(/already been removed/)
    s = apply(s, A.addTireSet(T6010_ID, tire({ installOdometer: 11_856 }), TODAY))
    expect(tireSetsOf(s, T6010_ID)).toHaveLength(2)
  })

  it('supports combined classifications, tread measurements and filling in unknowns later', () => {
    let s = seed()
    const id = activeTireSet(s, T6010_ID)!.id
    s = apply(s, A.updateTireSet(id, tire({ manufacturer: 'Bridgestone', model: 'Dueler A/T', classes: ['all-terrain', 'winter'], studded: 'no', size: 'LT275/70R18', installOdometer: 0, origin: 'Original factory tires' }), TODAY))
    expect(activeTireSet(s, T6010_ID)).toMatchObject({ classes: ['all-terrain', 'winter'], studded: 'no', size: 'LT275/70R18' })
    s = apply(s, A.addTreadMeasurement(id, { date: '2026-10-20', depthMm: 9.5, note: '' }, TODAY))
    s = apply(s, A.addTreadMeasurement(id, { date: '2026-10-21', depthMm: 9, note: 'front' }, TODAY))
    expect(activeTireSet(s, T6010_ID)!.treads.map((t) => [t.depthMm, t.odometer])).toEqual([[9.5, 11_856], [9, 11_856]])
    expect(err(s, A.addTreadMeasurement(id, { date: null, depthMm: -1, note: '' }, TODAY))).toMatch(/0 to 30/)
    expect(activeTireSet(s, T6010_ID)!.treads).toHaveLength(2)
  })
})

describe('maintenance thresholds', () => {
  it('highlights overdue, and due soon only when a warning window was recorded', () => {
    let s = apply(seed(), A.setServiceTarget(T6010_ID, 13_551, '', TODAY))
    expect(serviceStatus(s, T6010_ID).state).toBe('ok') // 1,695 km left, no window recorded → no invented warning
    s = apply(s, A.setServiceTarget(T6010_ID, 13_551, '', TODAY, { warnWithinKm: 2_000 }))
    expect(serviceStatus(s, T6010_ID)).toMatchObject({ state: 'due-soon', kmRemaining: 1_695 })
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-20', reading: 13_000, note: '' }, TODAY))
    expect(serviceStatus(s, T6010_ID)).toMatchObject({ state: 'due-soon', kmRemaining: 551 })
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-21', reading: 13_551, note: '' }, TODAY))
    expect(serviceStatus(s, T6010_ID)).toMatchObject({ state: 'due-soon', kmRemaining: 0, overdue: false })
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-21', reading: 13_600, note: '' }, TODAY))
    expect(serviceStatus(s, T6010_ID)).toMatchObject({ state: 'overdue', kmRemaining: -49, overdue: true })
  })

  it('reports not-set and no-reading honestly', () => {
    expect(serviceStatus(seed(), T6005).state).toBe('not-set')
    const s = apply(seed(), A.setServiceTarget(T6005, 5_000, '', TODAY))
    expect(serviceStatus(s, T6005)).toMatchObject({ state: 'no-reading', kmRemaining: null })
  })

  it('a recorded threshold is not a completed service; only maintenance records are', () => {
    let s = apply(seed(), A.setServiceTarget(T6010_ID, 13_551, 'oil', TODAY, { serviceType: 'Oil change' }))
    expect(currentOilTarget(s, T6010_ID)?.serviceType).toBe('Oil change') // only because someone recorded it
    expect(serviceStatus(s, T6010_ID).target).toBeUndefined() // an oil change is not also a generic scheduled service
    expect(lastService(s, T6010_ID)).toBeUndefined()
    s = apply(s, A.recordMaintenance(T6010_ID, { date: '2026-10-10', serviceType: 'Oil change', odometer: 11_000, description: '', notes: '' }, TODAY))
    expect(lastService(s, T6010_ID, 'oil change')).toMatchObject({ odometer: 11_000 })
    expect(lastService(s, T6010_ID, 'Brake service')).toBeUndefined()
  })

  it('records maintenance newest first and validates it', () => {
    let s = seed()
    s = apply(s, A.recordMaintenance(T6010_ID, { date: '2026-09-01', serviceType: 'Tire rotation', odometer: 8_000, description: '', notes: '' }, TODAY))
    s = apply(s, A.recordMaintenance(T6010_ID, { date: '2026-10-01', serviceType: 'Oil change', odometer: 10_000, description: 'synthetic', notes: '' }, TODAY))
    expect(maintenanceOf(s, T6010_ID).map((m) => m.serviceType)).toEqual(['Oil change', 'Tire rotation'])
    expect(lastService(s, T6010_ID)?.serviceType).toBe('Oil change')
    expect(err(s, A.recordMaintenance(T6010_ID, { date: '2026-10-01', serviceType: '', odometer: null, description: '', notes: '' }, TODAY))).toMatch(/type of service/)
    expect(err(s, A.recordMaintenance(T6010_ID, { date: '2027-01-01', serviceType: 'x', odometer: null, description: '', notes: '' }, TODAY))).toMatch(/future/)
    expect(err(s, A.recordMaintenance(T6010_ID, { date: '2026-10-01', serviceType: 'x', odometer: 99_000, description: '', notes: '' }, TODAY))).toMatch(/above the current odometer/)
    expect(err(s, A.setServiceTarget(T6010_ID, 20_000, '', TODAY, { warnWithinKm: -5 }))).toMatch(/warning window/)
  })
})

describe('accessories', () => {
  it('creates an accessory with its details and an installation record', () => {
    const s = apply(seed(), A.addAccessory(T6010_ID, acc({ name: 'Roof light bar', specification: '40 in', cost: 899.5, warranty: '2 years', notes: 'wired to aux' }), { date: '2026-10-15', odometer: 11_000 }, TODAY))
    const mine = accessoriesOf(s, T6010_ID)
    expect(mine.map((x) => x.accessory.name)).toEqual(['750 L Tidy Tank', 'Roof light bar'])
    expect(mine[1]).toMatchObject({ status: 'installed', placement: { installDate: '2026-10-15', installOdometer: 11_000 }, accessory: { cost: 899.5, warranty: '2 years', specification: '40 in' } })
    expect(historyOf(s, T6010_ID, (i) => i).map((h) => h.text)).toContain('Roof light bar installed')
  })

  it('validates accessories', () => {
    const s = seed()
    expect(err(s, A.addAccessory(T6010_ID, acc({ name: ' ' }), { date: null, odometer: null }, TODAY))).toMatch(/name/)
    expect(err(s, A.addAccessory(T6010_ID, acc({ cost: -1 }), { date: null, odometer: null }, TODAY))).toMatch(/Cost/)
    expect(err(s, A.addAccessory(T6010_ID, acc(), { date: '2027-01-01', odometer: null }, TODAY))).toMatch(/not in the future/)
    expect(err(s, A.addAccessory(T6010_ID, acc(), { date: null, odometer: 50_000 }, TODAY))).toMatch(/above the vehicle/)
    expect(err(s, A.addAccessory('nope', acc(), { date: null, odometer: null }, TODAY))).toMatch(/not found/)
  })

  it('lets unknown installation details be filled in later without changing anything else', () => {
    let s = seed()
    const id = s.accessories[0].id
    s = apply(s, A.updateInstallation(id, T6010_ID, { date: '2026-02-01', odometer: 500 }, TODAY))
    s = apply(s, A.updateAccessory(id, acc({ name: '750 L Tidy Tank', category: 'tidy-tank', specification: '750 L', cost: 4200, warranty: '1 year' })))
    expect(accessoriesOf(s, T6010_ID)[0]).toMatchObject({ placement: { installDate: '2026-02-01', installOdometer: 500 }, accessory: { cost: 4200, warranty: '1 year', specification: '750 L' } })
  })

  it('removal keeps the record and its history; reinstalling adds a placement', () => {
    let s = seed()
    const id = s.accessories[0].id
    s = apply(s, A.removeAccessory(id, { date: '2026-10-20', odometer: 11_856, note: 'sold truck bed' }, TODAY))
    expect(accessoriesOf(s, T6010_ID)[0]).toMatchObject({ status: 'removed', placement: { endReason: 'removed', endOdometer: 11_856 } })
    expect(currentVehicleOf(s.accessories[0])).toBeNull()
    expect(err(s, A.removeAccessory(id, { date: null, odometer: null, note: '' }, TODAY))).toMatch(/not currently installed/)
    s = apply(s, A.installAccessory(id, T6010_ID, { date: '2026-10-21', odometer: 11_856, note: '' }, TODAY))
    expect(s.accessories).toHaveLength(1)
    expect(s.accessories[0].placements).toHaveLength(2)
    expect(accessoriesOf(s, T6010_ID)[0].status).toBe('installed')
    expect(err(s, A.installAccessory(id, T6010_ID, { date: null, odometer: null, note: '' }, TODAY))).toMatch(/already installed/)
  })

  it('transfers an accessory between vehicles without losing the original record', () => {
    let s = apply(seed(), A.recordOdometer(T6005, { date: '2026-10-10', reading: 8_000, note: '' }, TODAY))
    const id = s.accessories[0].id
    s = apply(s, A.transferAccessory(id, T6005, { date: '2026-10-20', fromOdometer: 11_856, toOdometer: 8_000, note: 'moved to T6005' }, TODAY))
    expect(s.accessories).toHaveLength(1) // one record for the accessory's whole life
    expect(s.accessories[0].id).toBe(id)
    expect(s.accessories[0].placements.map((p) => [p.vehicleId, p.endReason])).toEqual([[T6010_ID, 'transferred'], [T6005, null]])
    expect(accessoriesOf(s, T6010_ID)[0]).toMatchObject({ status: 'transferred', placement: { toVehicleId: T6005, endOdometer: 11_856 } })
    expect(accessoriesOf(s, T6005)[0]).toMatchObject({ status: 'installed', placement: { installOdometer: 8_000 } })
    expect(currentVehicleOf(s.accessories[0])).toBe(T6005)
    expect(fleetRow(s, s.vehicles[0], TODAY).accessories).toBe(0)
    expect(fleetRow(s, s.vehicles[1], TODAY).accessories).toBe(1)
    expect(err(s, A.transferAccessory(id, T6005, { date: null, fromOdometer: null, toOdometer: null, note: '' }, TODAY))).toMatch(/already on that vehicle/)
    expect(err(s, A.transferAccessory(id, 'nope', { date: null, fromOdometer: null, toOdometer: null, note: '' }, TODAY))).toMatch(/not found/)
    expect(historyOf(s, T6010_ID, (i) => i).map((h) => h.text)).toEqual(expect.arrayContaining(['750 L Tidy Tank installed', '750 L Tidy Tank transferred to another vehicle']))
  })
})

describe('shared vehicle records', () => {
  it('editing a vehicle once changes it in both the project and organization lists', () => {
    const s = apply(seed(), A.updateVehicle(T6010_ID, { unitNumber: 'T6010', year: 2026, make: 'Ford', model: 'F-350 Super Duty', vin: ' 1FT0000000000 ', licencePlate: '', notes: 'crew cab' }))
    const fromProject = vehiclesForProject(s, 'reef').find((v) => v.id === T6010_ID)!
    const fromOrg = s.vehicles.find((v) => v.id === T6010_ID)!
    expect(fromProject).toBe(fromOrg) // the very same record object, not a copy
    expect(fromOrg).toMatchObject({ model: 'F-350 Super Duty', vin: '1FT0000000000', licencePlate: null, notes: 'crew cab' })
    expect(s.vehicles).toHaveLength(4) // no duplicate was created
  })

  it('validates edits and keeps unit numbers unique', () => {
    const s = seed()
    const base = { unitNumber: 'T6010', year: 2026, make: 'Ford', model: 'F-350', vin: '', licencePlate: '', notes: '' }
    expect(err(s, A.updateVehicle(T6010_ID, { ...base, unitNumber: ' ' }))).toMatch(/unit number/)
    expect(err(s, A.updateVehicle(T6010_ID, { ...base, unitNumber: 't6005' }))).toMatch(/already exists/)
    expect(err(s, A.updateVehicle(T6010_ID, { ...base, year: 1900 }))).toMatch(/model year/)
    expect(err(s, A.updateVehicle(T6010_ID, { ...base, make: '' }))).toMatch(/make and model/)
    expect(err(s, A.updateVehicle('nope', base))).toMatch(/not found/)
  })

  it('odometer, tire and accessory updates are visible through the same row from either view', () => {
    let s = seed()
    s = apply(s, A.recordOdometer(T6010_ID, { date: '2026-10-20', reading: 12_000, note: '' }, TODAY))
    const row = fleetRow(s, s.vehicles[0], TODAY)
    expect(row).toMatchObject({ odometer: { reading: 12_000 }, tireKm: 12_000, accessories: 1 })
    expect(row.service.kmRemaining).toBe(1_551)
  })

  it('project access follows the current assignment', () => {
    let s = seed()
    s = apply(s, A.reassignVehicle(T6010_ID, 'p-901', ['reef', 'p-901'], TODAY))
    expect(vehiclesForProject(s, 'reef').map((v) => v.unitNumber)).not.toContain('T6010')
    expect(vehiclesForProject(s, 'p-901').map((v) => v.unitNumber)).toEqual(['T6010'])
    expect(activeTireSet(s, T6010_ID)).toBeDefined() // its records travel with the vehicle
  })
})

describe('unknown versus verified condition', () => {
  it('a vehicle is Not assessed until a reviewed inspection states a condition; submission alone is not health', () => {
    let s = seed()
    expect(conditionOf(s, T6010_ID)).toBe('not-assessed')
    s = apply(s, A.submitInspection(T6010_ID, { date: '2026-10-20', submittedBy: 'Clay', notes: 'all fine', defects: [] }, TODAY))
    expect(conditionOf(s, T6010_ID)).toBe('not-assessed')
    s = apply(s, A.reviewInspection(s.inspections[0].id, { reviewedBy: 'John', note: '', condition: null }, TODAY))
    expect(conditionOf(s, T6010_ID)).toBe('not-assessed') // reviewed, but no condition stated
    s = apply(s, A.submitInspection(T6010_ID, { date: '2026-10-21', submittedBy: 'Clay', notes: '', defects: [] }, TODAY))
    s = apply(s, A.reviewInspection(s.inspections[1].id, { reviewedBy: 'John', note: '', condition: 'good' }, TODAY))
    expect(conditionOf(s, T6010_ID)).toBe('good')
  })

  it('tire condition is unknown until someone records one', () => {
    let s = seed()
    const id = activeTireSet(s, T6010_ID)!.id
    expect(activeTireSet(s, T6010_ID)!.condition).toBe('unknown')
    s = apply(s, A.setTireCondition(id, 'good'))
    expect(activeTireSet(s, T6010_ID)!.condition).toBe('good')
    expect(err(s, A.setTireCondition('nope', 'good'))).toMatch(/not found/)
  })

  it('studded status is unknown rather than no', () => {
    expect(activeTireSet(seed(), T6010_ID)!.studded).toBe('unknown')
  })
})

describe('navigation: one record, two entrances', () => {
  const ids = (path: string) => matchRoutes([{ path: '/', children: [...constructionRoutes, ...fleetRoutes] }], path)?.map((m) => m.params).at(-1)

  it('builds context-preserving paths', () => {
    expect(fleetPaths.vehicle(T6010_ID, 'reef')).toBe('/projects/reef/fleet/veh-T6010')
    expect(fleetPaths.vehicle(T6010_ID)).toBe('/fleet/veh-T6010')
    expect(fleetPaths.project('reef')).toBe('/projects/reef/fleet')
  })

  it('resolves the project route to the same vehicle id, inside the project', () => {
    expect(ids('/projects/reef/fleet')).toMatchObject({ projectId: 'reef' })
    expect(ids('/projects/reef/fleet/veh-T6010')).toMatchObject({ projectId: 'reef', vehicleId: 'veh-T6010' })
    expect(ids('/fleet/veh-T6010')).toMatchObject({ vehicleId: 'veh-T6010' })
    expect(ids('/fleet/veh-T6010')).not.toHaveProperty('projectId')
  })

  it('both routes render one dashboard component', () => {
    const element = (path: string) => (matchRoutes([{ path: '/', children: [...constructionRoutes, ...fleetRoutes] }], path)?.at(-1)?.route as RouteObject | undefined)?.element
    const a = element('/projects/reef/fleet/veh-T6010') as { type: unknown }
    const b = element('/fleet/veh-T6010') as { type: unknown }
    expect(a.type).toBe(b.type)
  })
})
