import { describe, expect, it } from 'vitest'
import { buildSeed } from '@/domains/construction/seed'
import * as A from '../actions'
import { reassignVehicle, type Reducer } from '../actions'
import { canReassign, canUpdate, canView, DEMO_ACTOR, visibleVehicles, type FleetActor } from '../access'
import { migrateFleet } from '../store'
import { buildFleetSeed } from '../seed'
import { conditionOf, currentAssignment, fleetCounts, fleetRow, historyOf, inspectionStatus, latestOdometer, odometerHistory, outstandingDefects, readingsNeedingReview, serviceStatus, vehiclesForProject } from '../selectors'
import type { FleetState } from '../types'

const TODAY = '2026-10-21'
const projects = buildSeed(TODAY).projects.map((p) => p.id)
const name = (id: string) => (id === 'reef' ? 'REEF' : id)
const apply = (s: FleetState, r: Reducer): FleetState => {
  const out = r(s)
  if (out.error !== undefined) throw new Error(out.error)
  return out.state
}

describe('fleet seed', () => {
  const s = buildFleetSeed()

  it('contains exactly the four supplied REEF vehicles', () => {
    expect(s.vehicles.map((v) => [v.unitNumber, v.year, v.make, v.model])).toEqual([
      ['T6010', 2026, 'Ford', 'F-350'],
      ['T6005', 2026, 'Ford', 'F-350'],
      ['LV167', 2024, 'GMC', '3500'],
      ['LV174', 2024, 'GMC', '3500'],
    ])
    expect(new Set(s.vehicles.map((v) => v.unitNumber)).size).toBe(4)
  })

  it('does not invent VINs, plates, mileage, inspections, maintenance, notes or assignment dates', () => {
    for (const v of s.vehicles) expect(v).toMatchObject({ vin: null, licencePlate: null, notes: '' })
    expect(s.odometer).toEqual([])
    expect(s.inspections).toEqual([])
    expect(s.maintenance).toEqual([])
    for (const a of s.assignments) expect(a.startDate).toBeNull()
    expect(JSON.stringify(s)).not.toMatch(/driver/i)
  })

  it('assigns every vehicle to the existing REEF project via its id', () => {
    expect(projects).toContain('reef')
    for (const v of s.vehicles) expect(currentAssignment(s, v.id)?.projectId).toBe('reef')
  })

  it('models vehicles as organization-level assets, not project-owned records', () => {
    for (const v of s.vehicles) {
      expect(v.companyId).toBe('progressive')
      expect(v).not.toHaveProperty('projectId')
    }
  })

  it('reports every vehicle as Not assessed until a record states a condition', () => {
    for (const v of s.vehicles) expect(conditionOf(s, v.id)).toBe('not-assessed')
    expect(latestOdometer(s, s.vehicles[0].id)).toBeUndefined()
  })

  it('counts vehicles and project assignments', () => {
    expect(fleetCounts(s)).toEqual({ vehicles: 4, assigned: 4, unassigned: 0, projects: 1 })
  })
})

describe('condition derivation', () => {
  it('uses the most recent recorded inspection or maintenance outcome', () => {
    const s = buildFleetSeed()
    const id = s.vehicles[0].id
    const next: FleetState = {
      ...s,
      inspections: [{ id: 'i1', vehicleId: id, date: '2026-09-01', submittedBy: '', notes: '', defects: [], review: 'reviewed', reviewedBy: '', reviewedDate: '2026-09-02', reviewNote: '', condition: 'good' }],
      maintenance: [{ id: 'm1', vehicleId: id, date: '2026-10-01', description: 'Brake service', condition: 'fair', notes: '' }, { id: 'm2', vehicleId: id, date: '2026-10-10', description: 'Oil change', notes: '' }],
    }
    expect(conditionOf(next, id)).toBe('fair') // latest dated record that states a condition
    expect(conditionOf(next, s.vehicles[1].id)).toBe('not-assessed') // other vehicles unaffected
  })
})

