import type { ISODate } from '@/lib/date'
import { audited, type Ctx } from './audit'
import { consolidate, type ConsolidationSource } from './consolidate'
import { keyAliases, orderTitle, procurementRows } from './procurement'
import type { AuditEntry, Allocation, Delivery, DeliveryLine, GroupRef, Installation, OrderLine, PurchaseOrder, TrackerState } from './types'
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
const ref = (g: GroupRef): GroupRef => ({ key: g.key, areaId: g.areaId, area: g.area, category: g.category, name: g.name, specification: g.specification, size: g.size, unit: g.unit, ...(g.designation ? { designation: g.designation } : {}) })
/** An order's name in messages: its PO number, or that it has none. */
const poName = (o: { number: string }) => (o.number ? `purchase order ${o.number}` : 'a purchase order with no PO number')
const alias = (s: TrackerState, c: ConsolidationSource | undefined) => { const a = c ? keyAliases(consolidate(s, c)) : new Map<string, string>(); return (k: string) => a.get(k) ?? k }
const label = (g: GroupRef) => `${g.area} · ${g.designation ? `${g.designation} ` : ''}${g.name}${g.specification ? ` ${g.specification}` : ''}${g.size ? ` ${g.size}` : ''}`

const source = (ctx?: Ctx) => ctx?.construction as ConsolidationSource | undefined
const note = (ctx: Ctx | undefined, action: AuditEntry['action'], labelText: string, summary: string, changes: AuditEntry['changes'] = []): AuditEntry =>
  ({ id: id('au-pr'), at: ctx?.now ?? new Date().toISOString(), by: ctx?.actor ?? '', action, materialId: '', label: labelText, summary, changes })
const withHistory = (s: TrackerState, e: AuditEntry): TrackerState => ({ ...s, history: [...(s.history ?? []), e] })

export interface OrderInput { name?: string; number: string; supplierId?: string | null; supplier?: string; date: ISODate; expectedDate?: string | null; notes?: string; lines: { key: string; qty: number }[] }

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
  if (number && (s.orders ?? []).some((o) => !o.cancelled && o.number.toLowerCase() === number.toLowerCase())) return { error: `Purchase order ${number} already exists. Add to that order instead, or use a different number.` }
  if (!validDate(input.date)) return { error: 'Enter a valid order date.' }
  if (input.date > today) return { error: 'An order cannot be dated in the future.' }
  if (input.expectedDate && !validDate(input.expectedDate)) return { error: 'Enter a valid expected delivery date.' }
  const supplier = input.supplierId ? (s.suppliers ?? []).find((x) => x.id === input.supplierId && !x.archived) : undefined
  if (input.supplierId && !supplier) return { error: 'That supplier is not available. Choose another.' }
  const name = supplier?.name ?? clip(input.supplier, 80)
  const r = resolveLines(s, ctx, input.lines, new Set())
  if ('error' in r) return r
  const order: PurchaseOrder = { id: id('po'), ...(clip(input.name, 80) ? { name: clip(input.name, 80) } : {}), number, supplierId: supplier?.id ?? null, supplier: name, date: input.date, expectedDate: input.expectedDate || null, notes: clip(input.notes, 500), createdAt: ctx?.now ?? new Date().toISOString(), createdBy: ctx?.actor ?? '' }
  const lines: OrderLine[] = r.ok.map(({ g, qty }) => ({ ...ref(g), id: id('pol'), orderId: order.id, qty }))
  const total = lines.reduce((a, l) => a + l.qty, 0)
  const areas = [...new Set(lines.map((l) => l.area))]
  return { state: withHistory({ ...s, orders: [...(s.orders ?? []), order], orderLines: [...(s.orderLines ?? []), ...lines] }, note(ctx, 'order', number || 'No PO number', `${number ? `Purchase order ${number}` : 'Purchase order (no PO number)'} placed${name ? ` with ${name}` : ''}: ${lines.length} material${lines.length === 1 ? '' : 's'}, ${fmt(total)} items (${areas.join(', ')})`)) }
})

