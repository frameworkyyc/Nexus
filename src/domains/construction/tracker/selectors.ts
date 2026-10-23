import type { Area } from '../types'
import type { ComponentCategory, TrackerLine, TrackerState } from './types'

export const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  bolt: 'Anchor bolts', nut: 'Nuts', washer: 'Washers', 'sole-plate': 'Sole plates', template: 'Plywood templates', 'embed-plate': 'Embed plates', other: 'Other',
}
export const CATEGORY_ORDER: ComponentCategory[] = ['bolt', 'nut', 'washer', 'sole-plate', 'template', 'embed-plate', 'other']

/* ── Receipts: only entries made in Nexus count as verified ─────────────── */

export const receivedOf = (l: TrackerLine) => l.receipts.reduce((s, r) => s + r.qty, 0)
/** A line is verified once a receipt is recorded, or someone has confirmed that nothing has arrived. */
export const isVerified = (l: TrackerLine) => l.receipts.length > 0 || l.confirmedNoReceipts
/** Remaining is only stated when receipts are verified; otherwise the answer is "unknown", not the full requirement. */
export const remainingOf = (l: TrackerLine): number | null => (isVerified(l) ? Math.max(0, l.requiredQty - receivedOf(l)) : null)

export type DeliveryState = 'received' | 'over-received' | 'partial' | 'none-received' | 'unverified-delivered' | 'unverified-pending'

export function deliveryState(l: TrackerLine): DeliveryState {
  if (isVerified(l)) {
    const got = receivedOf(l)
    return got === 0 ? 'none-received' : got > l.requiredQty ? 'over-received' : got === l.requiredQty ? 'received' : 'partial'
  }
  return /^delivered$/i.test(l.sourceStatus) ? 'unverified-delivered' : 'unverified-pending'
}

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  received: 'Received in full', 'over-received': 'Over-received', partial: 'Partially received', 'none-received': 'Nothing received',
  'unverified-delivered': 'Delivered per workbook, not verified', 'unverified-pending': 'Pending per workbook',
}

/* ── Filtering ─────────────────────────────────────────────────────────── */

export interface LineFilter { area?: string; search?: string; category?: ComponentCategory | ''; footingType?: string; anchorageType?: string; delivery?: DeliveryState | '' }

export function filterLines(lines: TrackerLine[], f: LineFilter): TrackerLine[] {
  const q = (f.search ?? '').trim().toLowerCase()
  return lines.filter((l) =>
    (!f.area || l.area === f.area) && (!f.category || l.category === f.category) && (!f.footingType || l.footingType === f.footingType) &&
    (!f.anchorageType || l.anchorageType === f.anchorageType) && (!f.delivery || deliveryState(l) === f.delivery) &&
    (!q || [l.component, l.footingType, l.anchorageType, l.area, l.notes, l.sourceStatus, ...l.sourceNotes].some((x) => x.toLowerCase().includes(q))))
}

export const distinct = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

/** Workbook areas are matched to REEF's construction areas by name, ignoring case and spacing. */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
export const areaIdFor = (areas: Area[], workbookArea: string) => areas.find((a) => norm(a.name) === norm(workbookArea))?.id ?? null
export const linesForArea = (state: TrackerState, areas: Area[], areaId: string) => state.lines.filter((l) => areaIdFor(areas, l.area) === areaId)

/* ── Area summary, built from the detailed requirements ────────────────── */

export interface SummaryGroup {
  area: string
  component: string // verbatim
  category: ComponentCategory
  required: number
  received: number // verified receipts only
  remaining: number | null // only when every line in the group is verified
  lines: number
  verifiedLines: number
  deliveredPerWorkbook: number
  pendingPerWorkbook: number
}

export function areaSummary(lines: TrackerLine[]): SummaryGroup[] {
  const groups = new Map<string, SummaryGroup>()
  for (const l of lines) {
    const k = `${l.area}|${l.component}`
    const g = groups.get(k) ?? { area: l.area, component: l.component, category: l.category, required: 0, received: 0, remaining: 0, lines: 0, verifiedLines: 0, deliveredPerWorkbook: 0, pendingPerWorkbook: 0 }
    g.required += l.requiredQty; g.received += receivedOf(l); g.lines++
    if (isVerified(l)) g.verifiedLines++
    if (/^delivered$/i.test(l.sourceStatus)) g.deliveredPerWorkbook++; else g.pendingPerWorkbook++
    groups.set(k, g)
  }
  return [...groups.values()].map((g) => ({ ...g, remaining: g.verifiedLines === g.lines ? Math.max(0, g.required - g.received) : null }))
}

/** The workbook's own summary (K:N) compared with totals rebuilt from the detailed rows. */
export function reconcileSummary(state: TrackerState) {
  const built = new Map(areaSummary(state.lines.filter((l) => !l.sourceRemoved)).map((g) => [`${g.area}|${g.component}`, g.required]))
  const mismatched = state.summary.filter((s) => built.get(`${s.area}|${s.item}`) !== s.totalQty)
  return { total: state.summary.length, matched: state.summary.length - mismatched.length, mismatched }
}

/* ── Progress ──────────────────────────────────────────────────────────── */

export interface MaterialsProgress {
  lines: number
  verifiedLines: number
  receivedInFull: number
  partial: number
  nothingReceived: number
  unverifiedDelivered: number
  unverifiedPending: number
  /** Verified received against required, averaged per line; null until at least one receipt is verified. */
  percent: number | null
}

export function materialsProgress(lines: TrackerLine[]): MaterialsProgress {
  const states = lines.map(deliveryState)
  const count = (s: DeliveryState) => states.filter((x) => x === s).length
  const usable = lines.filter((l) => l.requiredQty > 0)
  const verified = lines.filter(isVerified).length
  const percent = verified === 0 || usable.length === 0 ? null : Math.round((usable.reduce((s, l) => s + Math.min(1, receivedOf(l) / l.requiredQty), 0) / usable.length) * 100)
  return {
    lines: lines.length, verifiedLines: verified,
    receivedInFull: count('received') + count('over-received'), partial: count('partial'), nothingReceived: count('none-received'),
    unverifiedDelivered: count('unverified-delivered'), unverifiedPending: count('unverified-pending'), percent,
  }
}

export const unacknowledged = (state: TrackerState) => state.flags.filter((f) => f.severity === 'review' && !state.acknowledged[f.id])