describe('reassignment', () => {
  const s = buildFleetSeed()
  const id = s.vehicles[0].id
  const other = projects.find((p) => p !== 'reef')!

  it('moves a vehicle between projects and keeps the earlier assignment in history', () => {
    const next = apply(s, reassignVehicle(id, other, projects, TODAY))
    expect(currentAssignment(next, id)?.projectId).toBe(other)
    expect(next.assignments.filter((a) => a.vehicleId === id)).toHaveLength(2)
    const history = historyOf(next, id, name)
    expect(history.map((h) => h.text)).toEqual([`Assigned to ${other}`, 'Removed from REEF', 'Assigned to REEF'])
    expect(history[0].date).toBe(TODAY)
    expect(history[history.length - 1].date).toBeNull() // seed assignment date was never recorded
    expect(fleetCounts(next)).toMatchObject({ assigned: 4, projects: 2 })
  })

  it('can unassign a vehicle and reassign it later', () => {
    const off = apply(s, reassignVehicle(id, null, projects, TODAY))
    expect(currentAssignment(off, id)).toBeUndefined()
    expect(fleetCounts(off)).toMatchObject({ assigned: 3, unassigned: 1 })
    expect(currentAssignment(apply(off, reassignVehicle(id, 'reef', projects, TODAY)), id)?.projectId).toBe('reef')
  })

  it('rejects unknown projects, unknown vehicles and no-op moves', () => {
    expect(reassignVehicle(id, 'nope', projects, TODAY)(s).error).toMatch(/does not exist/)
    expect(reassignVehicle('ghost', 'reef', projects, TODAY)(s).error).toMatch(/not found/)
    expect(reassignVehicle(id, 'reef', projects, TODAY)(s).error).toMatch(/already/)
  })

  it('leaves the vehicle record itself untouched', () => {
    const next = apply(s, reassignVehicle(id, other, projects, TODAY))
    expect(next.vehicles).toEqual(s.vehicles)
  })
})

const reef = buildFleetSeed()
const T6010 = reef.vehicles[0].id
const T6005 = reef.vehicles[1].id
const err = (s: FleetState, r: Reducer) => r(s).error
const km = (s: FleetState, date: string, reading: number, id = T6010, extra: { note?: string; correctsId?: string | null } = {}) =>
  apply(s, A.recordOdometer(id, { date, reading, note: extra.note ?? '', correctsId: extra.correctsId }, TODAY))

describe('project fleet filtering over the shared records', () => {
  it('lists exactly the vehicles currently assigned to the project', () => {
    expect(vehiclesForProject(reef, 'reef').map((v) => v.unitNumber)).toEqual(['T6010', 'T6005', 'LV167', 'LV174'])
    expect(vehiclesForProject(reef, projects.find((p) => p !== 'reef')!)).toEqual([])
  })

  it('an update made from the project view is visible from the organization view, because both read one state', () => {
    const next = km(reef, '2026-10-12', 41_250)
    expect(fleetRow(next, next.vehicles[0], TODAY).odometer?.reading).toBe(41_250)
    expect(vehiclesForProject(next, 'reef')).toHaveLength(next.vehicles.length)
    expect(next.vehicles).toEqual(reef.vehicles) // the vehicle records themselves are untouched
  })

  it('moving a vehicle removes it from one project view and adds it to another, keeping its history', () => {
    const other = projects.find((p) => p !== 'reef')!
    let s = km(reef, '2026-10-12', 41_250)
    s = apply(s, reassignVehicle(T6010, other, projects, TODAY))
    expect(vehiclesForProject(s, 'reef').map((v) => v.unitNumber)).toEqual(['T6005', 'LV167', 'LV174'])
    expect(vehiclesForProject(s, other).map((v) => v.unitNumber)).toEqual(['T6010'])
    expect(latestOdometer(s, T6010)?.reading).toBe(41_250)
  })
})

