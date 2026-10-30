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

/** One kind of plinth in a foundation design: how many plinths use an anchorage type (null = not known yet), with optional default dimensions. */
export interface AnchorageGroup {
  id: string
  foundationId: string
  anchorageTypeId: string | null
  count: number
  dims: Dims | null
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
