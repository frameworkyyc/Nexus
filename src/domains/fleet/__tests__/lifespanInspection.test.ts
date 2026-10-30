import { describe, expect, it } from 'vitest'
import * as A from '../actions'
import { lifespanIndicator, oilIndicator, tireIndicator } from '../indicators'
import { lifespanOf } from '../meter'
import { buildFleetSeed } from '../seed'
import { conditionOf, inspectionsOf, latestOdometer, maintenanceOf } from '../selectors'
import type { FleetState } from '../types'

const TODAY = '2026-10-30'
const V = 'veh-T6005'
const apply = (s: FleetState, r: A.Reducer): FleetState => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: FleetState, r: A.Reducer) => r(s).error
const base = () => {
  let s: FleetState = { ...buildFleetSeed(), inspections: [], odometer: [], serviceTargets: [], maintenance: [], tireSets: [], accessories: [] }
  s = apply(s, A.recordOdometer(V, { date: '2026-10-01', reading: 100_000, note: '' }, TODAY))
  return s
}
const insp = (over: Partial<A.InspectionInput> = {}): A.InspectionInput => ({ date: '2026-10-29', submittedBy: 'Sam', notes: '', defects: [], ...over })

describe('lifespan: organization default and asset override', () => {
  it('uses the category default, an asset estimate takes priority, and the gauge follows the meter', () => {
    let s = base()
    s = apply(s, A.addFleetCategory('Trucks', 'km', 180_000))
    const cat = s.categories![0]
    expect(lifespanOf(s, s.vehicles.find((v) => v.id === V)!)).toMatchObject({ value: null, source: 'none' })
    s = apply(s, A.setVehicleCategory(V, cat.id))
    expect(lifespanOf(s, s.vehicles.find((v) => v.id === V)!)).toMatchObject({ value: 180_000, source: 'category' })
    expect(lifespanIndicator(s, V)).toMatchObject({ expectedKm: 180_000, remainingKm: 80_000, source: 'category', categoryName: 'Trucks' })
    expect(lifespanIndicator(s, V).remainingPercent).toBeCloseTo((80_000 / 180_000) * 100)
    s = apply(s, A.recordOdometer(V, { date: '2026-10-20', reading: 120_000, note: '' }, TODAY))
    expect(lifespanIndicator(s, V).remainingKm).toBe(60_000) // updates as mileage rises
    s = apply(s, A.setVehiclePlanning(V, { expectedLifeKm: 150_000, inspectionIntervalDays: null }))
    expect(lifespanIndicator(s, V)).toMatchObject({ expectedKm: 150_000, source: 'asset', remainingKm: 30_000 })
    s = apply(s, A.setVehiclePlanning(V, { expectedLifeKm: null, inspectionIntervalDays: null })) // clearing the override returns to the default
    expect(lifespanIndicator(s, V).expectedKm).toBe(180_000)
    s = apply(s, A.updateFleetCategory(cat.id, { defaultLife: 200_000 })) // changing the default moves every asset that uses it
    expect(lifespanIndicator(s, V).expectedKm).toBe(200_000)
  })

  it('validates categories: unique ignoring case/spacing, sensible lifespans, never deleted', () => {
    let s = apply(base(), A.addFleetCategory('Trucks', 'km', 180_000))
    expect(err(s, A.addFleetCategory('  trucks ', 'km', null))).toMatch(/already exists/)
    expect(err(s, A.addFleetCategory('Vans', 'km', -5))).toMatch(/default lifespan/)
    expect(err(s, A.addFleetCategory('Vans', 'km', 1.5))).toMatch(/whole number/)
    s = apply(s, A.setFleetCategoryArchived(s.categories![0].id, true))
    expect(err(s, A.setVehicleCategory(V, s.categories![0].id))).toMatch(/archived/)
  })
})

describe('equipment counts operating hours', () => {
  it('hours: one decimal, own unit; the unit cannot change once readings exist; a category sets the unit when there are none', () => {
    let s = base()
    s = apply(s, A.addFleetCategory('Excavators', 'h', 12_000))
    const eq = 'veh-T6010'
    s = { ...s, odometer: s.odometer.filter((r) => r.vehicleId !== eq), serviceTargets: [], maintenance: [], tireSets: [] }
    s = apply(s, A.setVehicleCategory(eq, s.categories![0].id))
    expect(s.vehicles.find((v) => v.id === eq)?.meterUnit).toBe('h')
    s = apply(s, A.recordOdometer(eq, { date: '2026-10-10', reading: 1234.5, note: '' }, TODAY))
    expect(latestOdometer(s, eq)).toMatchObject({ reading: 1234.5, unit: 'h' })
    expect(err(s, A.recordOdometer(eq, { date: '2026-10-11', reading: 1235.25, note: '' }, TODAY))).toMatch(/one decimal/)
    expect(s.vehicles.find((v) => v.id === eq)?.expectedLifeKm).toBeNull() // the km estimate was not carried over as hours
    expect(lifespanIndicator(s, eq)).toMatchObject({ unit: 'h', expectedKm: 12_000, remainingKm: 12_000 - 1234.5 })
    expect(lifespanIndicator(s, eq).label).toMatch(/Within/)
    expect(err(s, A.setVehicleMeterUnit(eq, 'km'))).toMatch(/cannot be changed/)
    expect(err(s, A.recordOdometer(V, { date: '2026-10-11', reading: 100_000.5, note: '' }, TODAY))).toMatch(/whole number of kilometres/)
    expect(err(s, A.setVehicleCategory(V, s.categories![0].id))).toMatch(/already has kilometres readings or schedules/) // V has km readings
  })

  it('a category in a different unit does not supply a default to an asset that counts the other way', () => {
    let s = base()
    s = apply(s, A.addFleetCategory('Excavators', 'h', 12_000))
    s = { ...s, vehicles: s.vehicles.map((v) => (v.id === V ? { ...v, categoryId: s.categories![0].id } : v)) }
    expect(lifespanOf(s, s.vehicles.find((v) => v.id === V)!)).toMatchObject({ value: null, source: 'none' })
  })
})

