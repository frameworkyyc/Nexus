import type { ISODate } from '@/lib/date'
import { audited, type Ctx } from './audit'
import type { ParsedTracker } from './import'
import { scopedCalc, type RefSource } from './requirements'
import type { ComponentCategory, ImportMeta, QtyBasis, TrackerLine, TrackerState } from './types'
import { buildCatalog, displayOf, type CatalogSource } from './catalog'
import { clean, findDuplicate, keyOf, validateMaterial, type Env, type MaterialInput } from './materialModel'
import { cleanSupplierName, findSimilarSupplier, supplierId, type SupplierRecord } from './suppliers'
import { emptyTracker } from './types'

export type Result = { state: TrackerState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: TrackerState, ctx?: Ctx) => Result

let seq = 0
const nextId = () => `rc-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const manualId = () => `mm-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())
/** Records in other modules that material rules check against. Supplied by the server and the demo, never by a request. */
export interface RefCtx extends Ctx { construction?: CatalogSource }
const wholeNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

/** Finds a material among workbook lines and materials entered in Nexus, applies `fn`, and keeps each in its own list. */
const patchLine = (s: TrackerState, id: string, fn: (l: TrackerLine) => TrackerLine | string): Result => {
  const manual = (s.manual ?? []).some((l) => l.id === id)
  const line = (manual ? s.manual : s.lines).find((l) => l.id === id)
  if (!line) return { error: 'That material no longer exists.' }
  const next = fn(line)
  if (typeof next === 'string') return { error: next }
  return { state: manual ? { ...s, manual: s.manual.map((l) => (l.id === id ? next : l)) } : { ...s, lines: s.lines.map((l) => (l.id === id ? next : l)) } }
}

const NEXUS_SIDE = ['unit', 'supplier', 'supplierId', 'poRef', 'expectedDate', 'archived'] as const
const nexusSide = (l: TrackerLine) => Object.fromEntries(NEXUS_SIDE.filter((k) => l[k] !== undefined).map((k) => [k, l[k]]))

/**
 * Imports (or re-imports) the workbook. Quantities, statuses and sources always come from the workbook; anything entered in
 * Nexus (receipts, ordered quantity, notes, supplier, PO, archive state) is carried over by line identity and never overwritten.
 * A line the new file no longer contains is kept, marked as removed from source, when it holds Nexus entries — it is never
 * dropped silently. Materials entered in Nexus and the history are untouched.
 */
export const importTracker = (parsed: ParsedTracker, meta: Omit<ImportMeta, 'counts'>): Reducer => (s, ctx) => {
  const prev = new Map(s.lines.map((l) => [l.id, l]))
  const lines = parsed.lines.map((l): TrackerLine => {
    const old = prev.get(l.id)
    return old ? { ...l, ...nexusSide(old), orderedQty: old.orderedQty, receipts: old.receipts, confirmedNoReceipts: old.confirmedNoReceipts, notes: old.notes } : l
  })
  const incoming = new Set(lines.map((l) => l.id))
  const kept = s.lines.filter((l) => !incoming.has(l.id) && (l.receipts.length || l.confirmedNoReceipts || l.orderedQty !== null || l.notes || l.supplier || l.poRef || l.archived)).map((l) => ({ ...l, sourceRemoved: true }))
  const flagIds = new Set(parsed.flags.map((f) => f.id))
  const at = ctx?.now ?? new Date().toISOString()
  return {
    state: {
      ...s,
      meta: { ...meta, counts: parsed.counts }, lines: [...lines, ...kept], summary: parsed.summary, anchorage: parsed.anchorage, flags: parsed.flags,
      acknowledged: Object.fromEntries(Object.entries(s.acknowledged).filter(([id]) => flagIds.has(id))),
      history: [...(s.history ?? []), { id: `au-imp-${at}-${seq++}`, at, by: ctx?.actor ?? '', action: 'imported', materialId: '', label: meta.fileName, summary: `Imported ${meta.fileName}: ${parsed.lines.length} material lines`, changes: [] }],
    },
  }
}

/** Removes the imported workbook data. Materials entered in Nexus, and the history, are never removed by this. */
export const clearTracker = (): Reducer => (s) => ({ state: { ...emptyTracker(), manual: s.manual ?? [], history: s.history ?? [] } })

