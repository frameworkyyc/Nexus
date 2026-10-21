import type { FleetState, Vehicle, VehicleAssignment } from './types'

/**
 * Demonstration seed. Only the four REEF vehicles supplied by the project coordinator are included.
 * VINs, plates, mileage, drivers, inspections and maintenance are intentionally empty (not recorded) rather than invented,
 * and assignment dates are null because they were not provided.
 */
const COMPANY_ID = 'progressive'

const UNITS: [unit: string, year: number, make: string, model: string][] = [
  ['T6010', 2026, 'Ford', 'F-350'],
  ['T6005', 2026, 'Ford', 'F-350'],
  ['LV167', 2024, 'GMC', '3500'],
  ['LV174', 2024, 'GMC', '3500'],
]

export function buildFleetSeed(): FleetState {
  const vehicles: Vehicle[] = UNITS.map(([unitNumber, year, make, model]) => ({
    id: `veh-${unitNumber}`, companyId: COMPANY_ID, unitNumber, year, make, model, vin: null, licencePlate: null, notes: '',
  }))
  const assignments: VehicleAssignment[] = vehicles.map((v) => ({
    id: `asg-${v.unitNumber}-1`, vehicleId: v.id, projectId: 'reef', startDate: null, endDate: null,
  }))
  return { vehicles, assignments, odometer: [], serviceTargets: [], inspections: [], maintenance: [] }
}