export const addOrderLines = (orderId: string, lines: { key: string; qty: number }[]): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o || o.cancelled) return { error: 'That purchase order is not available.' }
  const r = resolveLines(s, ctx, lines, new Set((s.orderLines ?? []).filter((l) => l.orderId === orderId).map((l) => l.key)))
  if ('error' in r) return r
  const add: OrderLine[] = r.ok.map(({ g, qty }) => ({ ...ref(g), id: id('pol'), orderId, qty }))
  return { state: withHistory({ ...s, orderLines: [...(s.orderLines ?? []), ...add] }, note(ctx, 'order', o.number || 'No PO number', `Added to ${poName(o)}: ${add.map((l) => `${fmt(l.qty)} × ${label(l)}`).join('; ')}`)) }
})

/** Gives an order a custom name, renames it, or clears it (the order then shows its default name). Nothing else about the order changes. */
export const setPurchaseOrderName = (orderId: string, nameText: string): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o) return { error: 'That purchase order is not available.' }
  const name = clip(nameText, 80)
  if (name === (o.name ?? '')) return { state: s }
  const was = o.name || 'Default name', now = name || 'Default name'
  return { state: withHistory({ ...s, orders: (s.orders ?? []).map((x) => { if (x.id !== orderId) return x; const { name: _n, ...rest } = x; void _n; return name ? { ...rest, name } : rest }) }, note(ctx, 'order', o.number || o.name || 'Order', `Order name ${o.name ? 'changed' : 'added'}: ${was} → ${now}${o.number ? ` (${o.number})` : ''}`, [{ field: 'Order name', from: was, to: now }])) }
})

/** Adds, changes or clears who an order is placed with (a listed supplier or free text). The order's lines, deliveries and allocations are untouched. */
export const setPurchaseOrderSupplier = (orderId: string, supplierId: string | null, supplierName: string): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o) return { error: 'That purchase order is not available.' }
  const supplier = supplierId ? (s.suppliers ?? []).find((x) => x.id === supplierId && !x.archived) : undefined
  if (supplierId && !supplier) return { error: 'That supplier is not available. Choose another.' }
  const name = supplier?.name ?? clip(supplierName, 80)
  const id = supplier?.id ?? null
  if (name === o.supplier && id === (o.supplierId ?? null)) return { state: s }
  const was = o.supplier || 'Not Assigned', now = name || 'Not Assigned'
  return { state: withHistory({ ...s, orders: (s.orders ?? []).map((x) => (x.id === orderId ? { ...x, supplier: name, supplierId: id } : x)) }, note(ctx, 'order', o.number || 'No PO number', `Supplier ${o.supplier ? 'changed' : 'added'}${o.number ? ` on ${o.number}` : ''}: ${was} → ${now} (ordered ${o.date})`, [{ field: 'Supplier', from: was, to: now }])) }
})

/**
 * Adds, corrects or clears a purchase order's number after the fact. Nothing else about the order changes: its lines, deliveries, allocations and
 * status are untouched, and the previous number stays in the history.
 */
export const setPurchaseOrderNumber = (orderId: string, numberText: string): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o) return { error: 'That purchase order is not available.' }
  const number = clip(numberText, 40)
  if (number === o.number) return { state: s }
  if (number && (s.orders ?? []).some((x) => x.id !== orderId && !x.cancelled && x.number.toLowerCase() === number.toLowerCase())) return { error: `Purchase order ${number} already exists. Use a different number.` }
  const was = o.number || 'Not Assigned', now = number || 'Not Assigned'
  return { state: withHistory({ ...s, orders: (s.orders ?? []).map((x) => (x.id === orderId ? { ...x, number } : x)) }, note(ctx, 'order', number || 'No PO number', `PO number ${o.number ? 'changed' : 'added'}: ${was} → ${now} (${o.supplier}, ordered ${o.date})`, [{ field: 'PO number', from: was, to: now }])) }
})

export interface OrderEdit {
  name?: string
  number?: string
  supplierId?: string | null
  supplier?: string
  /** New quantity for existing order lines, by line id. Lines not listed keep theirs. */
  quantities?: { lineId: string; qty: number }[]
}

/** Quantities of a requirement as they would stand in `next`: used to refuse a change that leaves less ordered than has been allocated. */
function allocationConflict(next: TrackerState, c: ConsolidationSource | undefined, keys: string[]): string | null {
  if (!c) return null
  const rows = procurementRows(next, c)
  for (const key of keys) {
    const row = rows.find((r) => r.key === key)
    if (row && row.allocated > row.ordered) return `${label(row)}: ${fmt(row.allocated)} has been allocated to foundations, more than the ${fmt(row.ordered)} that would remain ordered. Reduce the allocation first.`
  }
  return null
}