/** The old per-line receipt entry. Retired as a command (see `addReceipt`); kept only to build historical receipts in tests. */
export const legacyAddReceipt = (lineId: string, input: { date: ISODate; qty: number; reference: string; note: string }, today: ISODate): Reducer => audited((s, ctx) =>
  patchLine(s, lineId, (l) => {
    if (!Number.isFinite(input.qty) || input.qty <= 0) return 'Quantity received must be greater than zero.'
    if (!Number.isInteger(input.qty)) return 'Quantity received must be a whole number.'
    if (!validDate(input.date)) return 'Enter a valid date.'
    if (input.date > today) return 'A receipt cannot be dated in the future.'
    return { ...l, receipts: [...l.receipts, { id: nextId(), date: input.date, qty: input.qty, reference: input.reference.trim(), note: input.note.trim(), by: ctx?.actor ?? '', at: ctx?.now ?? new Date().toISOString() }], confirmedNoReceipts: false }
  }))

/**
 * Retired. New deliveries are recorded against a purchase order (`recordDelivery`), so received quantities always come from an order. Receipts
 * already recorded on a line stay, keep counting and can still be voided (`removeReceipt`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const addReceipt = (_lineId: string, _input: { date: ISODate; qty: number; reference: string; note: string }, _today: ISODate): Reducer => () => ({ error: 'Materials are received against a purchase order. Create an order in Procurement, then use Receive delivery.' })

export const removeReceipt = (lineId: string, receiptId: string): Reducer => audited((s) =>
  patchLine(s, lineId, (l) => (l.receipts.some((r) => r.id === receiptId) ? { ...l, receipts: l.receipts.filter((r) => r.id !== receiptId) } : 'Receipt not found.')))

/** Confirms that nothing has physically arrived, which makes "remaining" known (equal to the requirement). */
export const confirmNoReceipts = (lineId: string, confirmed: boolean): Reducer => audited((s) =>
  patchLine(s, lineId, (l) => (confirmed && l.receipts.length ? 'Remove the recorded receipts first.' : { ...l, confirmedNoReceipts: confirmed })))

/** The old per-line ordered quantity. Retired as a command (see `setOrdered`); kept only to build historical figures in tests. */
export const legacySetOrdered = (lineId: string, qty: number | null): Reducer => audited((s) =>
  patchLine(s, lineId, (l) => (qty !== null && !wholeNumber(qty) ? 'Ordered quantity must be a whole number, zero or more.' : { ...l, orderedQty: qty })))

/** Retired. A material becomes Ordered only when it is on a saved purchase order. Quantities already entered stay and keep counting. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setOrdered = (_lineId: string, _qty: number | null): Reducer => () => ({ error: 'Ordered quantities come from purchase orders. Create an order in Procurement.' })

export const setNotes = (lineId: string, notes: string): Reducer => audited((s) => patchLine(s, lineId, (l) => ({ ...l, notes })))

export const acknowledgeFlag = (flagId: string, note: string, today: ISODate, on: boolean): Reducer => (s) => {
  if (!s.flags.some((f) => f.id === flagId)) return { error: 'Flag not found.' }
  const acknowledged = { ...s.acknowledged }
  if (on) acknowledged[flagId] = { date: today, note: note.trim() }
  else delete acknowledged[flagId]
  return { state: { ...s, acknowledged } }
}

/* ── Materials entered in Nexus ────────────────────────────────────────── */

const envOf = (s: TrackerState, ctx?: Ctx): Env | null => {
  const c = (ctx as RefCtx | undefined)?.construction
  return c ? { catalog: buildCatalog(c, s), suppliers: s.suppliers ?? [], refs: c as RefSource } : null
}
const NO_REFS = 'Project areas and foundations could not be loaded, so nothing was saved.'

/** Fills the text snapshots (what was shown when saved) from the chosen records. They are legacy/display fallbacks; ids are the link. */
function snapshot(l: TrackerLine, env: Env): TrackerLine {
  const d = displayOf(l, env.catalog, env.suppliers)
  return { ...l, area: d.area, footingType: d.foundation, anchorageType: d.anchorage, supplier: d.supplier }
}

/** The total and its calculation for an entered quantity, or why it cannot be calculated. */
function totalOf(m: { basis?: QtyBasis; requiredQty: number; foundationId?: string | null; anchorageTypeId?: string | null }, env: Env) {
  const basis: QtyBasis = m.basis ?? 'fixed'
  if (basis === 'fixed') return { total: m.requiredQty, calc: { kind: 'entered' as const, formula: null, expression: 'Entered in Nexus', recomputed: null } }
  if (!env.refs) return { error: NO_REFS }
  return scopedCalc(env.refs, basis, m.requiredQty, m.foundationId, m.anchorageTypeId)
}

