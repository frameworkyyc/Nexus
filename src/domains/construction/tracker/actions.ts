import type { ISODate } from '@/lib/date'
import { allLines, audited, type Ctx } from './audit'
import type { ParsedTracker } from './import'
import type { ImportMeta, TrackerLine, TrackerState } from './types'
import { clean, findDuplicate, key, validateMaterial, type MaterialInput } from './materialModel'
import { emptyTracker } from './types'

export type Result = { state: TrackerState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: TrackerState, ctx?: Ctx) => Result

let seq = 0
const nextId = () => `rc-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const manualId = () => `mm-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())
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

const NEXUS_SIDE = ['unit', 'supplier', 'poRef', 'expectedDate', 'archived'] as const
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

export const addReceipt = (lineId: string, input: { date: ISODate; qty: number; reference: string; note: string }, today: ISODate): Reducer => audited((s, ctx) =>
  patchLine(s, lineId, (l) => {
    if (!Number.isFinite(input.qty) || input.qty <= 0) return 'Quantity received must be greater than zero.'
    if (!Number.isInteger(input.qty)) return 'Quantity received must be a whole number.'
    if (!validDate(input.date)) return 'Enter a valid date.'
    if (input.date > today) return 'A receipt cannot be dated in the future.'
    return { ...l, receipts: [...l.receipts, { id: nextId(), date: input.date, qty: input.qty, reference: input.reference.trim(), note: input.note.trim(), by: ctx?.actor ?? '' }], confirmedNoReceipts: false }
  }))

export const removeReceipt = (lineId: string, receiptId: string): Reducer => audited((s) =>
  patchLine(s, lineId, (l) => (l.receipts.some((r) => r.id === receiptId) ? { ...l, receipts: l.receipts.filter((r) => r.id !== receiptId) } : 'Receipt not found.')))

/** Confirms that nothing has physically arrived, which makes "remaining" known (equal to the requirement). */
export const confirmNoReceipts = (lineId: string, confirmed: boolean): Reducer => audited((s) =>
  patchLine(s, lineId, (l) => (confirmed && l.receipts.length ? 'Remove the recorded receipts first.' : { ...l, confirmedNoReceipts: confirmed })))

export const setOrdered = (lineId: string, qty: number | null): Reducer => audited((s) =>
  patchLine(s, lineId, (l) => (qty !== null && !wholeNumber(qty) ? 'Ordered quantity must be a whole number, zero or more.' : { ...l, orderedQty: qty })))

export const setNotes = (lineId: string, notes: string): Reducer => audited((s) => patchLine(s, lineId, (l) => ({ ...l, notes })))

export const acknowledgeFlag = (flagId: string, note: string, today: ISODate, on: boolean): Reducer => (s) => {
  if (!s.flags.some((f) => f.id === flagId)) return { error: 'Flag not found.' }
  const acknowledged = { ...s.acknowledged }
  if (on) acknowledged[flagId] = { date: today, note: note.trim() }
  else delete acknowledged[flagId]
  return { state: { ...s, acknowledged } }
}

/* ── Materials entered in Nexus ────────────────────────────────────────── */

const fromInput = (m: MaterialInput, createdAt: string, createdBy: string): TrackerLine => ({
  id: manualId(), origin: 'manual', source: { sheet: 'Nexus', row: 0 }, area: clean(m.area), footingType: clean(m.location), anchorageType: clean(m.anchorageRef),
  footings: 0, plinths: 0, bolts: 0, component: clean(m.name), category: m.category, requiredQty: m.requiredQty,
  calc: { kind: 'entered', formula: null, expression: 'Entered in Nexus', recomputed: null }, sourceStatus: m.claimedStatus ?? '', sourceNotes: [],
  orderedQty: null, receipts: [], confirmedNoReceipts: false, notes: clean(m.notes),
  description: clean(m.description), specification: clean(m.specification), size: clean(m.size), unit: clean(m.unit) || 'ea', supplier: clean(m.supplier), poRef: clean(m.poRef),
  expectedDate: m.expectedDate || null, archived: false, createdAt, createdBy,
})

/**
 * Adds one or more materials (Quick Add enters a whole foundation in one go). All are validated first, so either every item is
 * saved or none is. Possible duplicates are refused unless `allowDuplicates` is set, so a repeated entry is a deliberate choice.
 */
