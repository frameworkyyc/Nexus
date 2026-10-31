import { CATEGORY_TITLE, consolidate, type ConsolidationSource, type Consolidated } from './consolidate'
import { formatDate } from '@/lib/format'
import type { Allocation, DeliveryLine, GroupRef, Installation, OrderLine, PurchaseOrder, TrackerState } from './types'

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

/**
 * The status of one material requirement, from what has actually been recorded. Installation outranks delivery, which outranks ordering,
 * and a status is only the "full" word (Ordered, Delivered, Installed) when the whole required quantity has reached that stage.
 */
export type MaterialStatus = 'pending' | 'partially-ordered' | 'ordered' | 'partially-delivered' | 'delivered' | 'partially-installed' | 'installed'
export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  pending: 'Pending', 'partially-ordered': 'Partially ordered', ordered: 'Ordered', 'partially-delivered': 'Partially delivered', delivered: 'Delivered', 'partially-installed': 'Partially installed', installed: 'Installed',
}
export function materialStatus(q: { required: number; ordered: number; received: number; installed: number }): MaterialStatus {
  const { required, ordered, received, installed } = q
  if (required > 0 && installed >= required) return 'installed'
  if (installed > 0) return 'partially-installed'
  if (required > 0 && received >= required) return 'delivered'
  if (received > 0) return 'partially-delivered'
  if (required > 0 && ordered >= required) return 'ordered'
  if (ordered > 0) return 'partially-ordered'
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
  /** Installed so far (recorded separately from receiving and allocating). */
  installed: number
  /** Received and not yet installed, and not more than the requirement still needs: what can be installed now. */
  installable: number
  installations: Installation[]
  /** The full status of the requirement (ordering, delivery, installation). */
  stage: MaterialStatus
  orderLines: OrderLine[]
  deliveryLines: DeliveryLine[]
  allocations: Allocation[]
  /** Orders or deliveries exist for it but nothing requires it now (the configuration changed). */
  orphan: boolean
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const activeOrders = (s: TrackerState): PurchaseOrder[] => (s.orders ?? []).filter((o) => !o.cancelled)

/**
 * What an order line counts as ordered. A live order counts what was ordered. A cancelled order counts only what had already been delivered
 * against the line (the undelivered part is cancelled), so cancelling never leaves delivered material unaccounted for and never goes below zero.
 * The line itself keeps the quantity that was originally ordered.
 */
export function deliveredByLine(s: Pick<TrackerState, 'deliveryLines'>): Map<string, number> {
  const m = new Map<string, number>()
  for (const d of s.deliveryLines ?? []) if (d.orderLineId) m.set(d.orderLineId, (m.get(d.orderLineId) ?? 0) + d.qty)
  return m
}
export const countedQty = (cancelled: boolean | undefined, line: { id: string; qty: number }, delivered: Map<string, number>) => (cancelled ? Math.min(line.qty, delivered.get(line.id) ?? 0) : line.qty)

/** Received on individual lines for one foundation, per foundation id (null = not tied to a foundation). */
function legacyAllocatedBy(g: Consolidated): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of g.lines) {
    if (!l.foundationId) continue
    m.set(l.foundationId, (m.get(l.foundationId) ?? 0) + sum(l.receipts.map((r) => r.qty)))
  }
  return m
}

/**
 * Records made before requirements were separated by designation carry the old key (no designation on the end). Such a key follows to its
 * requirement when exactly one designation now owns it; when several share it the record stays visible under its own old key, so nothing is
 * lost or guessed. Records already carrying a current key are untouched.
 */
export function keyAliases(groups: Pick<Consolidated, 'key' | 'designation'>[]): Map<string, string> {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const exact = new Set(groups.map((g) => g.key))
  const byLegacy = new Map<string, string[]>()
  for (const g of groups) {
    if (!g.designation) continue
    const legacy = g.key.slice(0, g.key.length - norm(g.designation).length - 1)
    byLegacy.set(legacy, [...(byLegacy.get(legacy) ?? []), g.key])
  }
  const out = new Map<string, string>()
  for (const [legacy, keys] of byLegacy) if (keys.length === 1 && !exact.has(legacy)) out.set(legacy, keys[0])
  return out
}

