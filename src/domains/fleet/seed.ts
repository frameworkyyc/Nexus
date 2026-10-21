import type { Accessory, FleetState, InspectionRecord, OdometerReading, ServiceTarget, TireSet, Vehicle, VehicleAssignment } from './types'

/**
 * Demonstration seed. Only the four REEF vehicles supplied by the project coordinator are included.
 * VINs, plates, drivers, inspections and maintenance are intentionally empty (not recorded) rather than invented, and
 * assignment dates are null because they were not provided.
 *
 * T6010 additionally carries the verified information supplied for it, and nothing beyond that: the odometer reading and
 * next-service mileage are undated, the tire size/condition/tread/studded status and the oil-change history are unrecorded,
 * and the next service is not assumed to be an oil change.
 */
const COMPANY_ID = 'progressive'

const UNITS: [unit: string, year: number, make: string, model: string][] = [
  ['T6010', 2026, 'Ford', 'F-350'],
  ['T6005', 2026, 'Ford', 'F-350'],
  ['LV167', 2024, 'GMC', '3500'],
  ['LV174', 2024, 'GMC', '3500'],
]

export const T6010_ID = 'veh-T6010'
const VERIFIED_NOTE = 'Verified information supplied for this unit; date not recorded.'

const t6010Odometer = (): OdometerReading => ({
  id: 'odo-T6010-verified', vehicleId: T6010_ID, date: null, reading: 11_856, unit: 'km', review: 'valid', flag: null, correctsId: null, note: VERIFIED_NOTE, reviewNote: '', reviewedDate: null,
})
/**
 * The next scheduled service for T6010 (13,551 km) is an oil change, with a 5,000 km interval; the 2,000 km warning window is the
 * configured threshold for the "approaching" (orange) state. The implied interval start (8,551 km) is a calculated baseline only:
 * no completed oil-change record is created for it.
 */
const t6010Service = (): ServiceTarget => ({
  id: 'svc-T6010-verified', vehicleId: T6010_ID, odometer: 13_551, setDate: null, note: VERIFIED_NOTE, serviceType: 'Oil change', warnWithinKm: 2_000, intervalKm: 5_000,
})
const t6010Tires = (): TireSet => ({
  id: 'tire-T6010-1', vehicleId: T6010_ID, manufacturer: 'Bridgestone', model: 'Dueler A/T', size: null, classes: [], studded: 'unknown', origin: 'Original factory tires', active: true,
  installDate: null, installOdometer: 0, removalDate: null, removalOdometer: null, condition: 'unknown', expectedLifeKm: 60_000, replaceAtMm: null, treads: [], notes: '',
})
const t6010Tank = (): Accessory => ({
  id: 'acc-T6010-tidy-tank', name: '750 L Tidy Tank', category: 'tidy-tank', description: '', specification: '750 L', cost: null, warranty: '', notes: '',
  placements: [{ vehicleId: T6010_ID, installDate: null, installOdometer: null, endDate: null, endOdometer: null, endReason: null, toVehicleId: null, note: '' }],
})

export const T6010_LIFESPAN_KM = 180_000

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
  const untouchedService = (t: ServiceTarget) => t.id === 'svc-T6010-verified' && t.serviceType === null && t.warnWithinKm === null && !t.intervalKm
  return {
    ...s,
    vehicles: s.vehicles.map((v) => (v.id === T6010_ID && v.expectedLifeKm == null ? { ...v, expectedLifeKm: T6010_LIFESPAN_KM } : v)),
    odometer: mine(s.odometer) ? s.odometer : [...s.odometer, t6010Odometer()],
    serviceTargets: mine(s.serviceTargets) ? s.serviceTargets.map((t) => (t.vehicleId === T6010_ID && untouchedService(t) ? { ...t, ...t6010Service() } : t)) : [...s.serviceTargets, t6010Service()],
    tireSets: mine(s.tireSets) ? s.tireSets.map((t) => (t.id === 'tire-T6010-1' && t.expectedLifeKm == null ? { ...t, expectedLifeKm: 60_000 } : t)) : [...s.tireSets, t6010Tires()],
    inspections: mine(s.inspections) ? s.inspections : [...s.inspections, ...demoInspections(T6010_ID)],
    accessories: s.accessories.some((a) => a.placements.some((p) => p.vehicleId === T6010_ID)) ? s.accessories : [...s.accessories, t6010Tank()],
  }
}

export function buildFleetSeed(): FleetState {
  const vehicles: Vehicle[] = UNITS.map(([unitNumber, year, make, model]) => ({
    id: `veh-${unitNumber}`, companyId: COMPANY_ID, unitNumber, year, make, model, vin: null, licencePlate: null, notes: '', expectedLifeKm: null, inspectionIntervalDays: null,
  }))
  const assignments: VehicleAssignment[] = vehicles.map((v) => ({
    id: `asg-${v.unitNumber}-1`, vehicleId: v.id, projectId: 'reef', startDate: null, endDate: null,
  }))
  return applyVerifiedT6010({ vehicles, assignments, odometer: [], serviceTargets: [], inspections: [], maintenance: [], tireSets: [], accessories: [] })
}