describe('odometer history', () => {
  it('starts with no reading rather than an invented one', () => {
    expect(latestOdometer(reef, T6010)).toBeUndefined()
    expect(fleetRow(reef, reef.vehicles[0], TODAY).service.kmRemaining).toBeNull()
  })

  it('latest valid reading becomes the current mileage and history is kept in order', () => {
    let s = km(reef, '2026-10-05', 40_000)
    s = km(s, '2026-10-12', 40_900)
    s = km(s, '2026-10-19', 41_700)
    expect(latestOdometer(s, T6010)).toMatchObject({ reading: 41_700, date: '2026-10-19' })
    expect(odometerHistory(s, T6010).map((r) => r.reading)).toEqual([40_000, 40_900, 41_700])
    expect(latestOdometer(s, T6005)).toBeUndefined() // other vehicles unaffected
  })

  it('refuses impossible readings', () => {
    expect(err(reef, A.recordOdometer(T6010, { date: '2026-10-01', reading: 0, note: '' }, TODAY))).toMatch(/greater than zero/)
    expect(err(reef, A.recordOdometer(T6010, { date: '2026-10-01', reading: -5, note: '' }, TODAY))).toMatch(/greater than zero/)
    expect(err(reef, A.recordOdometer(T6010, { date: '2026-10-01', reading: Number.NaN, note: '' }, TODAY))).toMatch(/greater than zero/)
    expect(err(reef, A.recordOdometer(T6010, { date: '2026-10-01', reading: 100.5, note: '' }, TODAY))).toMatch(/whole number/)
    expect(err(reef, A.recordOdometer(T6010, { date: '2026-11-30', reading: 100, note: '' }, TODAY))).toMatch(/future/)
    expect(err(reef, A.recordOdometer(T6010, { date: 'soon', reading: 100, note: '' }, TODAY))).toMatch(/valid date/)
    expect(err(reef, A.recordOdometer('nope', { date: '2026-10-01', reading: 100, note: '' }, TODAY))).toMatch(/not found/)
    expect(err(km(reef, '2026-10-01', 500), A.recordOdometer(T6010, { date: '2026-10-01', reading: 500, note: '' }, TODAY))).toMatch(/already recorded/)
  })

  it('holds a decrease for review, leaves history intact, and keeps the current mileage unchanged', () => {
    let s = km(reef, '2026-10-05', 40_000)
    s = km(s, '2026-10-12', 40_900)
    s = km(s, '2026-10-19', 38_000)
    const held = odometerHistory(s, T6010).at(-1)!
    expect(held).toMatchObject({ reading: 38_000, review: 'needs-review' })
    expect(held.flag).toMatch(/Lower than the 40,900 km reading on 2026-10-12/)
    expect(latestOdometer(s, T6010)?.reading).toBe(40_900)
    expect(odometerHistory(s, T6010)).toHaveLength(3) // nothing rewritten or removed
    expect(readingsNeedingReview(s, T6010)).toHaveLength(1)
    expect(fleetRow(s, s.vehicles[0], TODAY).flaggedReadings).toBe(1)
  })

  it('holds a back-dated reading that is higher than a later one', () => {
    let s = km(reef, '2026-10-05', 40_000)
    s = km(s, '2026-10-19', 40_900)
    s = km(s, '2026-10-12', 41_500)
    expect(odometerHistory(s, T6010).find((r) => r.reading === 41_500)).toMatchObject({ review: 'needs-review' })
    expect(odometerHistory(s, T6010).find((r) => r.reading === 41_500)!.flag).toMatch(/Higher than the later 40,900 km/)
    expect(latestOdometer(s, T6010)?.reading).toBe(40_900)
  })

  it('accepts a back-dated reading that fits between its neighbours', () => {
    let s = km(reef, '2026-10-05', 40_000)
    s = km(s, '2026-10-19', 41_000)
    s = km(s, '2026-10-12', 40_500)
    expect(odometerHistory(s, T6010).map((r) => [r.reading, r.review])).toEqual([[40_000, 'valid'], [40_500, 'valid'], [41_000, 'valid']])
  })

  it('flags a stated correction for review rather than overwriting the original', () => {
    let s = km(reef, '2026-10-12', 49_000) // mistyped
    const wrong = odometerHistory(s, T6010)[0]
    s = km(s, '2026-10-13', 40_900, T6010, { correctsId: wrong.id, note: 'typo' })
    const fix = odometerHistory(s, T6010).at(-1)!
    expect(fix).toMatchObject({ review: 'needs-review', correctsId: wrong.id })
    expect(fix.flag).toMatch(/correction of the 49,000 km/)
    expect(latestOdometer(s, T6010)?.reading).toBe(49_000) // unchanged until a person decides
    expect(odometerHistory(s, T6010)).toHaveLength(2)
  })

  it('a reviewer can accept or reject a held reading; the decision is recorded and the reading stays', () => {
    let s = km(reef, '2026-10-05', 40_000)
    s = km(s, '2026-10-19', 38_000)
    const id = readingsNeedingReview(s, T6010)[0].id
    const accepted = apply(s, A.reviewOdometer(id, 'accepted', 'odometer was replaced', TODAY))
    expect(latestOdometer(accepted, T6010)?.reading).toBe(38_000)
    expect(accepted.odometer.find((r) => r.id === id)).toMatchObject({ review: 'accepted', reviewNote: 'odometer was replaced', reviewedDate: TODAY })
    const rejected = apply(s, A.reviewOdometer(id, 'rejected', 'typo', TODAY))
    expect(latestOdometer(rejected, T6010)?.reading).toBe(40_000)
    expect(rejected.odometer).toHaveLength(2)
    expect(err(accepted, A.reviewOdometer(id, 'rejected', '', TODAY))).toMatch(/held for review/)
    // A rejected value can be entered again correctly.
    expect(err(rejected, A.recordOdometer(T6010, { date: '2026-10-19', reading: 38_000, note: '' }, TODAY))).toBeUndefined()
  })
})

