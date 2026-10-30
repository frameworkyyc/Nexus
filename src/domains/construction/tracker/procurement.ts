import { consolidate, type ConsolidationSource, type Consolidated } from './consolidate'
import type { Allocation, DeliveryLine, GroupRef, OrderLine, PurchaseOrder, TrackerState } from './types'

/**
 * Procurement reads the same consolidated requirements as Materials and adds what has been ordered, received and set aside.
 *   required   — what the consolidated requirement needs (from Materials)
 *   ordered    — purchase-order lines, plus quantities ordered on individual material lines before purchase orders existed
 *   received   — confirmed delivery lines, plus receipts recorded on individual material lines
 *   allocated  — received material set aside for particular foundations; receiving a delivery never allocates
 * Nothing here is stored: it is worked out from the records, so it cannot drift from them.
 */
export type ProcStatus = 'pending' | 'ordered' | 'partial' | 'received'
export const PROC_LABEL: Record<ProcStatus, string> = { pending: 'Pending', ordered: 'Ordered', partial: 'Partially received', received: 'Received' }

/** Pending: required, not ordered. Ordered: placed, nothing here yet. Partially received: some has arrived. Received: all that is required has. */
export function procStatus(required: number, ordered: number, received: number): ProcStatus {
  if (required > 0 && received >= required) return 'received'
  if (received > 0) return 'partial'
  if (ordered > 0) return 'ordered'
  return 'pending'
}

export interface ProcRow extends Consolidated {
  ordered: number
  /** Ordered on individual material lines before purchase orders (kept, and counted). */
  orderedOnLines: number
  received: number
  receivedOnLines: number
  allocated: number
  /** Allocated on individual lines tied to one foundation (kept, and counted). */
  allocatedOnLines: number
  /** Still to arrive: required − received, never below zero. */
  outstanding: number
  /** Still to order: required − ordered, never below zero. */
  toOrder: number
  /** Received and not yet set aside for a foundation. */
  unallocated: number
  status: ProcStatus
  orderLines: OrderLine[]
  deliveryLines: DeliveryLine[]
  allocations: Allocation[]
  /** Orders or deliveries exist for it but nothing requires it now (the configuration changed). */
  orphan: boolean
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const activeOrders = (s: TrackerState): PurchaseOrder[] => (s.orders ?? []).filter((o) => !o.cancelled)

/** Received on individual lines for one foundation, per foundation id (null = not tied to a foundation). */
function legacyAllocatedBy(g: Consolidated): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of g.lines) {
    if (!l.foundationId) continue
    m.set(l.foundationId, (m.get(l.foundationId) ?? 0) + sum(l.receipts.map((r) => r.qty)))
  }
  return m
}

export function procurementRows(s: TrackerState, c: ConsolidationSource): ProcRow[] {
  const groups = consolidate(s, c)
  const live = new Set(activeOrders(s).map((o) => o.id))
  const orderLines = (s.orderLines ?? []).filter((l) => live.has(l.orderId))
  const deliveryLines = s.deliveryLines ?? []
  const allocations = s.allocations ?? []
  const byKey = new Map(groups.map((g) => [g.key, g]))
  const refs = new Map<string, GroupRef>()
  for (const l of [...orderLines, ...deliveryLines]) if (!byKey.has(l.key) && !refs.has(l.key)) refs.set(l.key, l)
  for (const a of allocations) if (!byKey.has(a.key) && !refs.has(a.key)) { /* allocations only follow deliveries, which already carry the reference */ }
  const orphans: Consolidated[] = [...refs.values()].map((r) => ({ ...r, lines: [], required: 0, contributions: [], removed: true }))
  return [...groups, ...orphans].map((g): ProcRow => {
    const ol = orderLines.filter((l) => l.key === g.key), dl = deliveryLines.filter((l) => l.key === g.key), al = allocations.filter((a) => a.key === g.key)
    const orderedOnLines = sum(g.lines.map((l) => l.orderedQty ?? 0))
    const receivedOnLines = sum(g.lines.flatMap((l) => l.receipts.map((r) => r.qty)))
    const allocatedOnLines = sum([...legacyAllocatedBy(g).values()])
    const ordered = orderedOnLines + sum(ol.map((l) => l.qty))
    const received = receivedOnLines + sum(dl.map((l) => l.qty))
    const allocated = allocatedOnLines + sum(al.map((a) => a.qty))
    return {
      ...g, ordered, orderedOnLines, received, receivedOnLines, allocated, allocatedOnLines, outstanding: Math.max(0, g.required - received), toOrder: Math.max(0, g.required - ordered),
      unallocated: Math.max(0, received - allocated), status: procStatus(g.required, ordered, received), orderLines: ol, deliveryLines: dl, allocations: al, orphan: g.lines.length === 0 || (g.removed && g.required === 0),
    }
  }).filter((r) => !(r.removed && r.required === 0 && r.ordered === 0 && r.received === 0))
}

/** What a purchase order has had delivered against each of its lines, and what is still due. */
export function orderProgress(s: TrackerState, orderId: string) {
  const lines = (s.orderLines ?? []).filter((l) => l.orderId === orderId)
  const deliveries = (s.deliveries ?? []).filter((d) => d.orderId === orderId)
  const lineRows = lines.map((l) => {
    const received = sum((s.deliveryLines ?? []).filter((d) => deliveries.some((x) => x.id === d.deliveryId) && (d.orderLineId === l.id)).map((d) => d.qty))
    return { line: l, received, due: Math.max(0, l.qty - received) }
  })
  return { lines: lineRows, ordered: sum(lines.map((l) => l.qty)), received: sum(lineRows.map((r) => r.received)), due: sum(lineRows.map((r) => r.due)), deliveries }
}