export const addMaterials = (items: MaterialInput[], allowDuplicates = false): Reducer => audited((s, ctx) => {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Add at least one material.' }
  if (items.length > 200) return { error: 'Add 200 materials or fewer at a time.' }
  let next = s
  const seen = new Set<string>()
  const at = ctx?.now ?? new Date().toISOString()
  for (const [i, m] of items.entries()) {
    const where = items.length > 1 ? `Row ${i + 1}: ` : ''
    const bad = validateMaterial(m)
    if (bad) return { error: where + bad }
    const dup = findDuplicate(next, m)
    const k = key(clean(m.area), clean(m.location), clean(m.name), clean(m.specification), clean(m.size))
    if (!allowDuplicates && (dup || seen.has(k))) return { error: `${where}“${clean(m.name)}” already exists for ${clean(m.area)}${clean(m.location) ? ` · ${clean(m.location)}` : ''} with the same specification and size. Edit the existing record, or add it anyway.` }
    seen.add(k)
    next = { ...next, manual: [...(next.manual ?? []), fromInput(m, at, ctx?.actor ?? '')] }
  }
  return { state: next }
})

export type MaterialPatch = Partial<MaterialInput>
/** Fields a workbook line allows: its source facts (area, description, quantity) stay as imported. */
const WORKBOOK_EDITABLE: (keyof MaterialInput)[] = ['unit', 'supplier', 'poRef', 'expectedDate', 'notes']

function applyPatch(l: TrackerLine, p: MaterialPatch): TrackerLine | string {
  const manual = l.origin === 'manual'
  if (!manual) {
    const locked = Object.keys(p).filter((k) => !WORKBOOK_EDITABLE.includes(k as keyof MaterialInput))
    if (locked.length) return 'This line comes from the workbook. Its area, description and quantity stay as imported — change them in the workbook and re-import. Supplier, PO, expected date, unit and notes can be edited here.'
  }
  const bad = validateMaterial(p, true)
  if (bad) return bad
  let out = { ...l }
  if (p.area !== undefined) out.area = clean(p.area)
  if (p.location !== undefined) out.footingType = clean(p.location)
  if (p.anchorageRef !== undefined) out.anchorageType = clean(p.anchorageRef)
  if (p.category !== undefined) out.category = p.category
  if (p.name !== undefined) out.component = clean(p.name)
  if (p.description !== undefined) out.description = clean(p.description)
  if (p.specification !== undefined) out.specification = clean(p.specification)
  if (p.size !== undefined) out.size = clean(p.size)
  if (p.requiredQty !== undefined) out = { ...out, requiredQty: p.requiredQty }
  if (p.unit !== undefined) out.unit = clean(p.unit) || 'ea'
  if (p.supplier !== undefined) out.supplier = clean(p.supplier)
  if (p.poRef !== undefined) out.poRef = clean(p.poRef)
  if (p.expectedDate !== undefined) out.expectedDate = p.expectedDate || null
  if (p.claimedStatus !== undefined) out.sourceStatus = p.claimedStatus
  if (p.notes !== undefined) out.notes = p.notes.trim()
  return out
}

export const editMaterial = (id: string, patch: MaterialPatch): Reducer => audited((s) => {
  const r = patchLine(s, id, (l) => applyPatch(l, patch))
  if (r.error !== undefined) return r
  const m = (r.state.manual ?? []).find((l) => l.id === id)
  if (m && (m.requiredQty < 1)) return { error: 'Quantity required must be 1 or more.' }
  // Two materials may not end up identical.
  if (m) { const dup = allLines({ ...r.state, manual: r.state.manual.filter((l) => l.id !== id) }).find((l) => !l.archived && !m.archived && key(l.area, l.footingType, l.component, l.specification ?? '', l.size ?? '') === key(m.area, m.footingType, m.component, m.specification ?? '', m.size ?? '')); if (dup) return { error: `That would duplicate “${dup.component}” in ${dup.area}${dup.footingType ? ` · ${dup.footingType}` : ''}.` } }
  return r
})

/** One change applied to several materials (selected rows). Everything is checked first: all are changed or none. */
export const bulkEditMaterials = (ids: string[], patch: MaterialPatch): Reducer => audited((s) => {
  if (!Array.isArray(ids) || ids.length === 0) return { error: 'Select at least one material.' }
  if (ids.length > 500) return { error: 'Select 500 materials or fewer.' }
  if (Object.keys(patch).length === 0) return { error: 'Choose what to change.' }
  let next = s
  for (const id of new Set(ids)) {
    const r = patchLine(next, id, (l) => applyPatch(l, patch))
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
