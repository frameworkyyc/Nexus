import { availableToOrder, orderProgress, type ProcRow } from '../tracker/procurement'
import type { PurchaseOrder, TrackerState } from '../tracker/types'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null)

/** An order that is still owed material and whose expected delivery date has passed. Orders with no expected date are never overdue. */
export const isOverdue = (s: TrackerState, o: PurchaseOrder, today: string) => !o.cancelled && !!o.expectedDate && o.expectedDate < today && orderProgress(s, o.id).due > 0

export interface ProcurementSummary {
  required: number
  pending: number
  awaiting: number
  delivered: number
  overdue: number
  overdueOrders: number
  percent: { pending: number | null; awaiting: number | null; delivered: number | null; overdue: number | null }
}

/**
 * The four Procurement gauges, in pieces and as a share of everything required, from the same figures as the rest of Procurement:
 * pending = still available to order; awaiting = ordered and not yet received; delivered = received (never more than required);
 * overdue = still due on live orders whose expected date has passed.
 */
export function procurementSummary(rows: ProcRow[], s: TrackerState, orders: PurchaseOrder[], today: string): ProcurementSummary {
  const live = rows.filter((r) => r.required > 0 && !r.orphan)
  const required = sum(live.map((r) => r.required))
  const pending = sum(live.map(availableToOrder))
  const awaiting = sum(live.map((r) => Math.max(0, Math.min(r.ordered, r.required) - Math.min(r.received, r.required))))
  const delivered = sum(live.map((r) => Math.min(r.received, r.required)))
  const late = orders.filter((o) => isOverdue(s, o, today))
  const overdue = sum(late.map((o) => orderProgress(s, o.id).due))
  return { required, pending, awaiting, delivered, overdue, overdueOrders: late.length, percent: { pending: pct(pending, required), awaiting: pct(awaiting, required), delivered: pct(delivered, required), overdue: pct(overdue, required) } }
}