export function procurementRows(s: TrackerState, c: ConsolidationSource): ProcRow[] {
  const groups = consolidate(s, c)
  const alias = keyAliases(groups)
  const at = <T extends { key: string }>(r: T): T => (alias.has(r.key) ? { ...r, key: alias.get(r.key)! } : r)
  const cancelled = new Set((s.orders ?? []).filter((o) => o.cancelled).map((o) => o.id))
  const known = new Set((s.orders ?? []).map((o) => o.id))
  const delivered = deliveredByLine(s)
  const orderLines = (s.orderLines ?? []).filter((l) => known.has(l.orderId)).map((l) => ({ ...l, qty: countedQty(cancelled.has(l.orderId), l, delivered) })).filter((l) => l.qty > 0).map(at)
  const deliveryLines = (s.deliveryLines ?? []).map(at)
  const allocations = (s.allocations ?? []).map(at)
  const installs = (s.installations ?? []).map(at)
  const byKey = new Map(groups.map((g) => [g.key, g]))
  const refs = new Map<string, GroupRef>()
  for (const l of [...orderLines, ...deliveryLines, ...installs]) if (!byKey.has(l.key) && !refs.has(l.key)) refs.set(l.key, l)
  const orphans: Consolidated[] = [...refs.values()].map((r) => ({ ...r, designation: r.designation ?? '', lines: [], required: 0, contributions: [], removed: true }))
  return [...groups, ...orphans].map((g): ProcRow => {
    const ol = orderLines.filter((l) => l.key === g.key), dl = deliveryLines.filter((l) => l.key === g.key), al = allocations.filter((a) => a.key === g.key)
    const orderedOnLines = sum(g.lines.map((l) => l.orderedQty ?? 0))
    const receivedOnLines = sum(g.lines.flatMap((l) => l.receipts.map((r) => r.qty)))
    const allocatedOnLines = sum([...legacyAllocatedBy(g).values()])
    const ordered = orderedOnLines + sum(ol.map((l) => l.qty))
    const received = receivedOnLines + sum(dl.map((l) => l.qty))
    const allocated = allocatedOnLines + sum(al.map((a) => a.qty))
    const il = installs.filter((x) => x.key === g.key)
    const installed = sum(il.map((x) => x.qty))
    return {
      ...g, ordered, orderedOnLines, received, receivedOnLines, allocated, allocatedOnLines, outstanding: Math.max(0, g.required - received), toOrder: Math.max(0, g.required - ordered),
      unallocated: Math.max(0, received - allocated), status: procStatus(g.required, ordered, received), installed, installations: il, stage: materialStatus({ required: g.required, ordered, received, installed }), installable: Math.max(0, Math.min(received, g.required) - installed), orderLines: ol, deliveryLines: dl, allocations: al, orphan: g.lines.length === 0 || (g.removed && g.required === 0),
    }
  }).filter((r) => !(r.removed && r.required === 0 && r.ordered === 0 && r.received === 0))
}

/** What a purchase order has had delivered against each of its lines, and what is still due. */
export function orderProgress(s: TrackerState, orderId: string) {
  const lines = (s.orderLines ?? []).filter((l) => l.orderId === orderId)
  const deliveries = (s.deliveries ?? []).filter((d) => d.orderId === orderId)
  const cancelled = !!(s.orders ?? []).find((o) => o.id === orderId)?.cancelled
  const lineRows = lines.map((l) => {
    const received = sum((s.deliveryLines ?? []).filter((d) => deliveries.some((x) => x.id === d.deliveryId) && (d.orderLineId === l.id)).map((d) => d.qty))
    // A cancelled order counts what was delivered as ordered and owes nothing more; `original` is what was first ordered.
    const counted = cancelled ? Math.min(l.qty, received) : l.qty
    return { line: l, original: l.qty, ordered: counted, received, due: cancelled ? 0 : Math.max(0, l.qty - received), cancelledQty: cancelled ? Math.max(0, l.qty - received) : 0 }
  })
  return { lines: lineRows, ordered: sum(lineRows.map((r) => r.ordered)), original: sum(lines.map((l) => l.qty)), received: sum(lineRows.map((r) => r.received)), due: sum(lineRows.map((r) => r.due)), cancelledQty: sum(lineRows.map((r) => r.cancelledQty)), deliveries }
}

/** One requirement across areas: the same specification everywhere it is needed, with each area's own figures kept. */
export interface MergedRow {
  specKey: string
  category: ProcRow['category']
  name: string
  designation: string
  specification: string
  size: string
  unit: string
  required: number
  ordered: number
  received: number
  allocated: number
  installed: number
  stage: MaterialStatus
  /** Per-area rows, so the area breakdown is always available. */
  areas: ProcRow[]
}

