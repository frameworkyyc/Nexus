import type { ConsolidationSource } from './consolidate'
import { procurementRows, type ProcRow } from './procurement'
import { deliveryStateFor, receivedOf, remainingOf, type DeliveryState } from './selectors'
import type { ComponentCategory, TrackerLine, TrackerState } from './types'
import type { MaterialStatus } from './procurement'

/**
 * The materials model: the one place the quantities and statuses every page shows are worked out from. It reads the requirements (foundations and the
 * Anchorage Library, plus entered materials), the purchase-order lines, delivery lines, allocations and installations, and nothing else:
 *
 *   Required   what the foundations and library need            ProcRow.required
 *   Ordered    purchase-order lines (cancelled orders: only what was delivered)   ProcRow.ordered
 *   Delivered  delivery lines, with or without an order         ProcRow.received
 *   Allocated  set aside for foundations                        ProcRow.allocated / allocatedBy
 *   Installed  recorded installations                           ProcRow.installed
 *   Status     materialStatus(required, ordered, received, installed)   ProcRow.stage
 *
 * Views must not recompute any of these from other fields. Per-foundation figures and per-line figures below are views of the same rows.
 */

export type FoundationMaterialStatus = 'not-started' | 'in-progress' | 'complete'

/** One category of material for one foundation: what it needs, how much of that has been allocated to it, and where the requirements stand. */
export interface FoundationMaterial {
  category: ComponentCategory
  required: number
  /** Allocated to this foundation, never counted beyond what it needs. */
  allocated: number
  /** Any requirement this foundation needs has been ordered or delivered. */
  sourced: boolean
  /** complete: everything the foundation needs is allocated to it. in-progress: some is allocated, or ordered/delivered. not-started: nothing yet. */
  status: FoundationMaterialStatus
  rows: { row: ProcRow; needed: number; allocated: number }[]
}

export interface MaterialsModel {
  /** Every requirement row (plus orders or deliveries whose requirement no longer exists). */
  rows: ProcRow[]
  /** Rows with something required, for one area. */
  areaRows(areaId: string): ProcRow[]
  /** The requirement a material line belongs to, or undefined (for example an archived line). */
  rowOfLine(lineId: string): ProcRow | undefined
  /** What each category needs, and has, for one foundation. */
  forFoundation(foundationId: string): Partial<Record<ComponentCategory, FoundationMaterial>>
}

const cache = new WeakMap<ProcRow[], MaterialsModel>()

export function materialsModel(t: TrackerState, c: ConsolidationSource): MaterialsModel {
  const rows = procurementRows(t, c)
  const hit = cache.get(rows)
  if (hit) return hit
  let byLine: Map<string, ProcRow> | null = null
  let byFoundation: Map<string, Partial<Record<ComponentCategory, FoundationMaterial>>> | null = null
  const model: MaterialsModel = {
    rows,
    areaRows: (areaId) => rows.filter((r) => r.areaId === areaId && r.required > 0),
    rowOfLine(lineId) {
      if (!byLine) { byLine = new Map(); for (const r of rows) for (const l of r.lines) byLine.set(l.id, r) }
      return byLine.get(lineId)
    },
    forFoundation(foundationId) {
      if (!byFoundation) {
        byFoundation = new Map()
        for (const row of rows) {
          if (row.required <= 0) continue
          const needs = new Map<string, number>()
          for (const x of row.contributions) if (x.foundationId) needs.set(x.foundationId, (needs.get(x.foundationId) ?? 0) + x.qty)
          for (const [fid, needed] of needs) {
            const byCat = byFoundation.get(fid) ?? {}
            const fm = byCat[row.category] ?? { category: row.category, required: 0, allocated: 0, sourced: false, status: 'not-started' as FoundationMaterialStatus, rows: [] }
            const allocated = Math.min(needed, row.allocatedBy.get(fid) ?? 0)
            fm.required += needed; fm.allocated += allocated; fm.sourced ||= row.ordered > 0 || row.received > 0
            fm.rows.push({ row, needed, allocated })
            byCat[row.category] = fm
            byFoundation.set(fid, byCat)
          }
        }
        for (const byCat of byFoundation.values()) for (const fm of Object.values(byCat)) fm.status = fm.required > 0 && fm.allocated >= fm.required ? 'complete' : fm.allocated > 0 || fm.sourced ? 'in-progress' : 'not-started'
      }
      return byFoundation.get(foundationId) ?? {}
    },
  }
  cache.set(rows, model)
  return model
}

/**
 * A material line's progress, from the requirement it belongs to (so Material records agree with Materials and Procurement). A line that belongs to no
 * requirement falls back to its own receipts. `shared` marks a requirement made of several lines: its delivered and outstanding figures are the whole
 * requirement's, not this line's alone.
 */
export interface LineProgress { received: number; outstanding: number; required: number; state: DeliveryState; stage: MaterialStatus | null; shared: boolean; /** The requirement's key (undefined when the line belongs to none). */ key?: string }

export function lineProgress(model: MaterialsModel, line: TrackerLine): LineProgress {
  const row = model.rowOfLine(line.id)
  if (!row) { const received = receivedOf(line); return { received, outstanding: remainingOf(line), required: line.requiredQty, state: deliveryStateFor(line.requiredQty, received), stage: null, shared: false } }
  return { received: row.received, outstanding: row.outstanding, required: row.required, state: deliveryStateFor(row.required, row.received), stage: row.stage, shared: row.lines.length > 1, key: row.key }
}
