import { identity } from '@/app/identity'
import { todayISO } from '@/lib/date'
import { addSampleHistory } from './sampleHistory'
import type { Accessory, FleetState, InspectionRecord, OdometerReading, ServiceTarget, TireSet, Vehicle, VehicleAssignment } from './types'

/**
 * Seed fleet. The units and the detailed figures for the primary unit come from `@/app/identity`: the real, supplied values in the
 * authenticated app, and clearly fictional ones in the public demo build. Nothing beyond those figures is invented for real data
 * (VINs, plates, drivers, inspections and maintenance stay empty); the public demo adds sample history relative to today.
 *
 * The primary unit's next scheduled service is an oil change on a configured interval; its implied interval start is a calculated
 * baseline only and no completed oil-change record is created for it. The next service is never assumed to be an oil change unless
 * the identity says so.
 */
const COMPANY_ID = identity.companyId
const PRIMARY = identity.fleet.primary

const UNITS = identity.fleet.units
const PROJECT_ID = identity.project.id

/** Kept under its original name: the primary unit has always been T6010 in the real data. */
export const T6010_ID = `veh-${PRIMARY.unit}`
const VERIFIED_NOTE = PRIMARY.note

const t6010Odometer = (): OdometerReading => ({
  id: `odo-${PRIMARY.unit}-verified`, vehicleId: T6010_ID, date: null, reading: PRIMARY.odometerKm, unit: 'km', review: 'valid', flag: null, correctsId: null, note: VERIFIED_NOTE, reviewNote: '', reviewedDate: null,
})
const t6010Service = (): ServiceTarget => ({
  id: `svc-${PRIMARY.unit}-verified`, vehicleId: T6010_ID, odometer: PRIMARY.nextOilAtKm, setDate: null, note: VERIFIED_NOTE, serviceType: 'Oil change', warnWithinKm: PRIMARY.oilWarnWithinKm, intervalKm: PRIMARY.oilIntervalKm,
})
const t6010Tires = (): TireSet => ({
  id: `tire-${PRIMARY.unit}-1`, vehicleId: T6010_ID, manufacturer: PRIMARY.tire.manufacturer, model: PRIMARY.tire.model, size: null, classes: [], studded: 'unknown', origin: PRIMARY.tire.origin, active: true,
  installDate: null, installOdometer: 0, removalDate: null, removalOdometer: null, condition: 'unknown', expectedLifeKm: PRIMARY.tire.lifeKm, replaceAtMm: null, treads: [], notes: '',
})
const t6010Tank = (): Accessory => ({
  id: `acc-${PRIMARY.unit}-tidy-tank`, name: PRIMARY.accessory.name, category: 'tidy-tank', description: '', specification: PRIMARY.accessory.specification, cost: null, warranty: '', notes: '',
  placements: [{ vehicleId: T6010_ID, installDate: null, installOdometer: null, endDate: null, endOdometer: null, endReason: null, toVehicleId: null, note: '' }],
})

export const T6010_LIFESPAN_KM = PRIMARY.lifespanKm

/** The four Sunday sample inspections. Unverified by definition: no inspector, no results, no condition, no defects. */
export const DEMO_INSPECTION_DATES = ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18'] as const
export const demoInspections = (vehicleId: string): InspectionRecord[] => DEMO_INSPECTION_DATES.map((date) => ({
  id: `insp-${vehicleId.replace(/^veh-/, '')}-demo-${date}`, vehicleId, date, submittedBy: '', notes: 'Demonstration record: not a genuine inspection.', defects: [], review: 'submitted', reviewedBy: '', reviewedDate: null, reviewNote: '', condition: null, demo: true,
}))

/**
 * Adds T6010's verified and configured information to a state that does not have it yet. Each piece is filled in only where that
 * part is still empty: a value someone already entered, even a different one, is never replaced. The sample inspections are added
 * only when the vehicle has no inspection records at all, so they can never sit beside (or hide) genuine history that predates them.
 */
export function applyVerifiedT6010(s: FleetState): FleetState {
  if (!s.vehicles.some((v) => v.id === T6010_ID)) return s
  const mine = <T extends { vehicleId: string }>(xs: T[]) => xs.some((x) => x.vehicleId === T6010_ID)
  const untouchedService = (t: ServiceTarget) => t.id === `svc-${PRIMARY.unit}-verified` && t.serviceType === null && t.warnWithinKm === null && !t.intervalKm
  return {
    ...s,
    vehicles: s.vehicles.map((v) => (v.id === T6010_ID && v.expectedLifeKm == null ? { ...v, expectedLifeKm: T6010_LIFESPAN_KM } : v)),
    odometer: mine(s.odometer) ? s.odometer : [...s.odometer, t6010Odometer()],
    serviceTargets: mine(s.serviceTargets) ? s.serviceTargets.map((t) => (t.vehicleId === T6010_ID && untouchedService(t) ? { ...t, ...t6010Service() } : t)) : [...s.serviceTargets, t6010Service()],
    tireSets: mine(s.tireSets) ? s.tireSets.map((t) => (t.id === `tire-${PRIMARY.unit}-1` && t.expectedLifeKm == null ? { ...t, expectedLifeKm: PRIMARY.tire.lifeKm } : t)) : [...s.tireSets, t6010Tires()],
    // Real data: four labelled placeholder inspections for testing the interface. The public demo has full sample history instead.
    inspections: mine(s.inspections) || identity.fleet.extras ? s.inspections : [...s.inspections, ...demoInspections(T6010_ID)],
    accessories: s.accessories.some((a) => a.placements.some((p) => p.vehicleId === T6010_ID)) ? s.accessories : [...s.accessories, t6010Tank()],
  }
}

export function buildFleetSeed(): FleetState {
  const vehicles: Vehicle[] = UNITS.map(([unitNumber, year, make, model]) => ({
    id: `veh-${unitNumber}`, companyId: COMPANY_ID, unitNumber, year, make, model, vin: null, licencePlate: null, notes: '', expectedLifeKm: null, inspectionIntervalDays: null,
  }))
  const assignments: VehicleAssignment[] = vehicles.map((v) => ({
    id: `asg-${v.unitNumber}-1`, vehicleId: v.id, projectId: PROJECT_ID, startDate: null, endDate: null,
  }))
  const base = applyVerifiedT6010({ vehicles, assignments, odometer: [], serviceTargets: [], inspections: [], maintenance: [], tireSets: [], accessories: [] })
  return identity.fleet.extras ? addSampleHistory(base, T6010_ID, todayISO()) : base
}
