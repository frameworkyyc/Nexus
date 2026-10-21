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
  date: ISODate | null // null = a verified value supplied without a date
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
export interface ServiceTarget {
  id: string
  vehicleId: string
  odometer: number
  setDate: ISODate | null
  note: string
  /** What the service is, only when someone recorded it. null means unspecified: it is never assumed to be an oil change. */
  serviceType: string | null
  /** Highlight as "due soon" once this many km or fewer remain. null = no warning window recorded. */
  warnWithinKm: number | null
}

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
  serviceType: string // e.g. "Oil change"; "Other" when not classified
  odometer: number | null // odometer when the work was done; null = not recorded
  description: string
  condition?: RatedCondition // outcome, if one was recorded
  notes: string
}

/* ── Tires ─────────────────────────────────────────────────────────────── */

export type TireClass = 'winter' | 'all-season' | 'all-terrain' | 'summer' | 'other'
export type Studded = 'yes' | 'no' | 'unknown'
/** "unknown" means nobody has assessed the set; it is not a good rating. */
export type TireCondition = 'unknown' | 'good' | 'fair' | 'worn' | 'replace'
export interface TreadMeasurement { id: string; date: ISODate | null; odometer: number | null; depthMm: number; note: string }

/** A set of tires fitted to a vehicle over a period. Replaced sets are kept; at most one set per vehicle is active. */
export interface TireSet {
  id: string
  vehicleId: string
  manufacturer: string
  model: string
  size: string | null // null = not recorded
  classes: TireClass[] // may combine, e.g. winter and all-terrain; empty = not recorded
  studded: Studded
  origin: string // e.g. "Original factory tires"
  active: boolean
  installDate: ISODate | null
  installOdometer: number | null
  removalDate: ISODate | null
  removalOdometer: number | null
  condition: TireCondition
  treads: TreadMeasurement[]
  notes: string
}

/* ── Modifications and accessories ─────────────────────────────────────── */

export type AccessoryCategory = 'tidy-tank' | 'light-bar' | 'job-box' | 'headache-rack' | 'radio' | 'other'
export type AccessoryStatus = 'installed' | 'removed' | 'transferred'

/** One period an accessory spent on one vehicle. An open placement (no endReason) means it is installed there now. */
export interface AccessoryPlacement {
  vehicleId: string
  installDate: ISODate | null
  installOdometer: number | null
  endDate: ISODate | null
  endOdometer: number | null
  endReason: 'removed' | 'transferred' | null
  toVehicleId: string | null
  note: string
}

/** The accessory is one record for life: transferring it adds a placement, it never copies or deletes the record. */
export interface Accessory {
  id: string
  name: string
  category: AccessoryCategory
  description: string
  specification: string // capacity or specification, e.g. "750 L"
  cost: number | null
  warranty: string
  notes: string
  placements: AccessoryPlacement[]
}

export interface FleetState {
  vehicles: Vehicle[]
  assignments: VehicleAssignment[]
  odometer: OdometerReading[]
  serviceTargets: ServiceTarget[]
  inspections: InspectionRecord[]
  maintenance: MaintenanceRecord[]
  tireSets: TireSet[]
  accessories: Accessory[]
}
