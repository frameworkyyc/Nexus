import type { ISODate } from '@/lib/date'
import type { ParsedTracker } from './import'
import type { ImportMeta, TrackerLine, TrackerState } from './types'
import { emptyTracker } from './types'

export type Result = { state: TrackerState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: TrackerState) => Result

let seq = 0
const nextId = () => `rc-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())

const patchLine = (s: TrackerState, id: string, fn: (l: TrackerLine) => TrackerLine | string): Result => {
  const line = s.lines.find((l) => l.id === id)
  if (!line) return { error: 'That material line no longer exists.' }
  const next = fn(line)
  return typeof next === 'string' ? { error: next } : { state: { ...s, lines: s.lines.map((l) => (l.id === id ? next : l)) } }
}

/**
 * Imports (or re-imports) the workbook. Quantities, statuses and sources always come from the workbook; anything entered in
 * Nexus (receipts, ordered quantity, notes) is carried over by line identity. A line the new file no longer contains is kept,
 * marked as removed from source, when it holds Nexus entries — it is never dropped silently.
 */
export const importTracker = (parsed: ParsedTracker, meta: Omit<ImportMeta, 'counts'>): Reducer => (s) => {
  const prev = new Map(s.lines.map((l) => [l.id, l]))
  const lines = parsed.lines.map((l): TrackerLine => {
    const old = prev.get(l.id)
    return old ? { ...l, orderedQty: old.orderedQty, receipts: old.receipts, confirmedNoReceipts: old.confirmedNoReceipts, notes: old.notes } : l
  })
  const incoming = new Set(lines.map((l) => l.id))
  const kept = s.lines.filter((l) => !incoming.has(l.id) && (l.receipts.length || l.confirmedNoReceipts || l.orderedQty !== null || l.notes)).map((l) => ({ ...l, sourceRemoved: true }))
  const flagIds = new Set(parsed.flags.map((f) => f.id))
  return {
    state: {
      meta: { ...meta, counts: parsed.counts }, lines: [...lines, ...kept], summary: parsed.summary, anchorage: parsed.anchorage, flags: parsed.flags,
      acknowledged: Object.fromEntries(Object.entries(s.acknowledged).filter(([id]) => flagIds.has(id))),
    },
  }
}

export const clearTracker = (): Reducer => () => ({ state: emptyTracker() })

export const addReceipt = (lineId: string, input: { date: ISODate; qty: number; reference: string; note: string }, today: ISODate): Reducer => (s) =>
  patchLine(s, lineId, (l) => {
    if (!Number.isFinite(input.qty) || input.qty <= 0) return 'Quantity received must be greater than zero.'
    if (!Number.isInteger(input.qty)) return 'Quantity received must be a whole number.'
    if (!validDate(input.date)) return 'Enter a valid date.'
    if (input.date > today) return 'A receipt cannot be dated in the future.'
    return { ...l, receipts: [...l.receipts, { id: nextId(), date: input.date, qty: input.qty, reference: input.reference.trim(), note: input.note.trim() }], confirmedNoReceipts: false }
  })

export const removeReceipt = (lineId: string, receiptId: string): Reducer => (s) =>
  patchLine(s, lineId, (l) => (l.receipts.some((r) => r.id === receiptId) ? { ...l, receipts: l.receipts.filter((r) => r.id !== receiptId) } : 'Receipt not found.'))

/** Confirms that nothing has physically arrived, which makes "remaining" known (equal to the requirement). */
export const confirmNoReceipts = (lineId: string, confirmed: boolean): Reducer => (s) =>
  patchLine(s, lineId, (l) => (confirmed && l.receipts.length ? 'Remove the recorded receipts first.' : { ...l, confirmedNoReceipts: confirmed }))

export const setOrdered = (lineId: string, qty: number | null): Reducer => (s) =>
  patchLine(s, lineId, (l) => (qty !== null && (!Number.isInteger(qty) || qty < 0) ? 'Ordered quantity must be a whole number, zero or more.' : { ...l, orderedQty: qty }))

export const setNotes = (lineId: string, notes: string): Reducer => (s) => patchLine(s, lineId, (l) => ({ ...l, notes }))

export const acknowledgeFlag = (flagId: string, note: string, today: ISODate, on: boolean): Reducer => (s) => {
  if (!s.flags.some((f) => f.id === flagId)) return { error: 'Flag not found.' }
  const acknowledged = { ...s.acknowledged }
  if (on) acknowledged[flagId] = { date: today, note: note.trim() }
  else delete acknowledged[flagId]
  return { state: { ...s, acknowledged } }
}
