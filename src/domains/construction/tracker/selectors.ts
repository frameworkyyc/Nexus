import type { Area } from '../types'
import { allLines } from './audit'
import type { ComponentCategory, TrackerLine, TrackerState } from './types'

export { allLines }
/** Everything not archived: the working view. Archived materials keep their receipts and history but leave totals and lists. */
export const activeLines = (s: TrackerState) => allLines(s).filter((l) => !l.archived)

export const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  bolt: 'Anchor bolts', nut: 'Nuts', washer: 'Washers', 'sole-plate': 'Sole plates', 'top-plate': 'Top plates', template: 'Plywood templates', 'embed-plate': 'Embed plates', other: 'Other',
}
export const CATEGORY_ORDER: ComponentCategory[] = ['bolt', 'nut', 'washer', 'sole-plate', 'top-plate', 'template', 'embed-plate', 'other']

/* ── Delivery: a delivery is a confirmed receipt ────────────────────────── */
// Delivered means the material was physically received, checked and confirmed. Confirming a delivery records a receipt (how much, when it
// arrived, who confirmed it and when), so there is no separate verification step afterwards. Partial deliveries are simply smaller receipts.

export const receivedOf = (l: TrackerLine) => l.receipts.reduce((s, r) => s + r.qty, 0)
/** Still to be delivered: required minus everything confirmed so far, never below zero. */
export const remainingOf = (l: TrackerLine): number => Math.max(0, l.requiredQty - receivedOf(l))

export type DeliveryState = 'received' | 'over-received' | 'partial' | 'none-received'

/** The one definition of a delivery state, from quantities: nothing received, some, all, or more than required. */
export const deliveryStateFor = (required: number, received: number): DeliveryState =>
  received === 0 ? 'none-received' : received > required ? 'over-received' : received === required ? 'received' : 'partial'

/** A single line's own receipts only. Material shown anywhere else uses the unified model (tracker/model.ts), which also counts delivery records. */
export function deliveryState(l: TrackerLine): DeliveryState {
  return deliveryStateFor(l.requiredQty, receivedOf(l))
}

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  received: 'Delivered', 'over-received': 'Over-delivered', partial: 'Partially delivered', 'none-received': 'Not delivered',
}

export const deliveryLabelOf = (l: TrackerLine): string => DELIVERY_LABEL[deliveryState(l)]

/* ── Filtering ─────────────────────────────────────────────────────────── */

export interface LineFilter { area?: string; search?: string; category?: ComponentCategory | ''; footingType?: string; anchorageType?: string; delivery?: DeliveryState | ''; supplier?: string; specification?: string; archived?: 'active' | 'archived' | 'all' }

export function filterLines(lines: TrackerLine[], f: LineFilter, stateOf: (l: TrackerLine) => DeliveryState = deliveryState): TrackerLine[] {
  const q = (f.search ?? '').trim().toLowerCase()
  const view = f.archived ?? 'active'
  return lines.filter((l) =>
    (view === 'all' || (view === 'archived') === !!l.archived) && (!f.supplier || (l.supplier ?? '') === f.supplier) && (!f.specification || (l.specification ?? '') === f.specification) &&
    (!f.area || l.area === f.area) && (!f.category || l.category === f.category) && (!f.footingType || l.footingType === f.footingType) &&
    (!f.anchorageType || l.anchorageType === f.anchorageType) && (!f.delivery || stateOf(l) === f.delivery) &&
    (!q || [l.component, l.footingType, l.anchorageType, l.area, l.notes, l.sourceStatus, l.description ?? '', l.specification ?? '', l.size ?? '', l.supplier ?? '', l.poRef ?? '', ...l.sourceNotes].some((x) => x.toLowerCase().includes(q))))
}

export const distinct = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

/** Workbook areas are matched to REEF's construction areas by name, ignoring case and spacing. */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
export const areaIdFor = (areas: Area[], workbookArea: string) => areas.find((a) => norm(a.name) === norm(workbookArea))?.id ?? null
export const linesForArea = (state: TrackerState, areas: Area[], areaId: string) => allLines(state).filter((l) => areaIdFor(areas, l.area) === areaId)

/* ── Area summary, built from the detailed requirements ────────────────── */

export interface SummaryGroup {
  area: string
  component: string // verbatim
  category: ComponentCategory
  required: number
  received: number // confirmed deliveries
  remaining: number
  lines: number
  deliveredPerWorkbook: number
  pendingPerWorkbook: number
}

