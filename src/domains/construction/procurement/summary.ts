import { percentOf } from '@/lib/format'
import { availableToOrder, coveredQty, orderProgress, type ProcRow } from '../tracker/procurement'
import { areaKey } from './orderSelection'
import type { PurchaseOrder, TrackerState } from '../tracker/types'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = percentOf

/** What an order still owes, in one area when `area` is given (an order can span several areas), otherwise in total. */
export const dueOf = (s: TrackerState, orderId: string, area = ''): number => {
  const p = orderProgress(s, orderId)
  return area ? p.lines.filter((l) => areaKey(l.line) === area).reduce((a, l) => a + l.due, 0) : p.due
}

/** Whether an order has any line in the area (always true with no area). */
export const hasLineIn = (s: TrackerState, orderId: string, area = ''): boolean => !area || (s.orderLines ?? []).some((l) => l.orderId === orderId && areaKey(l) === area)

/** What an order counts as ordered (in one area if given): a live order counts all it was placed for; a cancelled one only what had arrived. Received or not, it stays counted. */
export const orderedIn = (s: TrackerState, orderId: string, area = ''): number =>
  orderProgress(s, orderId).lines.filter((l) => !area || areaKey(l.line) === area).reduce((a, l) => a + l.ordered, 0)

/** An order that is still owed material (in the area, if given) and whose expected delivery date has passed. Orders with no expected date are never overdue. */
export const isOverdue = (s: TrackerState, o: PurchaseOrder, today: string, area = '') => !o.cancelled && !!o.expectedDate && o.expectedDate < today && dueOf(s, o.id, area) > 0

export interface ProcurementSummary {
  required: number
  pending: number
  ordered: number
  delivered: number
  overdue: number
  overdueOrders: number
  percent: { pending: number | null; ordered: number | null; delivered: number | null; overdue: number | null }
}

/**
 * The four Procurement gauges, in pieces and as a share of everything required, from the same figures as the rest of Procurement:
 * pending = still available to order; ordered = everything covered by orders (cumulative: receiving a delivery never lowers it, a cancelled order keeps only what arrived,
 * and nothing is counted twice, so pending + ordered = required); delivered = received (never more than required);
 * overdue = still due on live orders whose expected date has passed.
 */
export function procurementSummary(rows: ProcRow[], s: TrackerState, orders: PurchaseOrder[], today: string, area = ''): ProcurementSummary {
  const live = rows.filter((r) => r.required > 0 && !r.orphan && (!area || areaKey(r) === area))
  const required = sum(live.map((r) => r.required))
  const pending = sum(live.map(availableToOrder))
  const ordered = sum(live.map((r) => Math.min(coveredQty(r), r.required)))
  const delivered = sum(live.map((r) => Math.min(r.received, r.required)))
  const late = orders.filter((o) => isOverdue(s, o, today, area))
  const overdue = sum(late.map((o) => dueOf(s, o.id, area)))
  return { required, pending, ordered, delivered, overdue, overdueOrders: late.length, percent: { pending: pct(pending, required), ordered: pct(ordered, required), delivered: pct(delivered, required), overdue: pct(overdue, required) } }
}
