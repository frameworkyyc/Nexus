import { describe, expect, it } from 'vitest'
import { constructionRoutes } from '@/domains/construction/routes'
import * as A from '../actions'
import { inspectionIndicator, oilIndicator, tireIndicator, lifespanIndicator } from '../indicators'
import { buildFleetSeed, DEMO_INSPECTION_DATES, T6010_ID } from '../seed'
import { conditionOf, fleetRow, historyOf, inspectionsOf, inspectionStatus, outstandingDefects, vehiclesForProject } from '../selectors'
import { fleetRoutes } from '../routes'
import { migrateFleet } from '../store'
import type { FleetState } from '../types'

const TODAY = '2026-10-21'
const seed = () => buildFleetSeed()
const apply = (s: FleetState, r: A.Reducer): FleetState => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: FleetState, r: A.Reducer) => r(s).error

describe('T6010 demonstration inspections', () => {
  const s = seed()
  const demo = inspectionsOf(s, T6010_ID)

  it('are the four Sundays, clearly flagged, with nothing invented', () => {
    expect(DEMO_INSPECTION_DATES).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18'])
    for (const d of DEMO_INSPECTION_DATES) expect(new Date(`${d}T12:00:00Z`).getUTCDay()).toBe(0) // all Sundays
    expect(demo.map((i) => i.date).sort()).toEqual([...DEMO_INSPECTION_DATES])
    for (const i of demo) expect(i).toMatchObject({ demo: true, submittedBy: '', condition: null, defects: [], review: 'submitted', reviewedBy: '', reviewedDate: null, reviewNote: '' })
    expect(demo.every((i) => /demonstration/i.test(i.notes))).toBe(true)
    expect(s.inspections.every((i) => i.vehicleId === T6010_ID)).toBe(true) // no other vehicle gets samples
  })

  it('are labelled in the vehicle history', () => {
    const h = historyOf(s, T6010_ID, () => 'REEF').filter((e) => e.id.includes('-demo-'))
    expect(h).toHaveLength(4)
    expect(h.every((e) => /Demo \/ unverified/.test(e.text))).toBe(true)
  })

  it('never count toward inspection status: a vehicle with only samples is Unknown, not current', () => {
    expect(inspectionStatus(s, T6010_ID, TODAY)).toMatchObject({ state: 'none', daysSince: null, overdue: false, demoCount: 4 })
    expect(inspectionIndicator(s, T6010_ID, TODAY)).toMatchObject({ cadence: 'unknown', status: 'unknown', demoCount: 4, daysSince: null })
    expect(fleetRow(s, s.vehicles[0], TODAY).inspection.state).toBe('none')
  })

  it('do not hide an actual overdue inspection', () => {
    const withReal = apply(s, A.submitInspection(T6010_ID, { date: '2026-10-05', submittedBy: 'x', notes: '', defects: [] }, TODAY))
    // Samples are dated Oct 18 (3 days ago) but the genuine latest is Oct 5 (16 days ago): the gauge reports the genuine one.
    expect(inspectionIndicator(withReal, T6010_ID, TODAY)).toMatchObject({ cadence: 'overdue', status: 'bad', daysSince: 16 })
  })

  it('do not classify the vehicle: condition stays Not assessed and no defects are counted', () => {
    expect(conditionOf(s, T6010_ID)).toBe('not-assessed')
    expect(outstandingDefects(s, T6010_ID)).toEqual([])
    expect(fleetRow(s, s.vehicles[0], TODAY)).toMatchObject({ condition: 'not-assessed', defects: 0 })
  })

  it('cannot be reviewed or given defects (they are not genuine inspections)', () => {
    const id = demo[0].id
    expect(err(s, A.reviewInspection(id, { reviewedBy: 'x', note: '', condition: 'good' }, TODAY))).toMatch(/Demonstration/)
    expect(err(s, A.addDefect(id, 'x'))).toMatch(/Demonstration/)
  })

  it('can be removed without touching genuine inspection history', () => {
    let t = apply(s, A.submitInspection(T6010_ID, { date: '2026-10-20', submittedBy: 'Real Inspector', notes: 'genuine', defects: ['Cracked mirror'] }, TODAY))
    const genuine = inspectionsOf(t, T6010_ID).find((i) => !i.demo)!
    t = apply(t, A.removeDemoInspections(T6010_ID))
    expect(inspectionsOf(t, T6010_ID)).toEqual([genuine])
    expect(outstandingDefects(t, T6010_ID)).toHaveLength(1)
    expect(err(t, A.removeDemoInspections(T6010_ID))).toMatch(/no demonstration records/)
  })

  it('a genuine inspection updates the gauge, and a clash with a demo date explains what to do', () => {
    expect(err(s, A.submitInspection(T6010_ID, { date: '2026-10-18', submittedBy: 'x', notes: '', defects: [] }, TODAY))).toMatch(/Remove the demonstration records first/)
    const t = apply(apply(s, A.removeDemoInspections(T6010_ID)), A.submitInspection(T6010_ID, { date: '2026-10-18', submittedBy: 'x', notes: '', defects: [] }, TODAY))
    expect(inspectionIndicator(t, T6010_ID, TODAY)).toMatchObject({ cadence: 'current', daysSince: 3, awaitingReview: true, demoCount: 0 })
  })
})

