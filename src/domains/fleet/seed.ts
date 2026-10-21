import type { Accessory, FleetState, OdometerReading, ServiceTarget, TireSet, Vehicle, VehicleAssignment } from './types'

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
const t6010Service = (): ServiceTarget => ({
  id: 'svc-T6010-verified', vehicleId: T6010_ID, odometer: 13_551, setDate: null, note: VERIFIED_NOTE, serviceType: null, warnWithinKm: null,
})
const t6010Tires = (): TireSet => ({
  id: 'tire-T6010-1', vehicleId: T6010_ID, manufacturer: 'Bridgestone', model: 'Dueler A/T', size: null, classes: [], studded: 'unknown', origin: 'Original factory tires', active: true,
  installDate: null, installOdometer: 0, removalDate: null, removalOdometer: null, condition: 'unknown', expectedLifeKm: null, replaceAtMm: null, treads: [], notes: '',
})
const t6010Tank = (): Accessory => ({
  id: 'acc-T6010-tidy-tank', name: '750 L Tidy Tank', category: 'tidy-tank', description: '', specification: '750 L', cost: null, warranty: '', notes: '',
  placements: [{ vehicleId: T6010_ID, installDate: null, installOdometer: null, endDate: null, endOdometer: null, endReason: null, toVehicleId: null, note: '' }],
})

/**
 * Adds T6010's verified information to a state that does not have it yet. Each piece is added only if that part is still
 * empty, so a browser that already holds its own T6010 entries keeps them.
 */
export function applyVerifiedT6010(s: FleetState): FleetState {
  if (!s.vehicles.some((v) => v.id === T6010_ID)) return s
  const mine = <T extends { vehicleId: string }>(xs: T[]) => xs.some((x) => x.vehicleId === T6010_ID)
  return {
    ...s,
    odometer: mine(s.odometer) ? s.odometer : [...s.odometer, t6010Odometer()],
    serviceTargets: mine(s.serviceTargets) ? s.serviceTargets : [...s.serviceTargets, t6010Service()],
    tireSets: mine(s.tireSets) ? s.tireSets : [...s.tireSets, t6010Tires()],
    accessories: s.accessories.some((a) => a.placements.some((p) => p.vehicleId === T6010_ID)) ? s.accessories : [...s.accessories, t6010Tank()],
  }
}

export function buildFleetSeed(): FleetState {
  const vehicles: Vehicle[] = UNITS.map(([unitNumber, year, make, model]) => ({
    id: `veh-${unitNumber}`, companyId: COMPANY_ID, unitNumber, year, make, model, vin: null, licencePlate: null, notes: '',
  }))
  const assignments: VehicleAssignment[] = vehicles.map((v) => ({
    id: `asg-${v.unitNumber}-1`, vehicleId: v.id, projectId: 'reef', startDate: null, endDate: null,
  }))
  return applyVerifiedT6010({ vehicles, assignments, odometer: [], serviceTargets: [], inspections: [], maintenance: [], tireSets: [], accessories: [] })
}
