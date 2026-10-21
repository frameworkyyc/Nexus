import type { ISODate } from '@/lib/date'

export type { ISODate }

/* ── Hierarchy: Company → Project → Area → Foundation → Plinth ─────────── */

export interface Company {
  id: string
  name: string
}

export interface Project {
  id: string
  companyId: string
  name: string
  jobNumber: string
  location: string
  scope: string
}

export interface Area {
  id: string
  projectId: string
  name: string
  sequence: number
}

export interface Foundation {
  id: string
  areaId: string
  number: string // e.g. 21-01
  description: string
  notes: string
  docIds: string[]
}

export interface Plinth {
  id: string
  foundationId: string
  index: number // 1-based within the foundation
  anchorageTypeId: string | null
  notes: string
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
  areas: Area[]
  foundations: Foundation[]
  plinths: Plinth[]
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
