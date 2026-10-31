import type { ISODate } from '@/lib/date'
import type { SupplierRecord } from './suppliers'

/**
 * Material tracker records imported from the project's own Excel workbook.
 * Every imported value keeps its sheet and row; nothing is renamed, merged or silently corrected.
 * Delivery information the workbook cannot prove (its "Delivered" status) is kept apart from receipts entered in Nexus.
 */
export interface SourceRef { sheet: string; row: number }

export type ComponentCategory = 'bolt' | 'nut' | 'washer' | 'sole-plate' | 'top-plate' | 'template' | 'embed-plate' | 'other'

/** How the workbook arrived at the required quantity. `expression` is the readable formula, `formula` the original text. */
export interface QuantityCalc {
  kind: 'inputs' | 'derived' | 'entered' | 'unparsed'
  formula: string | null
  expression: string
  /** Re-evaluated from the row's own inputs; null when it cannot be re-evaluated. */
  recomputed: number | null
}

/** A physical receipt recorded in Nexus. Only these count as verified received quantity. */
export interface Receipt {
  id: string; date: ISODate; qty: number; reference: string; note: string
  /** Who confirmed the delivery (verified identity, server only); empty when unknown. */
  by?: string
  /** When it was confirmed (a timestamp, as opposed to `date`, the day the material arrived). */
  at?: string
}

/** What a required quantity is counted per. */
export type QtyBasis = 'fixed' | 'per-anchorage' | 'per-plinth' | 'per-footing'
/** One contribution to a calculated total: this many anchorages of one type, each needing `each` of the item. */
export interface RequirementPart { anchorageTypeId: string; code: string; instances: number; each: number }

export interface TrackerLine {
  id: string // stable across re-imports: area | footing type | anchorage type | component
  source: SourceRef
  area: string // verbatim
  footingType: string
  anchorageType: string
  footings: number
  plinths: number
  bolts: number
  component: string // verbatim
  category: ComponentCategory
  requiredQty: number // the workbook's calculated value
  calc: QuantityCalc
  sourceStatus: string // verbatim ("Delivered" / "Pending"); a spreadsheet claim, not a receipt
  sourceNotes: string[] // cell comments from the workbook
  sourceRemoved?: boolean // true when a later import no longer contains this row but it holds Nexus entries
  // Maintained in Nexus
  orderedQty: number | null
  receipts: Receipt[]
  confirmedNoReceipts: boolean
  notes: string
  // Nexus-side details. For workbook lines only these (never the source facts above) can be changed; materials entered in Nexus
  // (`origin: 'manual'`) own all of their fields.
  /** 'manual': entered in Nexus. 'anchorage': a requirement calculated from the anchorage library and the foundations. Absent: from the workbook. */
  origin?: 'manual' | 'anchorage'
  /** How the entered quantity becomes the required total. Absent = 'fixed' (the quantity is the total). */
  basis?: QtyBasis
  /** The quantity as entered: the total for 'fixed', otherwise the amount per anchorage / plinth / footing. */
  qtyEach?: number | null
  /** Calculated requirements: the stable key that finds this line again, and the parts of the total. */
  deriveKey?: string
  /** Calculated requirements: the anchorage designation (OP1-D2) the material belongs to, or empty for a generic material. */
  designation?: string
  breakdown?: RequirementPart[]
  /** A calculated requirement that no longer applies but has orders or deliveries, so it is kept. */
  requirementRemoved?: boolean
  description?: string
  specification?: string
  size?: string
  unit?: string
  supplier?: string
  poRef?: string
  expectedDate?: string | null
  archived?: boolean
  /** Stable ids of the project records this material is tied to. The text fields above stay as entered, for legacy values and display. */
  areaId?: string | null
  foundationId?: string | null
  anchorageTypeId?: string | null
  supplierId?: string | null
  createdAt?: string
  createdBy?: string
}