/**
 * Edits an order in one step: its name, PO number and supplier, and the quantity of each material on it. A quantity can go up or down, but never
 * below what has been delivered against that line, and never to less than has been allocated; nothing else about the order changes. Every
 * change is appended to the history, and Materials and Procurement recalculate from the new quantities.
 */
export const editPurchaseOrder = (orderId: string, edit: OrderEdit): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o || o.cancelled) return { error: 'That purchase order is not available.' }
  const e = edit ?? {}
  let next: TrackerState = s
  const notes: AuditEntry[] = []
  // details
  const name = e.name === undefined ? (o.name ?? '') : clip(e.name, 80)
  const number = e.number === undefined ? o.number : clip(e.number, 40)
  if (number !== o.number && number && (s.orders ?? []).some((x) => x.id !== orderId && !x.cancelled && x.number.toLowerCase() === number.toLowerCase())) return { error: `Purchase order ${number} already exists. Use a different number.` }
  let supplier = o.supplier, supplierId = o.supplierId ?? null
  if (e.supplierId !== undefined || e.supplier !== undefined) {
    const listed = e.supplierId ? (s.suppliers ?? []).find((x) => x.id === e.supplierId && !x.archived) : undefined
    if (e.supplierId && !listed) return { error: 'That supplier is not available. Choose another.' }
    supplier = listed?.name ?? clip(e.supplier, 80); supplierId = listed?.id ?? null
  }
  const changes: AuditEntry['changes'] = []
  const show = (t: string) => t || 'Not Assigned'
  if (name !== (o.name ?? '')) changes.push({ field: 'Order name', from: o.name || 'Default name', to: name || 'Default name' })
  if (number !== o.number) changes.push({ field: 'PO number', from: show(o.number), to: show(number) })
  if (supplier !== o.supplier || supplierId !== (o.supplierId ?? null)) changes.push({ field: 'Supplier', from: show(o.supplier), to: show(supplier) })
  const title = orderTitle(s, o)
  if (changes.length > 0) {
    next = { ...next, orders: (next.orders ?? []).map((x) => { if (x.id !== orderId) return x; const { name: _n, ...rest } = x; void _n; return { ...rest, ...(name ? { name } : {}), number, supplier, supplierId } }) }
    notes.push(note(ctx, 'order', number || name || 'Order', `Order details changed on ${title}: ${changes.map((x) => `${x.field} ${x.from} → ${x.to}`).join('; ')}`, changes))
  }
  // quantities
  const lines = (s.orderLines ?? []).filter((l) => l.orderId === orderId)
  const wanted = new Map<string, number>()
  for (const q of e.quantities ?? []) {
    const line = lines.find((l) => l.id === q?.lineId)
    if (!line) return { error: 'One of the materials is no longer on this order. Reload and try again.' }
    if (wanted.has(line.id)) return { error: `${label(line)} is listed twice.` }
    if (!whole(q.qty)) return { error: `${label(line)}: enter a whole number of 1 or more.` }
    const delivered = (s.deliveryLines ?? []).filter((d) => d.orderLineId === line.id).reduce((a, d) => a + d.qty, 0)
    if (q.qty < delivered) return { error: `${label(line)}: ${fmt(delivered)} has already been delivered against this order, so it cannot be reduced below that.` }
    if (q.qty !== line.qty) wanted.set(line.id, q.qty)
  }
  if (wanted.size > 0) {
    const qtyChanges: AuditEntry['changes'] = lines.filter((l) => wanted.has(l.id)).map((l) => ({ field: label(l), from: String(l.qty), to: String(wanted.get(l.id)) }))
    next = { ...next, orderLines: (next.orderLines ?? []).map((l) => (wanted.has(l.id) ? { ...l, qty: wanted.get(l.id)! } : l)) }
    const conflict = allocationConflict(next, source(ctx), lines.filter((l) => wanted.has(l.id)).map((l) => alias(next, source(ctx))(l.key)))
    if (conflict) return { error: conflict }
    const total = (next.orderLines ?? []).filter((l) => l.orderId === orderId).reduce((a, l) => a + l.qty, 0)
    notes.push(note(ctx, 'order', number || name || 'Order', `Quantities changed on ${orderTitle(next, (next.orders ?? []).find((x) => x.id === orderId)!)}: ${qtyChanges.map((x) => `${x.field} ${x.from} → ${x.to}`).join('; ')} (order now ${fmt(total)} items)`, qtyChanges))
  }
  if (notes.length === 0) return { state: s }
  return { state: notes.reduce((st, n) => withHistory(st, n), next) }
})