const fromInput = (m: MaterialInput, env: Env, createdAt: string, createdBy: string, total: { total: number; calc: TrackerLine['calc'] }): TrackerLine => snapshot({
  id: manualId(), origin: 'manual', source: { sheet: 'Nexus', row: 0 }, area: '', footingType: '', anchorageType: '', footings: 0, plinths: 0, bolts: 0,
  component: clean(m.name), category: m.category, requiredQty: total.total, ...(m.basis && m.basis !== 'fixed' ? { basis: m.basis } : {}), qtyEach: m.requiredQty,
  calc: total.calc, sourceStatus: m.claimedStatus ?? '', sourceNotes: [],
  orderedQty: null, receipts: [], confirmedNoReceipts: false, notes: clean(m.notes),
  description: clean(m.description), specification: clean(m.specification), size: clean(m.size), unit: clean(m.unit) || 'ea', poRef: clean(m.poRef),
  expectedDate: m.expectedDate || null, archived: false, createdAt, createdBy,
  areaId: m.areaId, foundationId: m.foundationId || null, anchorageTypeId: m.anchorageTypeId || null, supplierId: m.supplierId || null,
}, env)

/**
 * Adds one or more materials (Quick Add enters a whole foundation in one go). Every selection is checked against the project's own
 * records first, so either every item is saved or none is. Possible duplicates are refused unless `allowDuplicates` is set.
 */
export const addMaterials = (items: MaterialInput[], allowDuplicates = false): Reducer => audited((s, ctx) => {
  const env = envOf(s, ctx)
  if (!env) return { error: NO_REFS }
  if (!Array.isArray(items) || items.length === 0) return { error: 'Add at least one material.' }
  if (items.length > 200) return { error: 'Add 200 materials or fewer at a time.' }
  let next = s
  const seen = new Set<string>()
  const at = ctx?.now ?? new Date().toISOString()
  for (const [i, m] of items.entries()) {
    const where = items.length > 1 ? `Row ${i + 1}: ` : ''
    const bad = validateMaterial(m, env)
    if (bad) return { error: where + bad }
    const dup = findDuplicate(next, env, m)
    const k = keyOf(m)
    const named = env.catalog.areas.find((a) => a.id === m.areaId)?.name ?? ''
    if (!allowDuplicates && (dup || seen.has(k))) return { error: `${where}“${clean(m.name)}” already exists for ${named}${m.foundationId ? ` · ${env.catalog.foundations.find((f) => f.id === m.foundationId)?.number}` : ''} with the same specification and size. Edit the existing record, or add it anyway.` }
    seen.add(k)
    const total = totalOf(m, env)
    if ('error' in total) return { error: where + total.error }
    next = { ...next, manual: [...(next.manual ?? []), fromInput(m, env, at, ctx?.actor ?? '', total)] }
  }
  return { state: next }
})

export type MaterialPatch = Partial<MaterialInput>
/** Fields a workbook line allows: its source facts (area, foundation, description, quantity) stay as imported. */
const WORKBOOK_EDITABLE: (keyof MaterialInput)[] = ['unit', 'supplierId', 'poRef', 'expectedDate', 'notes']
/** Calculated requirements: only the procurement details can be edited here; what is required comes from the Anchorage Library and the foundations. */
const CALCULATED_MSG = 'This requirement is calculated from the Anchorage Library and the foundations. Change the anchorage configuration or the foundation to change it. Supplier, PO, expected date, unit and notes can be edited here.'