export function areaSummary(lines: TrackerLine[]): SummaryGroup[] {
  const groups = new Map<string, SummaryGroup>()
  for (const l of lines) {
    const k = `${l.area}|${l.component}`
    const g = groups.get(k) ?? { area: l.area, component: l.component, category: l.category, required: 0, received: 0, remaining: 0, lines: 0, deliveredPerWorkbook: 0, pendingPerWorkbook: 0 }
    g.required += l.requiredQty; g.received += receivedOf(l); g.lines++
    if (/^delivered$/i.test(l.sourceStatus)) g.deliveredPerWorkbook++; else g.pendingPerWorkbook++
    groups.set(k, g)
  }
  return [...groups.values()].map((g) => ({ ...g, remaining: Math.max(0, g.required - g.received) }))
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
  /** Lines delivered in full (or over-delivered), partly delivered, and not yet delivered. */
  receivedInFull: number
  partial: number
  nothingReceived: number
  /** Delivered against required, averaged per line; null when there is nothing to measure. */
  percent: number | null
}

export function materialsProgress(lines: TrackerLine[]): MaterialsProgress {
  const states = lines.map(deliveryState)
  const count = (s: DeliveryState) => states.filter((x) => x === s).length
  const usable = lines.filter((l) => l.requiredQty > 0)
  const percent = usable.length === 0 ? null : Math.round((usable.reduce((s, l) => s + Math.min(1, receivedOf(l) / l.requiredQty), 0) / usable.length) * 100)
  return {
    lines: lines.length,
    receivedInFull: count('received') + count('over-received'), partial: count('partial'), nothingReceived: count('none-received'), percent,
  }
}

/** Required − total delivered, never below zero. */
export const outstandingOf = remainingOf

/* ── Sorting and grouping for the management table ─────────────────────── */

export type SortKey = 'area' | 'location' | 'name' | 'category' | 'required' | 'received' | 'outstanding' | 'status' | 'supplier' | 'expected'
const DELIVERY_RANK: Record<DeliveryState, number> = { 'none-received': 0, partial: 1, received: 2, 'over-received': 3 }
const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

/** What a list shows for a line's delivery: by default its own receipts; the materials manager passes the unified model's figures instead. */
export interface LineView { received: number; outstanding: number; state: DeliveryState; label: string }
const ownView = (l: TrackerLine): LineView => ({ received: receivedOf(l), outstanding: remainingOf(l), state: deliveryState(l), label: deliveryLabelOf(l) })

export function sortLines(lines: TrackerLine[], key: SortKey, dir: 'asc' | 'desc', view: (l: TrackerLine) => LineView = ownView): TrackerLine[] {
  const value = (l: TrackerLine): string | number => {
    switch (key) {
      case 'area': return l.area
      case 'location': return l.footingType
      case 'name': return l.component
      case 'category': return CATEGORY_ORDER.indexOf(l.category)
      case 'required': return l.requiredQty
      case 'received': return view(l).received
      case 'outstanding': return view(l).outstanding
      case 'status': return DELIVERY_RANK[view(l).state]
      case 'supplier': return l.supplier ?? ''
      case 'expected': return l.expectedDate ?? '9999-99-99'
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...lines].sort((a, b) => { const x = value(a), y = value(b); return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : cmp(String(x), String(y))) || cmp(a.id, b.id) })
}

export type GroupKey = '' | 'area' | 'location' | 'category' | 'supplier' | 'status' | 'specification'
export const groupLabel = (l: TrackerLine, g: GroupKey, view: (l: TrackerLine) => LineView = ownView): string => {
  switch (g) {
    case 'area': return l.area || '(no area)'
    case 'location': return `${l.area} · ${l.footingType || '(no location)'}`
    case 'category': return CATEGORY_LABEL[l.category]
    case 'supplier': return l.supplier || '(no supplier)'
    case 'status': return view(l).label
    case 'specification': return l.specification || '(no specification)'
    default: return ''
  }
}

/** Counts for the dashboard header. */
export function dashboardCounts(lines: TrackerLine[], stateOf: (l: TrackerLine) => DeliveryState = deliveryState) {
  const st = lines.map(stateOf)
  const n = (...s: DeliveryState[]) => st.filter((x) => s.includes(x)).length
  return {
    total: lines.length, delivered: n('received', 'over-received'), partial: n('partial'), pending: n('none-received'),
  }
}