/**
 * Deletes an order that nothing has been delivered against. The order and its lines leave the active calculations (so what is outstanding to order
 * and the Materials progress follow at once) and a full account of what was deleted is kept in the history. Refused, with the reason, when deliveries
 * were recorded against it or when removing it would leave less ordered than has been allocated.
 */
export const deletePurchaseOrder = (orderId: string): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o) return { error: 'That purchase order no longer exists.' }
  const title = orderTitle(s, o)
  if ((s.deliveries ?? []).some((d) => d.orderId === orderId)) return { error: `Deliveries have been recorded against ${title}, so it cannot be deleted. Void those deliveries first (they stay in the history) or leave the order in place.` }
  const lines = (s.orderLines ?? []).filter((l) => l.orderId === orderId)
  const next: TrackerState = { ...s, orders: (s.orders ?? []).filter((x) => x.id !== orderId), orderLines: (s.orderLines ?? []).filter((l) => l.orderId !== orderId) }
  const k = alias(s, source(ctx))
  const conflict = o.cancelled ? null : allocationConflict(next, source(ctx), lines.map((l) => k(l.key)))
  if (conflict) return { error: `${title} cannot be deleted. ${conflict}` }
  const total = lines.reduce((a, l) => a + l.qty, 0)
  const changes: AuditEntry['changes'] = lines.map((l) => ({ field: label(l), from: String(l.qty), to: 'deleted' }))
  const summary = `Order deleted: ${title}${o.number ? ` · PO ${o.number}` : ''}${o.supplier ? ` · ${o.supplier}` : ''} · ordered ${o.date}${o.cancelled ? ' · was cancelled' : ''} — ${lines.length} material${lines.length === 1 ? '' : 's'}, ${fmt(total)} items: ${lines.map((l) => `${fmt(l.qty)} × ${label(l)}`).join('; ')}`
  return { state: withHistory(next, note(ctx, 'order', o.number || o.name || 'Order', summary, changes)) }
})

/** Cancels an order that nothing has arrived against. The order and its lines stay on record. */
export const cancelPurchaseOrder = (orderId: string): Reducer => audited((s, ctx): Result => {
  const o = (s.orders ?? []).find((x) => x.id === orderId)
  if (!o || o.cancelled) return { error: 'That purchase order is not available.' }
  if ((s.deliveries ?? []).some((d) => d.orderId === orderId)) return { error: `Deliveries have been recorded against ${o.number || 'this order'}, so it cannot be cancelled.` }
  return { state: withHistory({ ...s, orders: (s.orders ?? []).map((x) => (x.id === orderId ? { ...x, cancelled: true } : x)) }, note(ctx, 'order', o.number || 'No PO number', `${o.number ? `Purchase order ${o.number}` : 'Purchase order with no PO number'} cancelled`)) }
})

export interface InstallationInput { key: string; qty: number; date: ISODate; note?: string }

/**
 * Records material installed against one requirement. Installation is its own record: it never changes what was received or allocated, and it can
 * only cover material that has arrived and is still required. The requirement is Installed only when the whole required quantity is.
 */
