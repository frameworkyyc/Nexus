import type { ISODate } from '@/lib/date'

/**
 * Material tracker records imported from the project's own Excel workbook.
 * Every imported value keeps its sheet and row; nothing is renamed, merged or silently corrected.
 * Delivery information the workbook cannot prove (its "Delivered" status) is kept apart from receipts entered in Nexus.
 */
export interface SourceRef { sheet: string; row: number }

export type ComponentCategory = 'bolt' | 'nut' | 'washer' | 'sole-plate' | 'template' | 'embed-plate' | 'other'

/** How the workbook arrived at the required quantity. `expression` is the readable formula, `formula` the original text. */
export interface QuantityCalc {
  kind: 'inputs' | 'derived' | 'entered' | 'unparsed'
  formula: string | null
  expression: string
  /** Re-evaluated from the row's own inputs; null when it cannot be re-evaluated. */
  recomputed: number | null
}

/** A physical receipt recorded in Nexus. Only these count as verified received quantity. */
export interface Receipt { id: string; date: ISODate; qty: number; reference: string; note: string }

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

export interface TrackerState {
  meta: ImportMeta | null
  lines: TrackerLine[]
  summary: WorkbookSummaryRow[]
  anchorage: AnchorageSheetRow[]
  flags: ImportFlag[]
  acknowledged: Record<string, { date: ISODate; note: string }>
}

export const emptyTracker = (): TrackerState => ({ meta: null, lines: [], summary: [], anchorage: [], flags: [], acknowledged: {} })
