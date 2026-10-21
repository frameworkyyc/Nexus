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

/**
 * Odometer history is append-only. A reading that looks wrong (a decrease, a back-dated value above a later one, a stated
 * correction) is recorded but held as `needs-review`; it does not change the vehicle's current mileage until someone
 * accepts it. Nothing is rewritten.
 */
export type OdometerReview = 'valid' | 'needs-review' | 'accepted' | 'rejected'
export interface OdometerReading {
  id: string
  vehicleId: string
  date: ISODate
  reading: number
  unit: 'km' | 'mi'
  review: OdometerReview
  flag: string | null // why the reading needs review
  correctsId: string | null // the earlier reading this one is stated to correct
  note: string
  reviewNote: string
  reviewedDate: ISODate | null
}

/** The next scheduled service, as entered by a person. History is kept; the latest entry is current. */
export interface ServiceTarget { id: string; vehicleId: string; odometer: number; setDate: ISODate; note: string }

export type DefectStatus = 'outstanding' | 'resolved'
export interface Defect { id: string; description: string; status: DefectStatus; resolvedDate: ISODate | null; resolutionNote: string }

/**
 * A weekly inspection submission. Submitting does not say the vehicle is sound: `condition` stays null until a reviewer sets
 * it, and defects stay outstanding until someone resolves them.
 */
export type InspectionReview = 'submitted' | 'reviewed'
export interface InspectionRecord {
  id: string
  vehicleId: string
  date: ISODate
  submittedBy: string // free text; not tied to a user account yet
  notes: string
  defects: Defect[]
  review: InspectionReview
  reviewedBy: string
  reviewedDate: ISODate | null
  reviewNote: string
  condition: RatedCondition | null
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
  serviceTargets: ServiceTarget[]
  inspections: InspectionRecord[]
  maintenance: MaintenanceRecord[]
}