export const recordInstallation = (input: InstallationInput, today: ISODate): Reducer => audited((s, ctx): Result => {
  const c = source(ctx)
  if (!c) return { error: 'The project records are not available, so nothing can be recorded right now.' }
  const row = procurementRows(s, c).find((r) => r.key === input?.key)
  if (!row) return { error: 'That material is no longer listed. Reload and try again.' }
  if (!validDate(input.date)) return { error: 'Enter a valid installation date.' }
  if (input.date > today) return { error: 'An installation cannot be dated in the future.' }
  if (!whole(input.qty)) return { error: `${label(row)}: enter a whole number of 1 or more installed.` }
  if (row.required > 0 && row.installed >= row.required) return { error: `${label(row)}: all ${fmt(row.required)} are already installed.` }
  if (input.qty + row.installed > row.received) return { error: `Only ${fmt(Math.max(0, row.received - row.installed))} of ${label(row)} has been received and is not yet installed.` }
  if (input.qty + row.installed > row.required) return { error: `${label(row)}: ${fmt(row.installed)} of ${fmt(row.required)} is already installed, so at most ${fmt(Math.max(0, row.required - row.installed))} more can be recorded.` }
  const rec: Installation = { ...ref(row), id: id('in'), date: input.date, qty: input.qty, note: clip(input.note, 300), by: ctx?.actor ?? '', at: ctx?.now ?? new Date().toISOString() }
  const total = row.installed + input.qty
  return { state: withHistory({ ...s, installations: [...(s.installations ?? []), rec] }, note(ctx, 'installation', row.name, `Installed ${fmt(input.qty)} of ${label(row)} on ${input.date} — ${fmt(total)} of ${fmt(row.required)} installed${total >= row.required ? ' (complete)' : ''}`)) }
})

/** Voids an installation recorded in error. It stays in the history. */
export const voidInstallation = (installationId: string): Reducer => audited((s, ctx): Result => {
  const i = (s.installations ?? []).find((x) => x.id === installationId)
  if (!i) return { error: 'That installation no longer exists.' }
  return { state: withHistory({ ...s, installations: (s.installations ?? []).filter((x) => x.id !== installationId) }, note(ctx, 'installation', i.name, `Installation of ${fmt(i.qty)} dated ${i.date} voided (${label(i)})`)) }
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
  const k = alias(s, c)
  const seen = new Set<string>()
  const delivery: Delivery = { id: id('dl'), orderId: order?.id ?? null, date: input.date, reference: clip(input.reference, 60), note: clip(input.note, 500), by: ctx?.actor ?? '', at: ctx?.now ?? new Date().toISOString() }
  const lines: DeliveryLine[] = []
  for (const l of input.lines) {
    const ol = order ? orderLines.find((x) => k(x.key) === l?.key) : undefined
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
    note(ctx, 'delivery', order?.number || delivery.reference || 'Delivery', `Received ${fmt(total)} items in ${lines.length} line${lines.length === 1 ? '' : 's'} (${areas.join(', ')})${order ? ` against ${order.number || 'an order with no PO number'}` : ''} on ${input.date}${delivery.reference ? ` (${delivery.reference})` : ''}`)) }
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
    const used = procurementRows(next, c).find((r) => r.installed > r.received)
    if (used) return { error: `${label(used)}: ${fmt(used.installed)} has been installed, more than would remain received. Void the installation first.` }
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
  const k = alias(s, c)
  const mine = (s.allocations ?? []).filter((a) => k(a.key) === key)
  const at = ctx?.now ?? new Date().toISOString(), by = ctx?.actor ?? ''
  const nextRows: Allocation[] = []
  const changes: AuditEntry['changes'] = []
  for (const [f, q] of wanted) {
    const old = mine.find((a) => a.foundationId === f)
    const name = c.foundations.find((x) => x.id === f)?.number ?? f
    if (q === 0) { if (old) changes.push({ field: name, from: String(old.qty), to: '0' }); continue }
    if (old && old.qty === q) { nextRows.push({ ...old, key }); continue }
    changes.push({ field: name, from: String(old?.qty ?? 0), to: String(q) })
    nextRows.push({ id: old?.id ?? id('al'), key, foundationId: f, qty: q, by, at })
  }
  // Foundations the request does not mention keep what they had.
  for (const old of mine) if (!wanted.has(old.foundationId)) nextRows.push({ ...old, key })
  if (changes.length === 0) return { state: s }
  return { state: withHistory({ ...s, allocations: [...(s.allocations ?? []).filter((a) => k(a.key) !== key), ...nextRows] }, note(ctx, 'allocation', row.name, `Allocation of ${label(row)} updated: ${changes.map((x) => `${x.field} ${x.from} → ${x.to}`).join(', ')}`, changes)) }
})

