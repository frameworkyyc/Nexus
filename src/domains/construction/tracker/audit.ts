import { refreshRequirements, type RefSource } from './requirements'
import type { AuditAction, AuditEntry, TrackerLine, TrackerState } from './types'

export interface Ctx {
  /** Verified identity, supplied by the server only. Browser-only demo runs have none. */
  actor?: string
  now?: string
  /** Records from other modules (supplied by the server or the demo, never by a request). */
  [ref: string]: unknown
}

export const allLines = (s: TrackerState): TrackerLine[] => [...s.lines, ...(s.manual ?? [])]

const received = (l: TrackerLine) => l.receipts.reduce((a, r) => a + r.qty, 0)
const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
/** Fields whose change is recorded, with how they read in the history. */
const TRACKED: [keyof TrackerLine, string][] = [
  ['area', 'Area'], ['footingType', 'Foundation / location'], ['anchorageType', 'Anchorage ref.'], ['category', 'Category'], ['component', 'Name'], ['description', 'Description'],
  ['specification', 'Specification'], ['size', 'Size'], ['unit', 'Unit'], ['supplier', 'Supplier'], ['poRef', 'PO / reference'], ['expectedDate', 'Expected delivery'],
  ['orderedQty', 'Ordered qty'], ['notes', 'Notes'],
]

let seq = 0
const entryId = () => `au-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`

/**
 * The history entries a change produced, worked out by comparing the records before and after it. Deriving them from the
 * result (not from what the caller says it did) means the history cannot disagree with the data.
 */
export function auditChange(before: TrackerState, after: TrackerState, ctx: Ctx | undefined, at: string): AuditEntry[] {
  const out: AuditEntry[] = []
  const prev = new Map(allLines(before).map((l) => [l.id, l]))
  const by = ctx?.actor ?? ''
  const add = (action: AuditAction, l: TrackerLine, summary: string, changes: AuditEntry['changes'] = []) =>
    out.push({ id: entryId(), at, by, action, materialId: l.id, label: l.component, summary, changes })
  for (const l of allLines(after)) {
    const old = prev.get(l.id)
    if (!old) { if (l.origin === 'manual') add('created', l, `Added ${l.requiredQty.toLocaleString('en-CA')} ${l.unit || 'ea'} to ${l.area}${l.footingType ? ` · ${l.footingType}` : ''}`); continue }
    if (old === l) continue
    if (!!old.archived !== !!l.archived) add(l.archived ? 'archived' : 'restored', l, l.archived ? 'Archived' : 'Restored from archive')
    if (old.requiredQty !== l.requiredQty) add('quantity', l, `Required quantity ${old.requiredQty} → ${l.requiredQty}`, [{ field: 'Required', from: text(old.requiredQty), to: text(l.requiredQty) }])
    const oldIds = new Set(old.receipts.map((r) => r.id)), newIds = new Set(l.receipts.map((r) => r.id))
    for (const r of l.receipts) if (!oldIds.has(r.id)) add('receipt', l, `Received ${r.qty} on ${r.date}${r.reference ? ` (${r.reference})` : ''} — total ${received(l)} of ${l.requiredQty}`, [{ field: 'Received (verified)', from: text(received(old)), to: text(received(l)) }])
    for (const r of old.receipts) if (!newIds.has(r.id)) add('receipt-removed', l, `Receipt of ${r.qty} dated ${r.date} voided — total ${received(l)} of ${l.requiredQty}`, [{ field: 'Received (verified)', from: text(received(old)), to: text(received(l)) }])
    if (old.sourceStatus !== l.sourceStatus || old.confirmedNoReceipts !== l.confirmedNoReceipts) {
      add('status', l, old.confirmedNoReceipts !== l.confirmedNoReceipts ? (l.confirmedNoReceipts ? 'Confirmed nothing received' : 'Cleared “nothing received” confirmation') : `Status ${text(old.sourceStatus)} → ${text(l.sourceStatus)}`,
        old.sourceStatus !== l.sourceStatus ? [{ field: 'Status', from: text(old.sourceStatus), to: text(l.sourceStatus) }] : [])
    }
    const changes = TRACKED.filter(([k]) => (old[k] ?? '') !== (l[k] ?? '')).map(([k, label]) => ({ field: label, from: text(old[k]), to: text(l[k]) }))
    if (changes.length) add(changes.length === 1 && changes[0].field === 'Notes' ? 'note' : 'edited', l, `Changed ${changes.map((c) => c.field).join(', ')}`, changes)
  }
  return out
}

/**
 * Runs a reducer and appends the history of what it changed. History only ever grows. Before the reducer runs, calculated requirements and
 * per-anchorage / per-plinth / per-footing quantities are brought up to date with the foundations and the Anchorage Library (recorded in the
 * history as system changes), so a change to an order or delivery always lands on a current record and is never mistaken for that recalculation.
 */
export function audited<R extends (s: TrackerState, ctx?: Ctx) => { state: TrackerState; error?: undefined } | { error: string; state?: undefined }>(reducer: R) {
  return ((s: TrackerState, ctx?: Ctx) => {
    const at = ctx?.now ?? new Date().toISOString()
    const base = refreshRequirements(s, ctx?.construction as RefSource | undefined, { log: true, at })
    const r = reducer(base, ctx)
    if (r.error !== undefined) return r
    const entries = auditChange(base, r.state, ctx, at)
    return entries.length ? { state: { ...r.state, history: [...(r.state.history ?? base.history ?? []), ...entries] } } : r
  }) as R
}