function applyPatch(l: TrackerLine, p: MaterialPatch, env: Env): TrackerLine | string {
  const manual = l.origin === 'manual'
  if (l.origin === 'anchorage' && Object.keys(p).some((k) => !WORKBOOK_EDITABLE.includes(k as keyof MaterialInput))) return CALCULATED_MSG
  if (!manual && l.origin !== 'anchorage') {
    const locked = Object.keys(p).filter((k) => !WORKBOOK_EDITABLE.includes(k as keyof MaterialInput))
    if (locked.length) return 'This line comes from the workbook. Its area, foundation, description and quantity stay as imported — change them in the workbook and re-import. Supplier, PO, expected date, unit and notes can be edited here.'
  }
  // Moving to another area needs a foundation that belongs to it: the old one must be replaced or cleared deliberately.
  if (p.areaId !== undefined && p.areaId !== l.areaId && p.foundationId === undefined && l.foundationId) {
    const f = env.catalog.foundations.find((x) => x.id === l.foundationId)
    if (f && f.areaId !== p.areaId) return 'The current foundation belongs to the previous area. Choose a foundation in the new area (or none) when changing the area.'
  }
  const bad = validateMaterial(p, env, l)
  if (bad) return bad
  let out: TrackerLine = { ...l }
  if (p.areaId !== undefined) out.areaId = p.areaId
  if (p.foundationId !== undefined) out.foundationId = p.foundationId || null
  if (p.anchorageTypeId !== undefined) out.anchorageTypeId = p.anchorageTypeId || null
  if (p.category !== undefined) out.category = p.category
  if (p.name !== undefined) out.component = clean(p.name)
  if (p.description !== undefined) out.description = clean(p.description)
  if (p.specification !== undefined) out.specification = clean(p.specification)
  if (p.size !== undefined) out.size = clean(p.size)
  if (p.basis !== undefined) out = { ...out, basis: p.basis === 'fixed' ? undefined : p.basis }
  if (p.requiredQty !== undefined) out = { ...out, qtyEach: p.requiredQty, requiredQty: p.requiredQty }
  if (manual && (p.basis !== undefined || p.requiredQty !== undefined || p.foundationId !== undefined || p.anchorageTypeId !== undefined)) {
    const t = totalOf({ basis: out.basis ?? 'fixed', requiredQty: out.qtyEach ?? out.requiredQty, foundationId: out.foundationId, anchorageTypeId: out.anchorageTypeId }, env)
    if ('error' in t) return t.error
    out = { ...out, requiredQty: t.total, calc: t.calc, qtyEach: out.qtyEach ?? out.requiredQty }
  }
  if (p.unit !== undefined) out.unit = clean(p.unit) || 'ea'
  if (p.supplierId !== undefined) out.supplierId = p.supplierId || null
  if (p.poRef !== undefined) out.poRef = clean(p.poRef)
  if (p.expectedDate !== undefined) out.expectedDate = p.expectedDate || null
  if (p.claimedStatus !== undefined) out.sourceStatus = p.claimedStatus
  if (p.notes !== undefined) out.notes = p.notes.trim()
  // Refresh the saved text only for the fields that were just chosen; untouched legacy text is left exactly as it was.
  const d = displayOf(out, env.catalog, env.suppliers)
  if (p.areaId !== undefined && manual) out.area = d.area
  if (p.foundationId !== undefined && manual) out.footingType = d.foundation
  if (p.anchorageTypeId !== undefined && manual) out.anchorageType = d.anchorage
  if (p.supplierId !== undefined) out.supplier = d.supplier
  return out
}

export const editMaterial = (id: string, patch: MaterialPatch): Reducer => audited((s, ctx) => {
  const env = envOf(s, ctx)
  if (!env) return { error: NO_REFS }
  const r = patchLine(s, id, (l) => applyPatch(l, patch, env))
  if (r.error !== undefined) return r
  const m = (r.state.manual ?? []).find((l) => l.id === id)
  // Two materials may not end up identical.
  if (m && !m.archived) {
    const d = displayOf(m, env.catalog, env.suppliers)
    const dup = findDuplicate(r.state, env, { areaId: m.areaId ?? '', foundationId: m.foundationId ?? '', name: m.component, specification: m.specification ?? '', size: m.size ?? '' }, id)
      ?? (!m.areaId ? [...r.state.lines, ...r.state.manual].find((l) => l.id !== id && !l.archived && l.area.toLowerCase() === d.area.toLowerCase() && l.footingType.toLowerCase() === d.foundation.toLowerCase() && l.component.toLowerCase() === m.component.toLowerCase() && (l.specification ?? '') === (m.specification ?? '') && (l.size ?? '') === (m.size ?? '')) : undefined)
    if (dup) return { error: `That would duplicate “${dup.component}”.` }
  }
  return r
})

/** One change applied to several materials (selected rows). Everything is checked first: all are changed or none. */
export const bulkEditMaterials = (ids: string[], patch: MaterialPatch): Reducer => audited((s, ctx) => {
  const env = envOf(s, ctx)
  if (!env) return { error: NO_REFS }
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'Select at least one material.' }
  if (ids.length > 500) return { error: 'Select 500 materials or fewer.' }
  if (Object.keys(patch).length === 0) return { error: 'Choose what to change.' }
  let next = s
  for (const id of new Set(ids)) {
    const r = patchLine(next, id, (l) => applyPatch(l, patch, env))
    if (r.error !== undefined) return r
    next = r.state
  }
  return { state: next }
})

/** Archiving hides a material from the working view; it keeps every receipt and its history. Reversible. */
export const archiveMaterials = (ids: string[], archived: boolean): Reducer => audited((s) => {
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'Select at least one material.' }
  let next = s
  for (const id of new Set(ids)) {
    const r = patchLine(next, id, (l) => ({ ...l, archived }))
    if (r.error !== undefined) return r
    next = r.state
  }
  return { state: next }
})