describe('service maths', () => {
  it('calculates KM remaining from the next service mileage and the latest valid reading', () => {
    let s = km(reef, '2026-10-19', 41_700)
    expect(serviceStatus(s, T6010).kmRemaining).toBeNull() // no target yet: unknown, not estimated
    s = apply(s, A.setServiceTarget(T6010, 45_000, 'A-service', TODAY))
    expect(serviceStatus(s, T6010)).toMatchObject({ kmRemaining: 3_300, overdue: false })
    s = km(s, '2026-10-20', 44_500)
    expect(serviceStatus(s, T6010).kmRemaining).toBe(500)
    s = km(s, '2026-10-21', 45_250)
    expect(serviceStatus(s, T6010)).toMatchObject({ kmRemaining: -250, overdue: true })
  })

  it('ignores readings held for review', () => {
    let s = km(reef, '2026-10-05', 40_000)
    s = apply(s, A.setServiceTarget(T6010, 42_000, '', TODAY))
    s = km(s, '2026-10-19', 30_000) // held
    expect(serviceStatus(s, T6010).kmRemaining).toBe(2_000)
  })

  it('needs a target and a reading; updating the target keeps history', () => {
    let s = apply(reef, A.setServiceTarget(T6010, 45_000, '', TODAY))
    expect(serviceStatus(s, T6010).kmRemaining).toBeNull() // target but no reading
    s = apply(s, A.setServiceTarget(T6010, 50_000, 'moved out', TODAY))
    expect(s.serviceTargets.filter((t) => t.vehicleId === T6010).map((t) => t.odometer)).toEqual([45_000, 50_000])
    expect(serviceStatus(s, T6010).target?.odometer).toBe(50_000)
    expect(serviceStatus(s, T6005).target).toBeUndefined()
  })

  it('rejects invalid service mileage', () => {
    expect(err(reef, A.setServiceTarget(T6010, 0, '', TODAY))).toMatch(/greater than zero/)
    expect(err(reef, A.setServiceTarget(T6010, -10, '', TODAY))).toMatch(/greater than zero/)
    expect(err(reef, A.setServiceTarget(T6010, 100.5, '', TODAY))).toMatch(/whole number/)
    expect(err(apply(reef, A.setServiceTarget(T6010, 1000, '', TODAY)), A.setServiceTarget(T6010, 1000, '', TODAY))).toMatch(/already/)
  })
})

describe('weekly inspections and defects', () => {
  const submit = (s: FleetState, date: string, defects: string[] = [], id = T6010) => apply(s, A.submitInspection(id, { date, submittedBy: 'J. Example', notes: '', defects }, TODAY))

  it('a submission does not imply the vehicle is sound', () => {
    const s = submit(reef, '2026-10-19')
    expect(s.inspections[0]).toMatchObject({ review: 'submitted', condition: null })
    expect(conditionOf(s, T6010)).toBe('not-assessed')
    expect(inspectionStatus(s, T6010, TODAY)).toMatchObject({ state: 'submitted', daysSince: 2, overdue: false })
  })

  it('distinguishes submitted, reviewed and outstanding defects', () => {
    let s = submit(reef, '2026-10-19', ['Cracked windshield', 'Left brake light out'])
    expect(fleetRow(s, s.vehicles[0], TODAY)).toMatchObject({ defects: 2, unreviewedDefects: 2 })
    s = apply(s, A.reviewInspection(s.inspections[0].id, { reviewedBy: 'Clay', note: 'seen', condition: 'fair' }, TODAY))
    expect(s.inspections[0]).toMatchObject({ review: 'reviewed', condition: 'fair', reviewedDate: TODAY })
    expect(conditionOf(s, T6010)).toBe('fair')
    expect(fleetRow(s, s.vehicles[0], TODAY)).toMatchObject({ defects: 2, unreviewedDefects: 0 }) // reviewed, still outstanding
    const [d1] = s.inspections[0].defects
    s = apply(s, A.resolveDefect(s.inspections[0].id, d1.id, 'replaced', TODAY))
    expect(outstandingDefects(s, T6010).map((x) => x.defect.description)).toEqual(['Left brake light out'])
    expect(s.inspections[0].defects[0]).toMatchObject({ status: 'resolved', resolvedDate: TODAY, resolutionNote: 'replaced' })
    expect(err(s, A.resolveDefect(s.inspections[0].id, d1.id, '', TODAY))).toMatch(/already resolved/)
    s = apply(s, A.reopenDefect(s.inspections[0].id, d1.id))
    expect(outstandingDefects(s, T6010)).toHaveLength(2)
    s = apply(s, A.addDefect(s.inspections[0].id, 'Tyre wear'))
    expect(outstandingDefects(s, T6010)).toHaveLength(3)
  })

  it('keeps every weekly inspection and flags a missing week as overdue', () => {
    let s = submit(reef, '2026-10-05')
    s = submit(s, '2026-10-12')
    expect(s.inspections.filter((i) => i.vehicleId === T6010)).toHaveLength(2)
    expect(inspectionStatus(s, T6010, TODAY)).toMatchObject({ daysSince: 9, overdue: true })
    expect(inspectionStatus(s, T6005, TODAY)).toMatchObject({ state: 'none', overdue: false }) // never inspected: nothing claimed
  })

  it('rejects invalid submissions', () => {
    expect(err(reef, A.submitInspection(T6010, { date: '2026-12-01', submittedBy: '', notes: '', defects: [] }, TODAY))).toMatch(/future/)
    expect(err(reef, A.submitInspection(T6010, { date: 'x', submittedBy: '', notes: '', defects: [] }, TODAY))).toMatch(/valid date/)
    expect(err(submit(reef, '2026-10-19'), A.submitInspection(T6010, { date: '2026-10-19', submittedBy: '', notes: '', defects: [] }, TODAY))).toMatch(/already recorded/)
    expect(err(reef, A.addDefect('nope', 'x'))).toMatch(/not found/)
    expect(err(submit(reef, '2026-10-19'), A.reviewInspection('nope', { reviewedBy: '', note: '', condition: null }, TODAY))).toMatch(/not found/)
  })

  it('cannot review an inspection twice', () => {
    let s = submit(reef, '2026-10-19')
    s = apply(s, A.reviewInspection(s.inspections[0].id, { reviewedBy: 'Clay', note: '', condition: null }, TODAY))
    expect(err(s, A.reviewInspection(s.inspections[0].id, { reviewedBy: 'Clay', note: '', condition: 'good' }, TODAY))).toMatch(/already been reviewed/)
  })
})