/** A recorded change to a material. Append-only: ordinary controls cannot edit or remove it. */
export type AuditAction = 'installation' | 'order' | 'delivery' | 'allocation' | 'created' | 'edited' | 'quantity' | 'status' | 'receipt' | 'receipt-removed' | 'archived' | 'restored' | 'imported' | 'note' | 'configured'
export interface AuditEntry {
  id: string
  at: string
  /** Verified identity (saved-data mode). Empty in the browser-only demo, where no identity exists. */
  by: string
  action: AuditAction
  materialId: string
  label: string
  summary: string
  changes: { field: string; from: string; to: string }[]
}

/** Area-level roll-up as the workbook itself presents it (columns K:N). A summary, never an additional requirement. */
export interface WorkbookSummaryRow { id: string; source: SourceRef; area: string; item: string; totalQty: number; status: string }

/** A row from the workbook's "Anchorage Type" sheet. Reference data: not counted in any requirement or total. */
export interface AnchorageSheetRow {
  id: string
  source: SourceRef
  footingType: string
  anchorageType: string
  footings: number | null
  plinths: number | null
  bolts: number | null
  component: string
  category: ComponentCategory
  requiredQty: number | null
  calc: QuantityCalc
  grade: number | null
  sourceStatus: string
}

export type FlagSeverity = 'review' | 'info'
export interface ImportFlag { id: string; code: string; severity: FlagSeverity; source: SourceRef; lineId?: string; message: string }

export interface ImportMeta {
  fileName: string
  fileSize: number
  sha256: string | null
  importedAt: string
  counts: { materialRows: number; summaryRows: number; anchorageRows: number; flags: number; blankRowsSkipped: number; commentsRead: number }
}

/* ── Procurement ─────────────────────────────────────────────────────────
 * Orders and deliveries are recorded against a consolidated requirement (an area's total of one specification, found by `key`), not against
 * each foundation. The area, category and specification are copied onto every line so a record stays readable if the requirement changes. */
export interface GroupRef { key: string; areaId: string | null; area: string; category: ComponentCategory; name: string; specification: string; size: string; unit: string; /** Anchorage designation, '' for a generic material. */ designation?: string }
export interface PurchaseOrder { id: string; number: string; /** A custom name; empty or absent shows a default worked out from the order's lines. */ name?: string; supplierId: string | null; supplier: string; date: ISODate; expectedDate: string | null; notes: string; cancelled?: boolean; createdAt: string; createdBy: string }
export interface OrderLine extends GroupRef { id: string; orderId: string; qty: number }
/** One shipment: who confirmed it and when, and what it brought. */
export interface Delivery { id: string; orderId: string | null; date: ISODate; reference: string; note: string; by: string; at: string }
export interface DeliveryLine extends GroupRef { id: string; deliveryId: string; orderLineId: string | null; qty: number }
/** Received material set aside for one foundation. Distinct from receiving: a bulk delivery never creates these. */
export interface Allocation { id: string; key: string; foundationId: string; qty: number; by: string; at: string }

/** Material put in place. Recorded against a requirement, separately from receiving and allocating. */
export interface Installation extends GroupRef { id: string; date: ISODate; qty: number; note: string; by: string; at: string }

export interface TrackerState {
  meta: ImportMeta | null
  lines: TrackerLine[]
  /** Materials entered in Nexus. Kept apart from `lines`, which only ever holds what the workbook supplied. */
  manual: TrackerLine[]
  /** Supplier directory and the preferred supplier suggested for each material category. */
  suppliers: SupplierRecord[]
  preferredSuppliers: Partial<Record<ComponentCategory, string>>
  history: AuditEntry[]
  summary: WorkbookSummaryRow[]
  anchorage: AnchorageSheetRow[]
  flags: ImportFlag[]
  acknowledged: Record<string, { date: ISODate; note: string }>
  /** Procurement records (absent in data saved before they existed). */
  orders?: PurchaseOrder[]
  orderLines?: OrderLine[]
  deliveries?: Delivery[]
  deliveryLines?: DeliveryLine[]
  allocations?: Allocation[]
  installations?: Installation[]
}

export const emptyTracker = (): TrackerState => ({ meta: null, lines: [], manual: [], suppliers: [], preferredSuppliers: {}, history: [], summary: [], anchorage: [], flags: [], acknowledged: {}, orders: [], orderLines: [], deliveries: [], deliveryLines: [], allocations: [], installations: [] })