/** How a line stands for the summaries: its delivery state, and the requirement it belongs to (so a requirement made of several lines is counted once). */
export interface LineStanding { state: DeliveryState; required: number; received: number; key?: string }
const ownStanding = (l: TrackerLine): LineStanding => ({ state: deliveryState(l), required: l.requiredQty, received: receivedOf(l) })

export function areaBreakdown(lines: TrackerLine[], standing: (l: TrackerLine) => LineStanding = ownStanding) {
  return distinct(lines.map((l) => l.area)).map((area) => {
    const mine = lines.filter((l) => l.area === area)
    const seen = new Set<string>()
    let required = 0, received = 0
    for (const l of mine) {
      const p = standing(l)
      if (p.key) { if (seen.has(p.key)) continue; seen.add(p.key) }
      required += p.required; received += Math.min(p.required, p.received)
    }
    return { area, ...dashboardCounts(mine, (l) => standing(l).state), required, received }
  })
}

/* ── Excel-compatible export ───────────────────────────────────────────── */

/** A cell that a spreadsheet would run as a formula is prefixed so exported text can never execute when opened. */
const safeCell = (v: string | number | null | undefined) => {
  const t = v === null || v === undefined ? '' : String(v)
  const guarded = /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export const EXPORT_HEADERS = ['Area', 'Footing Type / Location', 'Anchorage Type', 'Component', 'Category', 'Description', 'Specification', 'Size', 'Unit', 'Required Qty', 'Delivered Qty', 'Outstanding Qty', 'Delivery Status', 'Workbook Status', 'Supplier', 'PO / Reference', 'Expected Delivery', 'Ordered Qty', 'Notes', 'Archived', 'Source', 'Record ID']

/** The rows as a CSV that Excel opens directly (UTF-8 with byte-order mark, CRLF). */
export function toCsv(lines: TrackerLine[], view: (l: TrackerLine) => LineView = ownView): string {
  const rows = lines.map((l) => {
    const v = view(l)
    const out = v.outstanding
    return [l.area, l.footingType, l.anchorageType, l.component, CATEGORY_LABEL[l.category], l.description ?? '', l.specification ?? '', l.size ?? '', l.unit ?? '', l.requiredQty, v.received, out, v.label, l.origin === 'manual' ? '' : l.sourceStatus, l.supplier ?? '', l.poRef ?? '', l.expectedDate ?? '', l.orderedQty ?? '', l.notes, l.archived ? 'Yes' : '', l.origin === 'manual' ? 'Entered in Nexus' : `${l.source.sheet} row ${l.source.row}`, l.id]
  })
  return '﻿' + [EXPORT_HEADERS, ...rows].map((r) => r.map(safeCell).join(',')).join('\r\n') + '\r\n'
}

/* ── Import preview ────────────────────────────────────────────────────── */

export interface ImportPreview { newLines: number; unchanged: number; changedQty: { id: string; component: string; area: string; from: number; to: number }[]; keptRemoved: number; preservedEntries: number; duplicatesInFile: number }

/** What re-importing would do to the records already here, before anything is committed. Nothing in Nexus is ever overwritten. */
export function previewImport(state: TrackerState, parsed: { lines: TrackerLine[] }): ImportPreview {
  const prev = new Map(state.lines.map((l) => [l.id, l]))
  const incoming = new Set<string>()
  let duplicatesInFile = 0, newLines = 0, unchanged = 0
  const changedQty: ImportPreview['changedQty'] = []
  for (const l of parsed.lines) {
    if (incoming.has(l.id)) duplicatesInFile++
    incoming.add(l.id)
    const old = prev.get(l.id)
    if (!old) newLines++
    else if (old.requiredQty !== l.requiredQty) changedQty.push({ id: l.id, component: l.component, area: l.area, from: old.requiredQty, to: l.requiredQty })
    else unchanged++
  }
  const holdsEntries = (l: TrackerLine) => l.receipts.length > 0 || l.confirmedNoReceipts || l.orderedQty !== null || !!l.notes || !!l.supplier || !!l.poRef
  return {
    newLines, unchanged, changedQty, duplicatesInFile,
    keptRemoved: state.lines.filter((l) => !incoming.has(l.id) && holdsEntries(l)).length,
    preservedEntries: state.lines.filter((l) => incoming.has(l.id) && holdsEntries(l)).length,
  }
}