describe('shared history', () => {
  it('lists odometer readings and inspections with the vehicle history', () => {
    let s = km(reef, '2026-10-12', 40_900)
    s = apply(s, A.submitInspection(T6010, { date: '2026-10-13', submittedBy: '', notes: '', defects: ['x'] }, TODAY))
    const text = historyOf(s, T6010, name).map((h) => h.text)
    expect(text).toEqual(expect.arrayContaining(['Odometer 40,900 km', 'Inspection submitted (1 defect noted), awaiting review']))
  })
})

describe('access rules (not enforced)', () => {
  const supervisor: FleetActor = { id: 'john', name: 'John', role: 'project-supervisor', projectIds: ['reef'] }
  const other: FleetActor = { id: 'sam', name: 'Sam', role: 'project-supervisor', projectIds: ['another'] }
  const viewer: FleetActor = { id: 'v', name: 'V', role: 'project-user', projectIds: ['reef'] }

  it('fleet managers see and update everything; supervisors only their projects; project users are view-only', () => {
    expect(visibleVehicles(reef, DEMO_ACTOR)).toHaveLength(4)
    expect(canUpdate(reef, supervisor, T6010)).toBe(true)
    expect(canView(reef, other, T6010)).toBe(false)
    expect(canUpdate(reef, other, T6010)).toBe(false)
    expect(visibleVehicles(reef, other)).toEqual([])
    expect(canView(reef, viewer, T6010)).toBe(true)
    expect(canUpdate(reef, viewer, T6010)).toBe(false)
    expect(canReassign(supervisor)).toBe(false)
    expect(canReassign(DEMO_ACTOR)).toBe(true)
  })
})

describe('store migration', () => {
  it('upgrades version 1 data without losing records', () => {
    const v1 = { ...buildFleetSeed(), odometer: [{ id: 'o1', vehicleId: T6010, date: '2026-10-01', reading: 1000, unit: 'km' }], inspections: [{ id: 'i1', vehicleId: T6010, date: '2026-10-01', condition: 'good', notes: 'ok' }] }
    delete (v1 as Partial<FleetState>).serviceTargets
    const m = migrateFleet(v1, 1)
    expect(m.vehicles).toHaveLength(4)
    expect(m.serviceTargets).toEqual([])
    expect(m.odometer[0]).toMatchObject({ reading: 1000, review: 'valid' })
    expect(m.inspections[0]).toMatchObject({ review: 'reviewed', condition: 'good', notes: 'ok' })
    expect(latestOdometer(m, T6010)?.reading).toBe(1000)
  })
})