describe('weekly inspection submission', () => {
  it('updates the meter reading, the lifespan and tire figures, and stays a submission', () => {
    let s = base()
    s = apply(s, A.setVehiclePlanning(V, { expectedLifeKm: 200_000, inspectionIntervalDays: null }))
    s = apply(s, A.addTireSet(V, { manufacturer: 'M', model: 'X', size: '', classes: ['winter'], studded: 'unknown', origin: '', installDate: null, installOdometer: 100_000, condition: 'unknown', notes: '', expectedLifeKm: 50_000 }, TODAY))
    s = apply(s, A.submitInspection(V, insp({ meterReading: 110_000, reportedCondition: 'good', defects: ['Cracked mirror'] }), TODAY))
    expect(latestOdometer(s, V)?.reading).toBe(110_000)
    expect(lifespanIndicator(s, V).remainingKm).toBe(90_000)
    expect(tireIndicator(s, V).km).toBe(10_000)
    const i = inspectionsOf(s, V)[0]
    expect(i).toMatchObject({ review: 'submitted', condition: null, reportedCondition: 'good', meterReading: 110_000, reviewedBy: '' })
    expect(conditionOf(s, V)).toBe('not-assessed') // a reported condition is not a verified one
    expect(i.defects).toMatchObject([{ description: 'Cracked mirror', status: 'outstanding' }])
  })

  it('an older inspection never overwrites a newer reading', () => {
    let s = base()
    s = apply(s, A.recordOdometer(V, { date: '2026-10-25', reading: 105_000, note: '' }, TODAY))
    s = apply(s, A.submitInspection(V, insp({ date: '2026-10-10', meterReading: 120_000 }), TODAY)) // higher than a later reading: contradictory
    expect(latestOdometer(s, V)?.reading).toBe(105_000)
    expect(s.odometer.find((r) => r.reading === 120_000)).toMatchObject({ review: 'needs-review' })
    s = apply(s, A.submitInspection(V, insp({ date: '2026-10-12', meterReading: 102_000 }), TODAY)) // consistent history: recorded, not current
    expect(latestOdometer(s, V)?.reading).toBe(105_000)
    expect(s.odometer.find((r) => r.reading === 102_000)?.review).toBe('valid')
  })

  it('next oil change due sets the schedule without recording an oil change', () => {
    let s = base()
    const before = maintenanceOf(s, V).length
    s = apply(s, A.submitInspection(V, insp({ meterReading: 102_000, nextOilDue: 107_000 }), TODAY))
    const oil = oilIndicator(s, V)
    expect(oil).toMatchObject({ dueAt: 107_000, remaining: 5_000, current: 102_000 })
    expect(maintenanceOf(s, V)).toHaveLength(before)
    expect(oil.last).toBeUndefined() // no completed oil change appeared
    expect(s.serviceTargets.at(-1)).toMatchObject({ serviceType: 'Oil change', odometer: 107_000 })
    // a later inspection moves the gauge again
    s = apply(s, A.submitInspection(V, insp({ date: '2026-10-30', meterReading: 104_000, nextOilDue: 109_000 }), TODAY))
    expect(oilIndicator(s, V)).toMatchObject({ dueAt: 109_000, remaining: 5_000 })
  })

  it('keeps a newer oil schedule when an older inspection supplies a due value, and refuses impossible values', () => {
    let s = base()
    s = apply(s, A.setServiceTarget(V, 112_000, '', TODAY, { serviceType: 'Oil change' }))
    s = apply(s, A.submitInspection(V, insp({ date: '2026-10-05', nextOilDue: 108_000 }), TODAY))
    expect(oilIndicator(s, V).dueAt).toBe(112_000)
    expect(inspectionsOf(s, V)[0].nextOilDue).toBe(108_000) // still on the inspection record
    expect(err(s, A.submitInspection(V, insp({ date: '2026-10-28', nextOilDue: 99_000 }), TODAY))).toMatch(/must be above the current reading/)
    expect(err(s, A.submitInspection(V, insp({ date: '2026-10-28', meterReading: -5 }), TODAY))).toMatch(/odometer/)
    expect(err(s, A.submitInspection(V, insp({ date: '2026-10-28', reportedCondition: 'great' as never }), TODAY))).toMatch(/condition/)
    expect(err(s, A.submitInspection(V, insp({ date: '2026-11-30' }), TODAY))).toMatch(/future/)
  })

  it('an identical reading already on record is not an error and not duplicated', () => {
    let s = base()
    s = apply(s, A.submitInspection(V, insp({ date: '2026-10-01', meterReading: 100_000 }), TODAY))
    expect(s.odometer.filter((r) => r.reading === 100_000)).toHaveLength(1)
    expect(inspectionsOf(s, V)).toHaveLength(1)
  })
})
