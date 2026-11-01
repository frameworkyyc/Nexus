import type { ISODate } from '@/lib/date'

export type { ISODate }

/* ── Hierarchy: Company → Project → Area → Foundation → Plinth ─────────── */

/** The organization. An id of '' means it has not been created yet (a new installation). */
export interface Company {
  id: string
  name: string
  legalName?: string
  location?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  website?: string
  notes?: string
}

/** Recorded by a person. Never inferred from completion percentages. */
export type ProjectStatus = 'planning' | 'active' | 'at-risk' | 'delayed' | 'on-hold' | 'complete'

export interface Project {
  id: string
  companyId: string
  name: string
  jobNumber: string
  client: string
  location: string
  scope: string
  status: ProjectStatus
  statusNote: string // why the recorded status was chosen
  /** 'detailed' projects derive progress from activity records; 'summary' projects carry a reported figure. */
  tracking: 'detailed' | 'summary'
  reportedProgress: number | null // used only when tracking === 'summary'
  description?: string
  startDate?: ISODate | null
  /** Expected completion. */
  endDate?: ISODate | null
}

export interface ProjectIssue {
  id: string
  projectId: string
  title: string
  severity: 'critical' | 'moderate'
  status: 'open' | 'closed'
  recorded: ISODate
}

export interface Area {
  id: string
  projectId: string
  name: string
  sequence: number
  identifier?: string
  description?: string
  /** Hidden from pickers and lists by default; every record keeps pointing at it. */
  archived?: boolean
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'
/** Rectangular dimensions in one unit. Any value may be null (not measured yet); null is never treated as zero. */
export interface Dims { length: number | null; width: number | null; height: number | null; unit: LengthUnit }

/** A set of identical plinths in a foundation design: how many plinths (per physical foundation), with optional default dimensions. What is mounted on them is in FoundationAnchorage, bolts and embeds (`anchorageTypeId` is the first anchorage's type, kept for older views; null = none). */
export interface AnchorageGroup {
  id: string
  foundationId: string
  anchorageTypeId: string | null
  count: number
  dims: Dims | null
}

/**
 * Where something is mounted: on the footing (pad) of each physical foundation, or on every plinth of one set of plinths (an `AnchorageGroup`, a legacy name:
 * it is a set of identical plinths with a count and default dimensions). `null`/absent = the footing. Plinth and footing quantities never depend on what is mounted.
 */
export type MountGroupId = string | null

/**
 * One anchorage group: `qty` anchorages of one Anchorage Library type mounted on the footing or on each plinth of a set. A mount can have several, of different
 * types. Bolt, nut, washer, template and plate totals come from the type's components × `qty` × how many footings or plinths carry it × the foundation's quantity.
 */
export interface FoundationAnchorage {
  id: string
  foundationId: string
  mountGroupId: MountGroupId
  anchorageTypeId: string
  qty: number
}

/** A rectangular piece of concrete added to, or taken from, a footing's base shape. Millimetres. */
export interface FootingAdjustment { id: string; mode: 'add' | 'deduct'; length: number | null; width: number | null; height: number | null }
/**
 * The footing's base shape when it is not the plain rectangle, plus any additions and deductions. Dimensions are in millimetres; a custom shape holds
 * its volume in m³ directly. Absent = the rectangle in `footing`, as before.
 */
export interface FootingShape {
  kind: 'rectangle' | 'circle' | 'octagon' | 'custom'
  /** Circle. */
  diameter?: number | null
  /** Regular octagon: the distance between two parallel sides. */
  acrossFlats?: number | null
  /** Circle and octagon. */
  height?: number | null
  /** Custom: the concrete volume in m³. */
  volumeM3?: number | null
  adjustments?: FootingAdjustment[]
}

export interface Foundation {
  id: string
  areaId: string
  number: string // e.g. 21-01
  description: string
  notes: string
  docIds: string[]
  /** Hidden from pickers and the default register view; every record keeps pointing at it. */
  archived?: boolean
  /** How many physical foundations share this name/design. Absent = 1. This row stays one designation; individual foundations are not modelled yet. */
  quantity?: number
  /** Plinths on each individual foundation. null = not known; absent = the number of plinth records this foundation has. */
  plinthsPerFoundation?: number | null
  /** Footing length × width × height; absent/null = not entered. */
  footing?: Dims | null
  /** The footing's shape and its additions and deductions; absent = the rectangle above. */
  footingShape?: FootingShape | null
  /** Whether a plinth's height is measured above the footing (default) or from the bottom of the footing (the part inside the footing is not counted twice). */
  plinthBase?: 'above-footing' | 'from-footing-base'
}

export interface Plinth {
  id: string
  foundationId: string
  index: number // 1-based within the foundation
  anchorageTypeId: string | null
  notes: string
  /** The anchorage group this plinth belongs to. Absent = ungrouped (older records). */
  groupId?: string | null
  /** Individual dimensions; replace the group's default for this plinth only. */
  dims?: Dims | null
}

/* ── Concrete pours ─────────────────────────────────────────────────────── */

/** planned = being worked out, no date; scheduled = has a date; completed = poured and closed; cancelled = not going ahead. */
export type PourStatus = 'planned' | 'scheduled' | 'completed' | 'cancelled'

export interface Pour {
  id: string
  projectId: string
  name: string
  status: PourStatus
  date: ISODate | null
  /** Overage allowance added to the planned volume, percent (0–100). */
  wastePct: number
  notes: string
  /** Total concrete actually placed, m³, once recorded. */
  actualM3: number | null
  completedDate: ISODate | null
  createdAt: string
  createdBy: string
}

/**
 * One physical component in a pour: the footing, or one plinth, of one physical foundation (`unit` of 1..quantity of a foundation designation).
 * Planned volume is a snapshot taken when the item is added, so later dimension edits do not rewrite a plan; null = volume was not known.
 */
export interface PourItem {
  id: string
  pourId: string
  foundationId: string
  unit: number
  component: 'footing' | 'plinth'
  plinthId: string | null
  plannedM3: number | null
  /** Concrete placed so far for this component, m³ (partial pours). null = nothing recorded. */
  pouredM3: number | null
  /** Set once the component is fully poured. A component is completed at most once, across every pour. */
  completedDate: ISODate | null
  /** Why a plinth was completed before its footing, when that was authorized. */
  overrideReason: string
  overrideBy: string
}

/** What an anchorage type is made of. Quantities are per anchorage (per plinth that uses the type); materials requirements are calculated from them. */
export type AnchorageComponentKind = 'bolt' | 'sole-plate' | 'top-plate' | 'template' | 'embed-plate'
export interface AnchorageComponent {
  id: string
  anchorageTypeId: string
  kind: AnchorageComponentKind
  /** How many of this component each anchorage has (for bolts: bolts per anchorage). */
  qty: number
  /** Optional name, for example "Base plate". */
  label: string
  /** Material, grade or other specification text. */
  spec: string
  /** Plate / template dimensions as written, for example "300 x 300 x 12 mm". */
  size: string
  // Anchor bolts only
  diameter: string
  length: number | null
  lengthUnit: 'mm' | 'in'
  thread: 'both-ends' | 'all-thread' | null
  topThread: number | null
  bottomThread: number | null
  nutsPerBolt: number
  washersPerBolt: number
  nutSize: string
  washerSize: string
  // Sole plates only: optional centre hole diameter, in lengthUnit (mm or in)
  centerHole?: number | null
  // Top plates only: thickness and width, in lengthUnit (the plate's length is `length`). A top plate has no centre hole.
  thickness?: number | null
  width?: number | null
  // Embed plates only: optional headed studs (per plate), diameter and length in lengthUnit
  studCount?: number | null
  studDiameter?: number | null
  studLength?: number | null
}

/** An embed plate's size and optional headed studs. Created in the foundation form, with no anchorage type behind it. */
export interface PlateSpec { thickness: number; width: number; length: number; unit: 'mm' | 'in'; studCount: number | null; studDiameter: number | null; studLength: number | null }
/** A plate specification saved to the project's library (not tied to an anchorage type), reusable by any foundation. */
export interface LibraryEmbedPlate extends PlateSpec { id: string; projectId: string; createdAt: string; createdBy: string }
/** An embed plate added directly to a foundation. `componentId` names a library embed plate (an anchorage type's, or a saved library plate); empty means the plate's own
 * specification is on the foundation (`plate`). `per-foundation` multiplies `qty` by the number of physical foundations; `total` is the total across all of them. */
export interface FoundationEmbed { id: string; foundationId: string; componentId: string; qty: number; mode: 'per-foundation' | 'total'; plate?: PlateSpec; /** Absent/null = the footing; otherwise every plinth of that set (qty per plinth). */ mountGroupId?: MountGroupId }

/** One physical foundation (or a set sharing a label) within a foundation designation, such as A-1 within OP1-01-01. Optional. It inherits the designation's footing,
 * anchorage configuration and quantity, and adds only its identifier and its own embed plates, chosen from the Anchorage Library. */
export interface FoundationUnit {
  id: string
  foundationId: string
  /** Identifier, unique within the designation (A-1, A-2, B-1…). */
  label: string
  notes: string
  /** Embed plates this individual foundation needs: a library embed plate component and how many. Several allowed. */
  embeds: { id: string; componentId: string; qty: number }[]
}

/** Anchor bolts installed directly in each footing of a foundation: no plinth or anchorage type involved. Quantities are per footing. */
export interface FoundationBolt {
  id: string
  foundationId: string
  /** Bolts per footing. */
  qty: number
  /** Grade / material. */
  spec: string
  diameter: string
  length: number | null
  lengthUnit: 'mm' | 'in'
  thread: 'both-ends' | 'all-thread' | null
  topThread: number | null
  bottomThread: number | null
  nutsPerBolt: number
  washersPerBolt: number
  nutSize: string
  washerSize: string
  /** 'per-foundation' (default): `qty` × the foundation's physical foundations. 'total': `qty` is the total across all of them. */
  mode?: 'per-foundation' | 'total'
  /** Where the bolts are mounted: absent/null = the footing (qty per footing); a plinth set = qty per plinth of that set. */
  mountGroupId?: MountGroupId
}

/* ── Anchorage library & material specifications ───────────────────────── */

export interface BoltSpec {
  id: string
  diameter: string // e.g. 3/4"
  overallLength: number // inches
  topThread: number // inches
  bottomThread: number // inches
  grade: string
}

export type HardwareKind = 'nut' | 'washer'

/** Defined once; referenced by any number of plinths. Values are demonstration data only. */
export interface AnchorageType {
  id: string
  projectId?: string
  archived?: boolean
  code: string // e.g. OP1-02
  description: string
  bolts: { specId: string; qtyPerPlinth: number }[]
  hardware: { kind: HardwareKind; size: string; qtyPerPlinth: number }[]
}

export interface BulkMaterial {
  id: string
  areaId: string
  kind: HardwareKind
  description: string
  size: string
  grade: string
  requiredQty: number
  sample: boolean // true when the quantity is an illustrative figure, not a take-off
}

/* ── Procurement ────────────────────────────────────────────────────────── */

export interface Supplier {
  id: string
  name: string
  category: string
}

export type POStatus = 'draft' | 'issued' | 'cancelled'

export interface POLine {
  id: string
  kind: 'bolt' | 'bulk'
  itemId: string // BoltSpec.id or BulkMaterial.id
  qtyOrdered: number
}

export interface PurchaseOrder {
  id: string
  number: string
  supplierId: string
  status: POStatus
  issuedDate: ISODate | null
  expectedDate: ISODate | null
  notes: string
  lines: POLine[]
}

export interface DeliveryLine {
  id: string
  poLineId: string
  qtyShipped: number // per packing slip / skid tag
  qtyReceived: number // counted on site
  note: string
  resolved: boolean // discrepancy acknowledged
}

export interface Delivery {
  id: string
  number: string
  poId: string
  receivedDate: ISODate
  reference: string
  receivedBy: string
  notes: string
  lines: DeliveryLine[]
}

/** Received inventory is committed to a plinth here. Receiving and allocating are separate steps. */
export interface Allocation {
  id: string
  itemType: 'bolt' | 'bulk'
  itemId: string
  plinthId: string
  qty: number
  date: ISODate
}

export interface PlinthReady {
  plinthId: string
  date: ISODate
}

/* ── Custom fabrication (plywood templates) ─────────────────────────────── */

export type ApprovalStatus = 'not-submitted' | 'quote-requested' | 'under-review' | 'revisions-requested' | 'approved'
export type AuthStatus = 'not-required' | 'pending' | 'authorized' | 'paid'
export type FabStatus = 'not-started' | 'queued' | 'cutting' | 'complete'
export type PickupStatus = 'not-ready' | 'ready' | 'collected'
export type SiteReceiptStatus = 'pending' | 'received'
export type TemplateReuse = 'single-use' | 'reusable' | 'to-be-confirmed'

export interface HistoryEntry {
  id: string
  date: ISODate
  by: string
  text: string
}

export interface FabricationRequest {
  id: string
  number: string
  title: string
  areaId: string
  anchorageTypeId: string
  supplierId: string
  quantity: number // templates produced; independent of assignments
  reuse: TemplateReuse
  plinthIds: string[]
  originalDesignDocId: string | null
  supplierDrawingDocId: string | null
  revision: string
  quotation: { reference: string; amount: number | null; date: ISODate | null }
  approval: ApprovalStatus
  authorization: AuthStatus
  fabrication: FabStatus
  pickup: PickupStatus
  siteReceipt: SiteReceiptStatus
  expectedDate: ISODate | null
  receivedDate: ISODate | null
  notes: string
  history: HistoryEntry[]
}

/* ── Construction tracking ──────────────────────────────────────────────── */

export type ActivityStatus = 'not-started' | 'in-progress' | 'complete' | 'pending-review' | 'approved' | 'blocked'
export type ActivityScope = 'footing' | 'plinth'

export interface Activity {
  id: string // `${ownerId}:${key}` — owner is the foundation (footing) or plinth
  key: string
  scope: ActivityScope
  foundationId: string
  plinthId: string | null
  status: ActivityStatus
  plannedDate: ISODate | null
  actualDate: ISODate | null
  assigneeId: string | null
  notes: string
  docIds: string[]
}

export type DocumentKind = 'design' | 'drawing' | 'quotation' | 'survey' | 'inspection' | 'test-report' | 'other'

/** Placeholder record only — no file content and never an approved-for-construction document. */
export interface DocumentRecord {
  id: string
  title: string
  kind: DocumentKind
  revision: string
  date: ISODate
}

export interface Deficiency {
  id: string
  areaId: string
  foundationId: string | null
  plinthId: string | null
  title: string
  severity: 'minor' | 'major'
  status: 'open' | 'closed'
  raised: ISODate
  closed: ISODate | null
}

/* ── Handover ───────────────────────────────────────────────────────────── */

export type AutoMetric = 'construction' | 'survey' | 'qaqc' | 'deficiencies'

export interface HandoverRequirement {
  id: string
  label: string
  metric: AutoMetric | null // null = confirmed manually
  done: boolean // manual requirements only
  doneDate: ISODate | null
  note: string
}

export type Acceptance = 'not-submitted' | 'submitted' | 'accepted' | 'returned'

export interface HandoverRecord {
  areaId: string
  requirements: HandoverRequirement[]
  acceptance: Acceptance
  submittedDate: ISODate | null
  acceptedDate: ISODate | null
  acceptedBy: string
  notes: string
}

/* ── Workforce context (minimal) ────────────────────────────────────────── */

export interface Crew {
  id: string
  name: string
  offsetDays: number // position in the 14-on / 7-off cycle
}

export type PersonRole = 'superintendent' | 'foreman' | 'carpenter' | 'surveyor' | 'qc-inspector' | 'coordinator'

export interface Person {
  id: string
  name: string
  role: PersonRole
  crewId: string | null
  offsetDays: number | null // superintendents rotate individually
}

export interface ConstructionState {
  company: Company
  projects: Project[]
  projectIssues: ProjectIssue[]
  areas: Area[]
  foundations: Foundation[]
  plinths: Plinth[]
  /** Optional so older saved data and the demo still load; treat absent as empty. */
  anchorageGroups?: AnchorageGroup[]
  /** Anchorage groups mounted on footings and plinths. Absent in data from before they existed: the plinths' own anchorage types are used then. */
  foundationAnchorages?: FoundationAnchorage[]
  foundationBolts?: FoundationBolt[]
  foundationUnits?: FoundationUnit[]
  foundationEmbeds?: FoundationEmbed[]
  libraryEmbedPlates?: LibraryEmbedPlate[]
  /** Components and specifications of each anchorage type. Optional so older data still loads. */
  anchorageComponents?: AnchorageComponent[]
  pours?: Pour[]
  pourItems?: PourItem[]
  boltSpecs: BoltSpec[]
  anchorageTypes: AnchorageType[]
  bulkMaterials: BulkMaterial[]
  suppliers: Supplier[]
  purchaseOrders: PurchaseOrder[]
  deliveries: Delivery[]
  allocations: Allocation[]
  plinthReady: PlinthReady[]
  fabrication: FabricationRequest[]
  activities: Activity[]
  documents: DocumentRecord[]
  deficiencies: Deficiency[]
  handover: HandoverRecord[]
  crews: Crew[]
  people: Person[]
  rotationAnchor: ISODate
}