/** Combines requirements with matching specifications across areas. Each area row is counted once, so nothing is double-counted. */
export function mergeAcrossAreas(rows: ProcRow[]): MergedRow[] {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
  const out = new Map<string, MergedRow>()
  for (const r of rows) {
    if (r.required <= 0) continue
    const specKey = [r.category, norm(r.designation ?? ''), norm(r.name), norm(r.specification), norm(r.size), norm(r.unit) || 'ea'].join('|')
    const m = out.get(specKey) ?? { specKey, category: r.category, name: r.name, designation: r.designation ?? '', specification: r.specification, size: r.size, unit: r.unit, required: 0, ordered: 0, received: 0, allocated: 0, installed: 0, stage: 'pending' as MaterialStatus, areas: [] }
    m.required += r.required; m.ordered += r.ordered; m.received += r.received; m.allocated += r.allocated; m.installed += r.installed; m.areas.push(r)
    out.set(specKey, m)
  }
  return [...out.values()].map((m) => ({ ...m, stage: materialStatus(m) }))
}

/**
 * The four progress gauges, counted in requirements (lines), not units. Ordered / Delivered / Allocated: requirements that have reached that
 * stage in full. Outstanding: requirements not yet fully ordered, so Ordered + Outstanding is always the total.
 */
export function progressCounts(rows: { required: number; ordered: number; received: number; allocated: number }[]) {
  const live = rows.filter((r) => r.required > 0)
  const ordered = live.filter((r) => r.ordered >= r.required).length
  return { total: live.length, ordered, delivered: live.filter((r) => r.received >= r.required).length, allocated: live.filter((r) => r.allocated >= r.required).length, outstanding: live.length - ordered }
}

/**
 * One area's materials summary, from the same consolidated requirements as the Materials tab and Procurement (so every page agrees). Counted in
 * requirements, and based on what has been delivered in full, never on what was only ordered. `percent` is the share fully delivered.
 */
export function areaMaterialsSummary(s: TrackerState, c: ConsolidationSource, areaId: string) {
  const rows = procurementRows(s, c).filter((r) => r.areaId === areaId && r.required > 0)
  const counts = progressCounts(rows)
  return {
    rows, counts,
    partlyDelivered: rows.filter((r) => r.received > 0 && r.received < r.required).length,
    notFullyDelivered: counts.total - counts.delivered,
    percent: counts.total === 0 ? null : Math.round((counts.delivered / counts.total) * 100),
  }
}

/**
 * What an order is called in lists: its custom name, or, when it has none, a default worked out from what it covers ("E-House Anchor bolts",
 * "E-House materials", "Anchor bolts · 2 areas"), falling back to its date. Nothing is stored for the default, so existing orders are unchanged.
 */
export function orderTitle(s: Pick<TrackerState, 'orderLines'>, o: PurchaseOrder): string {
  if (o.name?.trim()) return o.name.trim()
  const lines = (s.orderLines ?? []).filter((l) => l.orderId === o.id)
  if (lines.length === 0) return `Order of ${formatDate(o.date)}`
  const areas = [...new Set(lines.map((l) => l.area))], cats = [...new Set(lines.map((l) => l.category))]
  const what = cats.length === 1 ? CATEGORY_TITLE[cats[0]] : 'materials'
  if (areas.length === 1) return `${areas[0]} ${what}`
  return `${what === 'materials' ? 'Materials' : what} · ${areas.length} areas`
}

/**
 * Deliveries recorded without an order. They are real receipts and count as delivered everywhere (Materials, Procurement, Area Overview), but they
 * belong to no order, so deleting or cancelling an order never touches them. Listed so they can be attached to the right order, or voided if they
 * were recorded by mistake. `areaIds`, when given, limits the list to deliveries that include one of those areas.
 */
export function unlinkedDeliveries(s: Pick<TrackerState, 'deliveries' | 'deliveryLines'>, areaIds?: Set<string>) {
  const out = (s.deliveries ?? []).filter((d) => !d.orderId).map((d) => ({ delivery: d, lines: (s.deliveryLines ?? []).filter((l) => l.deliveryId === d.id) }))
    .filter((x) => !areaIds || x.lines.some((l) => !l.areaId || areaIds.has(l.areaId)))
  return { deliveries: out.map((x) => x.delivery), count: out.length, items: sum(out.flatMap((x) => x.lines.map((l) => l.qty))) }
}