describe('safe migration of existing records', () => {
  /** A browser holding saved v4 data: what the previous build wrote, with the user's own entries. */
  const v4 = () => {
    const s = seed()
    const { expectedLifeKm: _a, inspectionIntervalDays: _b, ...rest } = s.vehicles[0]
    void _a; void _b
    return { ...s, vehicles: s.vehicles.map((v, i) => (i === 0 ? (rest as typeof v) : v)) } as unknown as FleetState
  }

  it('adds T6010’s configured values to a fresh pre-upgrade copy', () => {
    const old = { ...v4(), inspections: [], serviceTargets: [{ id: 'svc-T6010-verified', vehicleId: T6010_ID, odometer: 13_551, setDate: null, note: '', serviceType: null, warnWithinKm: null }], tireSets: seed().tireSets.map((t) => ({ ...t, expectedLifeKm: null })) } as unknown as FleetState
    const m = migrateFleet(old, 4)
    expect(m.vehicles[0]).toMatchObject({ expectedLifeKm: 180_000, inspectionIntervalDays: null })
    expect(oilIndicator(m, T6010_ID)).toMatchObject({ dueAt: 13_551, intervalKm: 5_000, warnWithinKm: 2_000, status: 'warn' })
    expect(lifespanIndicator(m, T6010_ID).remainingKm).toBe(168_144)
    expect(tireIndicator(m, T6010_ID).expectedLifeKm).toBe(60_000)
  })

  it('never overwrites values the user already entered', () => {
    const old = { ...v4(), inspections: [] } as unknown as FleetState
    const mine: FleetState = {
      ...old,
      vehicles: old.vehicles.map((v) => (v.id === T6010_ID ? { ...v, expectedLifeKm: 220_000 } : v)),
      serviceTargets: [{ id: 'svc-mine', vehicleId: T6010_ID, odometer: 15_000, setDate: '2026-10-01', note: 'mine', serviceType: 'Brake service', warnWithinKm: 800 } as never],
      tireSets: old.tireSets.map((t) => ({ ...t, expectedLifeKm: 45_000 })),
    }
    const m = migrateFleet(mine, 4)
    expect(m.vehicles.find((v) => v.id === T6010_ID)!.expectedLifeKm).toBe(220_000)
    expect(m.serviceTargets).toEqual([{ id: 'svc-mine', vehicleId: T6010_ID, odometer: 15_000, setDate: '2026-10-01', note: 'mine', serviceType: 'Brake service', warnWithinKm: 800, intervalKm: null }])
    expect(m.tireSets.find((t) => t.id === 'tire-T6010-1')!.expectedLifeKm).toBe(45_000)
  })

  it('keeps real maintenance and inspection history and adds no samples beside it', () => {
    const base = v4()
    const real: FleetState = {
      ...base,
      maintenance: [{ id: 'm1', vehicleId: T6010_ID, date: '2026-09-01', serviceType: 'Oil change', odometer: 9_000, description: 'real', notes: '' }],
      inspections: [{ id: 'i1', vehicleId: T6010_ID, date: '2026-10-19', submittedBy: 'Real', notes: 'genuine', defects: [], review: 'reviewed', reviewedBy: 'R', reviewedDate: '2026-10-20', reviewNote: '', condition: 'good' } as never],
    }
    const m = migrateFleet(real, 4)
    expect(m.maintenance).toEqual(real.maintenance)
    expect(m.inspections).toEqual([{ ...real.inspections[0], demo: false }])
    expect(inspectionIndicator(m, T6010_ID, TODAY)).toMatchObject({ cadence: 'current', status: 'ok', demoCount: 0 })
  })

  it('is idempotent', () => {
    const once = migrateFleet(v4(), 4)
    expect(migrateFleet(once, 5)).toEqual(once)
  })
})

describe('organization and project fleet share one record', () => {
  it('both routes render the same vehicle dashboard from the same state', () => {
    const find = (routes: typeof fleetRoutes) => routes[0].children!.find((c) => c.path === ':vehicleId')!.element
    const org = find(fleetRoutes)
    const projectBranch = constructionRoutes.flatMap(function walk(r): typeof fleetRoutes { return [r, ...(r.children ?? []).flatMap(walk)] }).find((r) => r.path === 'fleet')!
    const project = projectBranch.children!.find((c) => c.path === ':vehicleId')!.element
    expect((org as { type: unknown }).type).toBe((project as { type: unknown }).type)
  })

  it('a planning edit is visible from the project list and the organization list alike', () => {
    const s = apply(seed(), A.setVehiclePlanning(T6010_ID, { expectedLifeKm: 200_000, inspectionIntervalDays: 10 }))
    const viaProject = vehiclesForProject(s, 'reef').find((v) => v.id === T6010_ID)
    const viaOrg = s.vehicles.find((v) => v.id === T6010_ID)
    expect(viaProject).toBe(viaOrg) // the very same record, not a copy
    expect(viaOrg).toMatchObject({ expectedLifeKm: 200_000, inspectionIntervalDays: 10 })
    expect(s.vehicles.filter((v) => v.unitNumber === 'T6010')).toHaveLength(1)
  })
})