/* ── Supplier directory and preferred suppliers ─────────────────────────── */

let cfg = 0
const withConfigLog = (s: TrackerState, ctx: Ctx | undefined, label: string, summary: string): TrackerState => ({
  ...s, history: [...(s.history ?? []), { id: `au-cfg-${Date.now().toString(36)}${cfg++}${Math.random().toString(36).slice(2, 6)}`, at: ctx?.now ?? new Date().toISOString(), by: ctx?.actor ?? '', action: 'configured', materialId: '', label, summary, changes: [] }],
})

/** Adds a supplier to the directory. A name that matches an existing supplier (ignoring case, spacing, punctuation, "Inc."/"Ltd" and one-letter slips) is refused. */
export const addSupplier = (name: string): Reducer => (s, ctx) => {
  const n = cleanSupplierName(name)
  if (n.length < 2 || n.length > 80) return { error: 'Enter a supplier name of 2 to 80 characters.' }
  const similar = findSimilarSupplier(s.suppliers ?? [], n)
  if (similar) return { error: `“${n}” looks like the existing supplier “${similar.name}”${similar.archived ? ' (archived — restore it instead)' : ''}. Select that one.` }
  const rec: SupplierRecord = { id: supplierId(n), name: n, archived: false, createdAt: ctx?.now ?? new Date().toISOString(), createdBy: ctx?.actor ?? '' }
  return { state: withConfigLog({ ...s, suppliers: [...(s.suppliers ?? []), rec] }, ctx, n, `Supplier “${n}” added to the directory`) }
}

export const renameSupplier = (id: string, name: string): Reducer => (s, ctx) => {
  const rec = (s.suppliers ?? []).find((x) => x.id === id)
  if (!rec) return { error: 'Supplier not found.' }
  const n = cleanSupplierName(name)
  if (n.length < 2 || n.length > 80) return { error: 'Enter a supplier name of 2 to 80 characters.' }
  const similar = findSimilarSupplier(s.suppliers.filter((x) => x.id !== id), n)
  if (similar) return { error: `“${n}” looks like the existing supplier “${similar.name}”.` }
  return { state: withConfigLog({ ...s, suppliers: s.suppliers.map((x) => (x.id === id ? { ...x, name: n } : x)) }, ctx, n, `Supplier “${rec.name}” renamed to “${n}”`) }
}

export const archiveSupplier = (id: string, archived: boolean): Reducer => (s, ctx) => {
  const rec = (s.suppliers ?? []).find((x) => x.id === id)
  if (!rec) return { error: 'Supplier not found.' }
  if (archived && Object.values(s.preferredSuppliers ?? {}).includes(id)) return { error: `“${rec.name}” is a preferred supplier. Choose another preferred supplier for those categories first.` }
  return { state: withConfigLog({ ...s, suppliers: s.suppliers.map((x) => (x.id === id ? { ...x, archived } : x)) }, ctx, rec.name, `Supplier “${rec.name}” ${archived ? 'archived' : 'restored'}`) }
}

/** Sets (or clears, with null) the supplier suggested for a category. Suggestions only: no existing material is changed. */
export const setPreferredSupplier = (category: ComponentCategory, supplier: string | null): Reducer => (s, ctx) => {
  if (!['bolt', 'nut', 'washer', 'sole-plate', 'top-plate', 'template', 'embed-plate', 'other'].includes(category)) return { error: 'Unknown category.' }
  const rec = supplier ? (s.suppliers ?? []).find((x) => x.id === supplier) : null
  if (supplier && (!rec || rec.archived)) return { error: 'Choose a supplier from the directory.' }
  const prefs = { ...(s.preferredSuppliers ?? {}) }
  const before = prefs[category]
  if ((before ?? null) === supplier) return { state: s }
  if (supplier) prefs[category] = supplier; else delete prefs[category]
  return { state: withConfigLog({ ...s, preferredSuppliers: prefs }, ctx, category, `Preferred supplier for ${category}: ${rec ? rec.name : 'none'}`) }
}

export { createPurchaseOrder, setPurchaseOrderNumber, setPurchaseOrderSupplier, setPurchaseOrderName, editPurchaseOrder, deletePurchaseOrder, correctDelivery, addOrderLines, cancelPurchaseOrder, recordDelivery, historicalUnlinkedDelivery, voidDelivery, setAllocations, recordInstallation, voidInstallation } from './procurementActions'
