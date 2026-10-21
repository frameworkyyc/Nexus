import type { ISODate } from '@/lib/date'

/** Condition is only ever stated by a recorded inspection or maintenance outcome; otherwise it is "Not assessed". */
export type ConditionStatus = 'not-assessed' | 'good' | 'fair' | 'poor' | 'out-of-service'
export type RatedCondition = Exclude<ConditionStatus, 'not-assessed'>

/** An organization-level asset. It is never owned by a project; projects reference it through assignments. */
export interface Vehicle {
  id: string
  companyId: string
  unitNumber: string
  year: number
  make: string
  model: string
  vin: string | null // null = not recorded
  licencePlate: string | null // null = not recorded
  notes: string
}

/** A period during which a vehicle is assigned to a project. The current assignment has no end date. */
export interface VehicleAssignment {
  id: string
  vehicleId: string
  projectId: string // Project.id from the project registry
  startDate: ISODate | null // null = date not recorded
  endDate: ISODate | null
}

export interface OdometerReading {
  id: string
  vehicleId: string
  date: ISODate
  reading: number
  unit: 'km' | 'mi'
}

export interface InspectionRecord {
  id: string
  vehicleId: string
  date: ISODate
  condition: RatedCondition
  notes: string
}

export interface MaintenanceRecord {
  id: string
  vehicleId: string
  date: ISODate
  description: string
  condition?: RatedCondition // outcome, if one was recorded
  notes: string
}

export interface FleetState {
  vehicles: Vehicle[]
  assignments: VehicleAssignment[]
  odometer: OdometerReading[]
  inspections: InspectionRecord[]
  maintenance: MaintenanceRecord[]
}
