import type { ISODate } from '@/lib/date'
import { audited, type Ctx } from './audit'
import type { ConsolidationSource } from './consolidate'
import { procurementRows } from './procurement'
import type { AuditEntry, Allocation, Delivery, DeliveryLine, GroupRef, OrderLine, PurchaseOrder, TrackerState } from './types'
import type { Result, Reducer } from './actions'

/**
 * Purchase orders, deliveries and allocations. They are recorded against consolidated requirements (an area's total of one specification),
 * never against each foundation. Every change is appended to the material history; nothing recorded here is edited or overwritten later
 * (a cancelled order or a voided delivery stays in the history), and recalculating requirements never touches these records.
 */
let seq = 0
const id = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`
const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())
const whole = (n: unknown, min = 1, max = 1_000_000): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
const clip = (t: unknown, max: number) => String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const fmt = (n: number) => n.toLocaleString('en-CA')
const ref = (g: GroupRef): GroupRef => ({ key: g.key, areaId: g.areaId, area: g.area, category: g.category, name: g.name, specification: g.specification, size: g.size, unit: g.unit })
const label = (g: GroupRef) => `${g.area} · ${g.name}${g.specification ? ` ${g.specification}` : ''}${g.size ? ` ${g.size}` : ''}`

const source = (ctx?: Ctx) => ctx?.construction as ConsolidationSource | undefined
const note = (ctx: Ctx | undefined, action: AuditEntry['action'], labelText: string, summary: string, changes: AuditEntry['changes'] = []): AuditEntry =>
  ({ id: id('au-pr'), at: ctx?.now ?? new Date().toISOString(), by: ctx?.actor ?? '', action, materialId: '', label: labelText, summary, changes })
const withHistory = (s: TrackerState, e: AuditEntry): TrackerState => ({ ...s, history: [...(s.history ?? []), e] })

export interface OrderInput { number: string; supplierId?: string | null; supplier?: string; date: ISODate; expectedDate?: string | null; notes?: string; lines: { key: string; qty: number }[] }

/** Validates order lines against the consolidated requirements (the only things that can be ordered). */
function resolveLines(s: TrackerState, ctx: Ctx | undefined, lines: { key: string; qty: number }[], taken: Set<string>): { ok: { g: GroupRef; qty: number }[] } | { error: string } {
  const c = source(ctx)
  if (!c) return { error: 'The project records are not available, so nothing can be ordered right now.' }
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'Add at least one material to the order.' }
  const known = new Map(procurementRows(s, c).map((g) => [g.key, g]))
  const seen = new Set<string>()
  const ok: { g: GroupRef; qty: number }[] = []
  for (const l of lines) {
    const g = known.get(l?.key)
    if (!g) return { error: 'One of the materials is no longer required. Reload and try again.' }
    if (!whole(l.qty)) return { error: `${label(g)}: enter a whole number of 1 or more to order.` }
    if (seen.has(l.key) || taken.has(l.key)) return { error: `${label(g)} is already on this order.` }
    seen.add(l.key); ok.push({ g, qty: l.qty })
  }
  return { ok }
}

export const createPurchaseOrder = (input: OrderInput, today: ISODate): Reducer => audited((s, ctx): Result => {
  const number = clip(input?.number, 40)
  if (!number) return { error: 'Enter the purchase order number.' }
  if ((s.orders ?? []).some((o) => !o.cancelled && o.number.toLowerCase() === number.toLowerCase())) return { error: `Purchase order ${number} already exists. Add to that order instead, or use a different number.` }
  if (!validDate(input.date)) return { error: 'Enter a valid order date.' }
  if (input.date > today) return { error: 'An order cannot be dated in the future.' }
  if (input.expectedDate && !validDate(input.expectedDate)) return { error: 'Enter a valid expected delivery date.' }
  const supplier = input.supplierId ? (s.suppliers ?? []).find((x) => x.id === input.supplierId && !x.archived) : undefined
  if (input.supplierId && !supplier) return { error: 'That supplier is not available. Choose another.' }
  const name = supplier?.name ?? clip(input.supplier, 80)
  if (!name) return { error: 'Choose or enter the supplier.' }
  const r = resolveLines(s, ctx, input.lines, new Set())
  if ('error' in r) return r
  const order: PurchaseOrder = { id: id('po'), number, supplierId: supplier?.id ?? null, supplier: name, date: input.date, expectedDate: input.expectedDate || null, notes: clip(input.notes, 500), createdAt: ctx?.now ?? new Date().toISOString(), createdBy: ctx?.actor ?? '' }
  const lines: OrderLine[] = r.ok.map(({ g, qty }) => ({ ...ref(g), id: id('pol'), orderId: order.id, qty }))
  const total = lines.reduce((a, l) => a + l.qty, 0)
  const areas = [...new Set(lines.map((l) => l.area))]
  return { state: withHistory({ ...s, orders: [...(s.orders ?? []), order], orderLines: [...(s.orderLines ?? []), ...lines] }, note(ctx, 'order', number, `Purchase order ${number} placed with ${name}: ${lines.length} material${lines.length === 1 ? '' : 's'}, ${fmt(total)} items (${areas.join(', ')})`)) }
})

export const addOrderLines = (orderId: string, lines: { key: string; qty: number }[]): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o || o.cancelled) return { error: 'That purchase order is not available.' }
  const r = resolveLines(s, ctx, lines, new Set((s.orderLines ?? []).filter((l) => l.orderId === orderId).map((l) => l.key)))
  if ('error' in r) return r
  const add: OrderLine[] = r.ok.map(({ g, qty }) => ({ ...ref(g), id: id('pol'), orderId, qty }))
  return { state: withHistory({ ...s, orderLines: [...(s.orderLines ?? []), ...add] }, note(ctx, 'order', o.number, `Added to purchase order ${o.number}: ${add.map((l) => `${fmt(l.qty)} × ${label(l)}`).join('; ')}`)) }
})

/** Cancels an order that nothing has arrived against. The order and its lines stay on record. */
export const cancelPurchaseOrder = (orderId: string): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o || o.cancelled) return { error: 'That purchase order is not available.' }
  if ((s.deliveries ?? []).some((d) => d.orderId === orderId)) return { error: `Deliveries have been recorded against ${o.number}, so it cannot be cancelled.` }
  return { state: withHistory({ ...s, orders: (s.orders ?? []).map((x) => (x.id === orderId ? { ...x, cancelled: true } : x)) }, note(ctx, 'order', o.number, `Purchase order ${o.number} cancelled`)) }
})

export interface DeliveryInput { orderId?: string | null; date: ISODate; reference?: string; note?: string; lines: { key: string; qty: number }[] }

/** Records one shipment: any number of materials, in any number of areas, confirmed once, with who confirmed it and when. */
export const recordDelivery = (input: DeliveryInput, today: ISODate): Reducer => audited((s, ctx): Result => {
  const c = source(ctx)
  if (!c) return { error: 'The project records are not available, so nothing can be received right now.' }
  if (!validDate(input?.date)) return { error: 'Enter a valid delivery date.' }
  if (input.date > today) return { error: 'A delivery cannot be dated in the future.' }
  if (!Array.isArray(input.lines) || input.lines.length === 0) return { error: 'Enter the quantity received for at least one material.' }
  const order = input.orderId ? (s.orders ?? []).find((o) => o.id === input.orderId) : null
  if (input.orderId && (!order || order.cancelled)) return { error: 'That purchase order is not available.' }
  const known = new Map(procurementRows(s, c).map((g) => [g.key, g]))
  const orderLines = (s.orderLines ?? []).filter((l) => l.orderId === input.orderId)
  const seen = new Set<string>()
  const delivery: Delivery = { id: id('dl'), orderId: order?.id ?? null, date: input.date, reference: clip(input.reference, 60), note: clip(input.note, 500), by: ctx?.actor ?? '', at: ctx?.now ?? new Date().toISOString() }
  const lines: DeliveryLine[] = []
  for (const l of input.lines) {
    const ol = order ? orderLines.find((x) => x.key === l?.key) : undefined
    const g = known.get(l?.key)
    if (order && !ol) return { error: 'One of those materials is not on the purchase order.' }
    if (!g) return { error: 'One of the materials is no longer listed. Reload and try again.' }
    if (!whole(l.qty)) return { error: `${label(g)}: enter a whole number of 1 or more received.` }
    if (seen.has(l.key)) return { error: `${label(g)} is listed twice.` }
    seen.add(l.key)
    lines.push({ ...ref(g), id: id('dll'), deliveryId: delivery.id, orderLineId: ol?.id ?? null, qty: l.qty })
  }
  const total = lines.reduce((a, l) => a + l.qty, 0)
  const areas = [...new Set(lines.map((l) => l.area))]
  return { state: withHistory({ ...s, deliveries: [...(s.deliveries ?? []), delivery], deliveryLines: [...(s.deliveryLines ?? []), ...lines] },
    note(ctx, 'delivery', order?.number ?? (delivery.reference || 'Delivery'), `Received ${fmt(total)} items in ${lines.length} line${lines.length === 1 ? '' : 's'} (${areas.join(', ')})${order ? ` against ${order.number}` : ''} on ${input.date}${delivery.reference ? ` (${delivery.reference})` : ''}`)) }
})

/** Voids a delivery recorded in error. Refused if the material it brought has already been allocated. */
export const voidDelivery = (deliveryId: string): Reducer => audited((s, ctx): Result => {
  const d = (s.deliveries ?? []).find((x) => x.id === deliveryId)
  if (!d) return { error: 'That delivery no longer exists.' }
  const c = source(ctx)
  const next: TrackerState = { ...s, deliveries: (s.deliveries ?? []).filter((x) => x.id !== deliveryId), deliveryLines: (s.deliveryLines ?? []).filter((l) => l.deliveryId !== deliveryId) }
  if (c) {
    const bad = procurementRows(next, c).find((r) => r.allocated > r.received)
    if (bad) return { error: `${label(bad)}: ${fmt(bad.allocated)} has been allocated to foundations, more than would remain received. Reduce the allocation first.` }
  }
  const total = (s.deliveryLines ?? []).filter((l) => l.deliveryId === deliveryId).reduce((a, l) => a + l.qty, 0)
  return { state: withHistory(next, note(ctx, 'delivery', d.reference || 'Delivery', `Delivery of ${fmt(total)} items dated ${d.date} voided`)) }
})

/** Sets what part of the material received for one requirement is set aside for each foundation. Receiving is never changed by this. */
export const setAllocations = (key: string, items: { foundationId: string; qty: number }[]): Reducer => audited((s, ctx): Result => {
  const c = source(ctx)
  if (!c) return { error: 'The project records are not available, so nothing can be allocated right now.' }
  const row = procurementRows(s, c).find((r) => r.key === key)
  if (!row) return { error: 'That material is no longer listed. Reload and try again.' }
  if (!Array.isArray(items)) return { error: 'Nothing to allocate.' }
  const need = new Map<string, number>()
  for (const x of row.contributions) if (x.foundationId) need.set(x.foundationId, (need.get(x.foundationId) ?? 0) + x.qty)
  const legacy = new Map<string, number>()
  for (const l of row.lines) if (l.foundationId) legacy.set(l.foundationId, (legacy.get(l.foundationId) ?? 0) + l.receipts.reduce((a, r) => a + r.qty, 0))
  const wanted = new Map<string, number>()
  for (const it of items) {
    if (!whole(it?.qty, 0)) return { error: 'Enter whole numbers to allocate.' }
    if (!need.has(it.foundationId)) return { error: 'That foundation does not use this material.' }
    if (wanted.has(it.foundationId)) return { error: 'A foundation is listed twice.' }
    wanted.set(it.foundationId, it.qty)
  }
  for (const [f, q] of wanted) {
    const name = c.foundations.find((x) => x.id === f)?.number ?? f
    if (q + (legacy.get(f) ?? 0) > (need.get(f) ?? 0)) return { error: `${name} needs ${fmt(need.get(f) ?? 0)}; it cannot be allocated more than that.` }
  }
  const total = [...wanted.values()].reduce((a, b) => a + b, 0)
  if (total + row.allocatedOnLines > row.received) return { error: `Only ${fmt(Math.max(0, row.received - row.allocatedOnLines))} of ${label(row)} has been received to allocate.` }
  const mine = (s.allocations ?? []).filter((a) => a.key === key)
  const at = ctx?.now ?? new Date().toISOString(), by = ctx?.actor ?? ''
  const nextRows: Allocation[] = []
  const changes: AuditEntry['changes'] = []
  for (const [f, q] of wanted) {
    const old = mine.find((a) => a.foundationId === f)
    const name = c.foundations.find((x) => x.id === f)?.number ?? f
    if (q === 0) { if (old) changes.push({ field: name, from: String(old.qty), to: '0' }); continue }
    if (old && old.qty === q) { nextRows.push(old); continue }
    changes.push({ field: name, from: String(old?.qty ?? 0), to: String(q) })
    nextRows.push({ id: old?.id ?? id('al'), key, foundationId: f, qty: q, by, at })
  }
  // Foundations the request does not mention keep what they had.
  for (const old of mine) if (!wanted.has(old.foundationId)) nextRows.push(old)
  if (changes.length === 0) return { state: s }
  return { state: withHistory({ ...s, allocations: [...(s.allocations ?? []).filter((a) => a.key !== key), ...nextRows] }, note(ctx, 'allocation', row.name, `Allocation of ${label(row)} updated: ${changes.map((x) => `${x.field} ${x.from} → ${x.to}`).join(', ')}`, changes)) }
})

