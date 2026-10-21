import { addDays, daysBetween, type ISODate } from '@/lib/date'
import { formatShortDate } from '@/lib/format'
import { FOOTING_ACTIVITIES, HANDOVER_PHASES, IN_DELIVERY, PLINTH_ACTIVITIES, PROJECT_STATUS_RANK, ROTATION, getDef, isConstructionCategory, isDone, type ActivityCategory, type ActivityDef, type HandoverPhase } from './config'
import type {
  Activity, ActivityStatus, AnchorageType, Area, BoltSpec, BulkMaterial, ConstructionState, FabricationRequest,
  Foundation, HandoverRecord, HardwareKind, Person, Plinth, PlinthReady, POLine, PurchaseOrder, Supplier,
} from './types'

/* ── Index: lookup tables built once per state snapshot ─────────────────── */

export interface Index {
  state: ConstructionState
  area: Map<string, Area>
  foundation: Map<string, Foundation>
  plinth: Map<string, Plinth>
  anchorage: Map<string, AnchorageType>
  spec: Map<string, BoltSpec>
  bulk: Map<string, BulkMaterial>
  supplier: Map<string, Supplier>
  person: Map<string, Person>
  po: Map<string, PurchaseOrder>
  poLine: Map<string, { po: PurchaseOrder; line: POLine }>
  foundationsByArea: Map<string, Foundation[]>
  plinthsByFoundation: Map<string, Plinth[]>
  activitiesByOwner: Map<string, Activity[]>
  ordered: Map<string, number> // `${kind}:${itemId}` on issued POs
  draft: Map<string, number>
  received: Map<string, number>
  allocated: Map<string, number>
  allocatedToPlinth: Map<string, number> // `${kind}:${itemId}:${plinthId}`
  ready: Map<string, PlinthReady>
  fabByPlinth: Map<string, FabricationRequest[]>
}

const cache = new WeakMap<ConstructionState, Index>()

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}
function add(m: Map<string, number>, k: string, n: number) {
  m.set(k, (m.get(k) ?? 0) + n)
}
const by = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))

export function getIndex(state: ConstructionState): Index {
  const hit = cache.get(state)
  if (hit) return hit
  const poLine = new Map<string, { po: PurchaseOrder; line: POLine }>()
  const ordered = new Map<string, number>()
  const draft = new Map<string, number>()
  for (const po of state.purchaseOrders) {
    for (const line of po.lines) {
      poLine.set(line.id, { po, line })
      const k = `${line.kind}:${line.itemId}`
      if (po.status === 'issued') add(ordered, k, line.qtyOrdered)
      else if (po.status === 'draft') add(draft, k, line.qtyOrdered)
    }
  }
  const received = new Map<string, number>()
  for (const d of state.deliveries) {
    for (const l of d.lines) {
      const ref = poLine.get(l.poLineId)
      if (ref) add(received, `${ref.line.kind}:${ref.line.itemId}`, l.qtyReceived)
    }
  }
  const allocated = new Map<string, number>()
  const allocatedToPlinth = new Map<string, number>()
  for (const a of state.allocations) {
    add(allocated, `${a.itemType}:${a.itemId}`, a.qty)
    add(allocatedToPlinth, `${a.itemType}:${a.itemId}:${a.plinthId}`, a.qty)
  }
  const foundationsByArea = new Map<string, Foundation[]>()
  state.foundations.forEach((f) => push(foundationsByArea, f.areaId, f))
  const plinthsByFoundation = new Map<string, Plinth[]>()
  state.plinths.forEach((p) => push(plinthsByFoundation, p.foundationId, p))
  const activitiesByOwner = new Map<string, Activity[]>()
  state.activities.forEach((a) => push(activitiesByOwner, a.plinthId ?? a.foundationId, a))
  const fabByPlinth = new Map<string, FabricationRequest[]>()
  state.fabrication.forEach((r) => r.plinthIds.forEach((id) => push(fabByPlinth, id, r)))

  const idx: Index = {
    state, area: by(state.areas), foundation: by(state.foundations), plinth: by(state.plinths), anchorage: by(state.anchorageTypes),
    spec: by(state.boltSpecs), bulk: by(state.bulkMaterials), supplier: by(state.suppliers), person: by(state.people), po: by(state.purchaseOrders),
    poLine, foundationsByArea, plinthsByFoundation, activitiesByOwner, ordered, draft, received, allocated, allocatedToPlinth,
    ready: new Map(state.plinthReady.map((r) => [r.plinthId, r])), fabByPlinth,
  }
  cache.set(state, idx)
  return idx
}

export const qty = (m: Map<string, number>, k: string) => m.get(k) ?? 0

/* ── Plinth material requirements and readiness ─────────────────────────── */

export function plinthBoltRequirements(idx: Index, plinth: Plinth): { spec: BoltSpec; qty: number; allocated: number }[] {
  const type = plinth.anchorageTypeId ? idx.anchorage.get(plinth.anchorageTypeId) : undefined
  if (!type) return []
  return type.bolts.map((b) => ({ spec: idx.spec.get(b.specId)!, qty: b.qtyPerPlinth, allocated: qty(idx.allocatedToPlinth, `bolt:${b.specId}:${plinth.id}`) }))
}

export interface HardwareNeed {
  kind: HardwareKind
  size: string
  demand: number
  allocated: number
  item: BulkMaterial | undefined
}

export function plinthHardware(idx: Index, plinth: Plinth, areaId: string): HardwareNeed[] {
  const type = plinth.anchorageTypeId ? idx.anchorage.get(plinth.anchorageTypeId) : undefined
  if (!type) return []
  return type.hardware.map((h) => {
    const item = idx.state.bulkMaterials.find((b) => b.areaId === areaId && b.kind === h.kind && b.size === h.size)
    return { kind: h.kind, size: h.size, demand: h.qtyPerPlinth, item, allocated: item ? qty(idx.allocatedToPlinth, `bulk:${item.id}:${plinth.id}`) : 0 }
  })
}

export const areaOfPlinth = (idx: Index, p: Plinth) => idx.foundation.get(p.foundationId)!.areaId

export function boltsFullyAllocated(idx: Index, plinth: Plinth): boolean {
  const reqs = plinthBoltRequirements(idx, plinth)
  return reqs.length > 0 && reqs.every((r) => r.allocated >= r.qty)
}

export type BoltStage = 'not-allocated' | 'partially-allocated' | 'allocated' | 'ready'

/** Stage 4–5 of the bolt pipeline for one plinth (stages 1–3 are tracked per specification). */
export function plinthBoltStage(idx: Index, plinth: Plinth): BoltStage {
  if (idx.ready.has(plinth.id)) return 'ready'
  const reqs = plinthBoltRequirements(idx, plinth)
  if (reqs.length && reqs.every((r) => r.allocated >= r.qty)) return 'allocated'
  return reqs.some((r) => r.allocated > 0) ? 'partially-allocated' : 'not-allocated'
}

export const BOLT_STAGE_LABEL: Record<BoltStage, string> = {
  'not-allocated': 'Not allocated',
  'partially-allocated': 'Partially allocated',
  allocated: 'Allocated — not yet ready',
  ready: 'Ready for installation',
}

/* ── Effective activity status (derived where a record exists elsewhere) ── */

export function effectiveStatus(idx: Index, a: Activity): ActivityStatus {
  const def = getDef(a.scope, a.key)
  if (!def.derived || !a.plinthId) return a.status
  const plinth = idx.plinth.get(a.plinthId)!
  if (def.derived === 'bolts') {
    const stage = plinthBoltStage(idx, plinth)
    if (stage === 'ready') return 'complete'
    const ordered = plinthBoltRequirements(idx, plinth).some((r) => qty(idx.ordered, `bolt:${r.spec.id}`) > 0)
    return stage !== 'not-allocated' || ordered ? 'in-progress' : 'not-started'
  }
  if (def.derived === 'nuts' || def.derived === 'washers') {
    const kind: HardwareKind = def.derived === 'nuts' ? 'nut' : 'washer'
    const needs = plinthHardware(idx, plinth, areaOfPlinth(idx, plinth)).filter((h) => h.kind === kind)
    const demand = needs.reduce((s, h) => s + h.demand, 0)
    const allocated = needs.reduce((s, h) => s + h.allocated, 0)
    if (demand > 0 && allocated >= demand) return 'complete'
    const ordered = needs.some((h) => h.item && qty(idx.ordered, `bulk:${h.item.id}`) > 0)
    return allocated > 0 || ordered ? 'in-progress' : 'not-started'
  }
  const reqs = idx.fabByPlinth.get(plinth.id) ?? []
  if (reqs.some((r) => r.siteReceipt === 'received')) return 'complete'
  return reqs.some((r) => r.approval !== 'not-submitted') ? 'in-progress' : 'not-started'
}

export function derivedNote(idx: Index, a: Activity): string | null {
  const def = getDef(a.scope, a.key)
  if (!def.derived || !a.plinthId) return null
  const plinth = idx.plinth.get(a.plinthId)!
  if (def.derived === 'bolts') return BOLT_STAGE_LABEL[plinthBoltStage(idx, plinth)]
  if (def.derived === 'templates') {
    const r = (idx.fabByPlinth.get(plinth.id) ?? [])[0]
    return r ? `${r.number} · ${r.siteReceipt === 'received' ? 'received on site' : 'not yet on site'}` : 'No fabrication request'
  }
  const kind: HardwareKind = def.derived === 'nuts' ? 'nut' : 'washer'
  const needs = plinthHardware(idx, plinth, areaOfPlinth(idx, plinth)).filter((h) => h.kind === kind)
  return needs.length ? needs.map((h) => `${h.allocated} of ${h.demand} × ${h.size} allocated`).join(', ') : 'No anchorage type assigned'
}

/* ── Activity collections ───────────────────────────────────────────────── */

export function footingActivities(idx: Index, f: Foundation): Activity[] {
  return idx.activitiesByOwner.get(f.id) ?? []
}
export function plinthActivities(idx: Index, p: Plinth): Activity[] {
  return idx.activitiesByOwner.get(p.id) ?? []
}
export function foundationActivities(idx: Index, f: Foundation): Activity[] {
  return [...footingActivities(idx, f), ...(idx.plinthsByFoundation.get(f.id) ?? []).flatMap((p) => plinthActivities(idx, p))]
}
export function foundationsOfProject(idx: Index, projectId: string): Foundation[] {
  return idx.state.areas.filter((a) => a.projectId === projectId).flatMap((a) => idx.foundationsByArea.get(a.id) ?? [])
}

export function foundationsOf(idx: Index, areaId?: string): Foundation[] {
  return areaId ? idx.foundationsByArea.get(areaId) ?? [] : idx.state.foundations
}

const categoryOf = (a: Activity): ActivityCategory => getDef(a.scope, a.key).category

/* ── Tallies and rollups ────────────────────────────────────────────────── */

export interface Tally {
  total: number
  done: number
  blocked: number
  pending: number // pending-review
}

export function tally(idx: Index, acts: Activity[]): Tally {
  const t: Tally = { total: acts.length, done: 0, blocked: 0, pending: 0 }
  for (const a of acts) {
    const s = effectiveStatus(idx, a)
    if (isDone(s)) t.done++
    else if (s === 'blocked') t.blocked++
    else if (s === 'pending-review') t.pending++
  }
  return t
}

export const tallyCategory = (idx: Index, acts: Activity[], category: 'construction' | 'survey' | 'qaqc'): Tally =>
  tally(idx, acts.filter((a) => (category === 'construction' ? isConstructionCategory(categoryOf(a)) : categoryOf(a) === category)))

/**
 * Construction progress for a set of activities (0–100).
 * Each element (footing or plinth) = average of three equal stages: rebar (built + installed, split evenly), forming, pouring.
 */
export function progressOf(idx: Index, acts: Activity[]): number {
  const owners = new Map<string, Activity[]>()
  for (const a of acts) if (isConstructionCategory(categoryOf(a))) push(owners, a.plinthId ?? a.foundationId, a)
  if (!owners.size) return 0
  let sum = 0
  for (const list of owners.values()) {
    const done = (key: string) => {
      const a = list.find((x) => x.key === key)
      return a && isDone(effectiveStatus(idx, a)) ? 1 : 0
    }
    sum += ((done('rebarBuilt') + done('rebarInstalled')) / 2 + done('formed') + done('poured')) / 3
  }
  return Math.round((sum / owners.size) * 100)
}

export const percent = (t: Tally) => (t.total === 0 ? 0 : Math.round((t.done / t.total) * 100))

export interface Stats {
  foundations: number
  plinths: number
  constructed: number // COMPLETE foundations: every footing and plinth rebar, forming and pouring activity complete
  inProgress: number // started, not yet complete (blocked foundations are included)
  notStarted: number
  closedOut: number // constructed AND survey complete AND QA/QC approved
  blockedFoundations: number
  construction: Tally
  progress: number // see progressOf
  elementsPoured: { done: number; total: number } // footings + plinths
  survey: Tally
  qaqc: Tally
  footingFormed: Tally
  footingPoured: Tally
  plinthFormed: Tally
  plinthPoured: Tally
  rebarBuilt: Tally
  rebarInstalled: Tally
  materialsReady: { total: number; ready: number }
}

export function computeStats(idx: Index, foundations: Foundation[]): Stats {
  const all: Activity[] = []
  const plinthList: Plinth[] = []
  let constructed = 0
  let closedOut = 0
  let inProgress = 0
  let notStarted = 0
  let blockedFoundations = 0
  for (const f of foundations) {
    const acts = foundationActivities(idx, f)
    all.push(...acts)
    plinthList.push(...(idx.plinthsByFoundation.get(f.id) ?? []))
    const st = foundationState(idx, f)
    if (st.state === 'constructed' || st.state === 'closed-out') constructed++
    if (st.state === 'closed-out') closedOut++
    if (st.state === 'in-progress') inProgress++
    if (st.state === 'not-started') notStarted++
    if (st.blocked) blockedFoundations++
  }
  const pick = (scope: Activity['scope'], keys: string[]) => all.filter((a) => a.scope === scope && keys.includes(a.key))
  return {
    foundations: foundations.length,
    plinths: plinthList.length,
    constructed,
    closedOut,
    inProgress,
    notStarted,
    blockedFoundations,
    construction: tally(idx, all.filter((a) => isConstructionCategory(categoryOf(a)))),
    progress: progressOf(idx, all),
    elementsPoured: (() => { const p = all.filter((a) => a.key === 'poured'); return { done: p.filter((a) => isDone(effectiveStatus(idx, a))).length, total: p.length } })(),
    survey: tally(idx, all.filter((a) => categoryOf(a) === 'survey')),
    qaqc: tally(idx, all.filter((a) => categoryOf(a) === 'qaqc')),
    footingFormed: tally(idx, pick('footing', ['formed'])),
    footingPoured: tally(idx, pick('footing', ['poured'])),
    plinthFormed: tally(idx, pick('plinth', ['formed'])),
    plinthPoured: tally(idx, pick('plinth', ['poured'])),
    rebarBuilt: tally(idx, all.filter((a) => a.key === 'rebarBuilt')),
    rebarInstalled: tally(idx, all.filter((a) => a.key === 'rebarInstalled')),
    materialsReady: { total: plinthList.length, ready: plinthList.filter((p) => idx.ready.has(p.id)).length },
  }
}

export type FoundationStateId = 'not-started' | 'in-progress' | 'constructed' | 'closed-out'

export interface FoundationState {
  state: FoundationStateId
  blocked: boolean
}

export const FOUNDATION_STATE_LABEL: Record<FoundationStateId, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  constructed: 'Complete',
  'closed-out': 'Closed out',
}

function stateOf(idx: Index, acts: Activity[]): FoundationState {
  const effective = acts.map((a) => ({ a, s: effectiveStatus(idx, a) }))
  const blocked = effective.some((x) => x.s === 'blocked')
  const construction = effective.filter((x) => isConstructionCategory(categoryOf(x.a)))
  const rest = effective.filter((x) => ['survey', 'qaqc'].includes(categoryOf(x.a)))
  const constructed = construction.length > 0 && construction.every((x) => isDone(x.s))
  if (constructed && rest.every((x) => isDone(x.s))) return { state: 'closed-out', blocked }
  if (constructed) return { state: 'constructed', blocked }
  return { state: construction.some((x) => x.s !== 'not-started') ? 'in-progress' : 'not-started', blocked }
}

export const foundationState = (idx: Index, f: Foundation) => stateOf(idx, foundationActivities(idx, f))
export const plinthState = (idx: Index, p: Plinth) => stateOf(idx, plinthActivities(idx, p))

/** The next activity still to be completed, in construction sequence. */
export function currentStep(idx: Index, acts: Activity[], seq: ActivityDef[]): string {
  for (const def of seq) {
    if (def.category === 'materials') continue
    const a = acts.find((x) => x.key === def.key)
    if (a && !isDone(effectiveStatus(idx, a))) return def.label
  }
  return 'Complete'
}
export const footingStep = (idx: Index, f: Foundation) => currentStep(idx, footingActivities(idx, f), FOOTING_ACTIVITIES)
export const plinthStep = (idx: Index, p: Plinth) => currentStep(idx, plinthActivities(idx, p), PLINTH_ACTIVITIES)

/** Whether an activity's same-scope (and footing) prerequisites are complete. */
export function isReady(idx: Index, a: Activity): boolean {
  const def = getDef(a.scope, a.key)
  const owner = idx.activitiesByOwner.get(a.plinthId ?? a.foundationId) ?? []
  const ok = (keys: string[] | undefined, list: Activity[]) => (keys ?? []).every((k) => { const x = list.find((y) => y.key === k); return x ? isDone(effectiveStatus(idx, x)) : true })
  return ok(def.after, owner) && ok(def.afterFooting, idx.activitiesByOwner.get(a.foundationId) ?? [])
}

/* ── Materials tables ───────────────────────────────────────────────────── */

export interface BoltRequirementLine {
  plinth: Plinth
  foundation: Foundation
  area: Area
  anchorageTypeId: string
  qty: number
  allocated: number
  ready: boolean
}

export interface BoltRow {
  spec: BoltSpec
  required: number // within the filter (area or project)
  allocated: number // within the filter
  readyQty: number // within the filter
  ordered: number // project-wide, issued POs
  draft: number
  received: number // project-wide
  allocatedAll: number
  available: number // received − allocated, project-wide pool
  toOrder: number // project-wide shortfall after issued + draft orders
  lines: BoltRequirementLine[]
}

export function boltRows(idx: Index, areaId?: string): BoltRow[] {
  const projectRequired = new Map<string, number>()
  for (const p of idx.state.plinths) for (const r of plinthBoltRequirements(idx, p)) add(projectRequired, r.spec.id, r.qty)
  return idx.state.boltSpecs
    .map((spec) => {
      const lines: BoltRequirementLine[] = []
      for (const p of idx.state.plinths) {
        const f = idx.foundation.get(p.foundationId)!
        if (areaId && f.areaId !== areaId) continue
        const r = plinthBoltRequirements(idx, p).find((x) => x.spec.id === spec.id)
        if (r) lines.push({ plinth: p, foundation: f, area: idx.area.get(f.areaId)!, anchorageTypeId: p.anchorageTypeId!, qty: r.qty, allocated: r.allocated, ready: idx.ready.has(p.id) })
      }
      const key = `bolt:${spec.id}`
      const received = qty(idx.received, key)
      const allocatedAll = qty(idx.allocated, key)
      const ordered = qty(idx.ordered, key)
      const draft = qty(idx.draft, key)
      return {
        spec, lines,
        required: lines.reduce((s, l) => s + l.qty, 0),
        allocated: lines.reduce((s, l) => s + l.allocated, 0),
        readyQty: lines.filter((l) => l.ready).reduce((s, l) => s + l.qty, 0),
        ordered, draft, received, allocatedAll, available: received - allocatedAll,
        toOrder: Math.max(0, (projectRequired.get(spec.id) ?? 0) - ordered - draft),
      }
    })
    .filter((r) => r.lines.length > 0)
}

export interface BulkRow {
  item: BulkMaterial
  ordered: number
  draft: number
  received: number
  allocated: number
  available: number
  outstanding: number // required − received
  toOrder: number
  demand: number // derived from anchorage types of plinths in the area
  poNumbers: string[]
  suppliers: string[]
  expected: ISODate | null
}

export function bulkRows(idx: Index, areaId?: string): BulkRow[] {
  return idx.state.bulkMaterials
    .filter((b) => !areaId || b.areaId === areaId)
    .map((item) => {
      const key = `bulk:${item.id}`
      const lines = [...idx.poLine.values()].filter((x) => x.line.kind === 'bulk' && x.line.itemId === item.id && x.po.status !== 'cancelled')
      const open = lines.filter((x) => x.po.status === 'issued' && x.po.expectedDate)
      const received = qty(idx.received, key)
      const ordered = qty(idx.ordered, key)
      const demand = idx.state.plinths
        .filter((p) => areaOfPlinth(idx, p) === item.areaId)
        .reduce((s, p) => s + plinthHardware(idx, p, item.areaId).filter((h) => h.item?.id === item.id).reduce((t, h) => t + h.demand, 0), 0)
      return {
        item, ordered, received, demand,
        draft: qty(idx.draft, key),
        allocated: qty(idx.allocated, key),
        available: received - qty(idx.allocated, key),
        outstanding: Math.max(0, item.requiredQty - received),
        toOrder: Math.max(0, item.requiredQty - ordered - qty(idx.draft, key)),
        poNumbers: [...new Set(lines.map((x) => x.po.number))],
        suppliers: [...new Set(lines.map((x) => idx.supplier.get(x.po.supplierId)?.name ?? ''))],
        expected: open.map((x) => x.po.expectedDate!).sort()[0] ?? null,
      }
    })
}

export function poLineReceived(idx: Index, lineId: string): number {
  return idx.state.deliveries.flatMap((d) => d.lines).filter((l) => l.poLineId === lineId).reduce((s, l) => s + l.qtyReceived, 0)
}

export type Fulfilment = 'not-received' | 'partial' | 'complete' | 'over-received'

export function poFulfilment(idx: Index, po: PurchaseOrder): { ordered: number; received: number; state: Fulfilment } {
  const ordered = po.lines.reduce((s, l) => s + l.qtyOrdered, 0)
  const received = po.lines.reduce((s, l) => s + poLineReceived(idx, l.id), 0)
  const over = po.lines.some((l) => poLineReceived(idx, l.id) > l.qtyOrdered)
  return { ordered, received, state: over ? 'over-received' : received === 0 ? 'not-received' : received >= ordered ? 'complete' : 'partial' }
}

export function lineLabel(idx: Index, line: POLine): string {
  if (line.kind === 'bolt') {
    const s = idx.spec.get(line.itemId)!
    return `${s.diameter} × ${s.overallLength}" anchor bolt · ${s.grade}`
  }
  const b = idx.bulk.get(line.itemId)!
  return `${b.description} · ${idx.area.get(b.areaId)?.name}`
}

export function specLabel(s: BoltSpec): string {
  return `${s.diameter} × ${s.overallLength}"`
}

/* ── Handover ───────────────────────────────────────────────────────────── */

export interface HandoverItem {
  id: string
  label: string
  auto: boolean
  met: boolean
  detail: string
}

export interface HandoverEvaluation {
  phase: HandoverPhase
  record: HandoverRecord
  items: HandoverItem[]
  constructionComplete: boolean
  allMet: boolean
  stats: Stats
  outstandingFoundations: number
  openDeficiencies: number
  label: string
}

export function evaluateHandover(idx: Index, areaId: string): HandoverEvaluation {
  const record = idx.state.handover.find((h) => h.areaId === areaId)!
  const stats = computeStats(idx, foundationsOf(idx, areaId))
  const openDeficiencies = idx.state.deficiencies.filter((d) => d.areaId === areaId && d.status === 'open').length
  const constructionComplete = stats.construction.total > 0 && stats.construction.done === stats.construction.total
  const metrics = {
    construction: { met: constructionComplete, detail: `${stats.construction.done} of ${stats.construction.total} construction activities complete` },
    survey: { met: stats.survey.total > 0 && stats.survey.done === stats.survey.total, detail: `${stats.survey.done} of ${stats.survey.total} survey activities complete` },
    qaqc: { met: stats.qaqc.total > 0 && stats.qaqc.done === stats.qaqc.total, detail: `${stats.qaqc.done} of ${stats.qaqc.total} inspections approved` },
    deficiencies: { met: openDeficiencies === 0, detail: `${openDeficiencies} open` },
  }
  const items = record.requirements.map((r): HandoverItem =>
    r.metric
      ? { id: r.id, label: r.label, auto: true, ...metrics[r.metric] }
      : { id: r.id, label: r.label, auto: false, met: r.done, detail: r.done ? 'Confirmed' : 'Not yet confirmed' },
  )
  const allMet = items.every((i) => i.met)
  const prepStarted = record.acceptance === 'returned' || record.requirements.some((r) => !r.metric && r.done)
  // Construction completion alone never produces "Handed over": acceptance is a separate, deliberate record.
  const phase: HandoverPhase =
    record.acceptance === 'accepted' ? 'handed-over'
    : record.acceptance === 'submitted' ? 'ready-for-review'
    : constructionComplete ? (prepStarted ? 'handover-preparation' : 'construction-complete')
    : 'in-progress'
  const label = HANDOVER_PHASES.find((p) => p.id === phase)!.label
  return { phase, record, items, constructionComplete, allMet, stats, outstandingFoundations: stats.foundations - stats.constructed, openDeficiencies, label }
}

export const phaseIndex = (p: HandoverPhase) => HANDOVER_PHASES.findIndex((x) => x.id === p)

/* ── Issues requiring attention ─────────────────────────────────────────── */

export type IssueSeverity = 'high' | 'medium' | 'low'
export type IssueCategory = 'blocked' | 'overdue' | 'sequence' | 'material' | 'procurement' | 'inspection' | 'survey' | 'deficiency' | 'delivery' | 'fabrication'

export interface Issue {
  id: string
  severity: IssueSeverity
  category: IssueCategory
  title: string
  detail: string
  areaId: string | null
  foundationId: string | null
  to: string
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }

export function activityTitle(idx: Index, a: Activity): string {
  const f = idx.foundation.get(a.foundationId)!
  const def = getDef(a.scope, a.key)
  const p = a.plinthId ? idx.plinth.get(a.plinthId) : null
  return `${f.number}${p ? ` · Plinth ${p.index}` : ''} — ${def.label}`
}

export const foundationPath = (projectId: string, f: Foundation) => `/projects/${projectId}/areas/${f.areaId}/foundations/${f.id}`

export function deriveIssues(idx: Index, today: ISODate, projectId = 'reef'): Issue[] {
  const issues: Issue[] = []
  const s = idx.state
  const soon = addDays(today, 14)

  for (const a of s.activities) {
    const f = idx.foundation.get(a.foundationId)!
    const def = getDef(a.scope, a.key)
    const status = effectiveStatus(idx, a)
    const to = foundationPath(projectId, f)
    if (status === 'blocked') {
      issues.push({ id: `blocked:${a.id}`, severity: 'high', category: 'blocked', title: `Blocked: ${activityTitle(idx, a)}`, detail: a.notes || 'No reason recorded.', areaId: f.areaId, foundationId: f.id, to })
    } else if (!isDone(status) && a.plannedDate && a.plannedDate < today && !def.derived) {
      const late = daysBetween(a.plannedDate, today)
      issues.push({ id: `overdue:${a.id}`, severity: late > 7 ? 'medium' : 'low', category: 'overdue', title: `Overdue: ${activityTitle(idx, a)}`, detail: `Planned ${formatShortDate(a.plannedDate)} · ${late} day${late === 1 ? '' : 's'} late`, areaId: f.areaId, foundationId: f.id, to })
    }
    if (status === 'pending-review' && def.category === 'qaqc') {
      issues.push({ id: `insp:${a.id}`, severity: 'low', category: 'inspection', title: `Inspection pending: ${activityTitle(idx, a)}`, detail: 'Awaiting QA/QC response.', areaId: f.areaId, foundationId: f.id, to })
    }
    if (def.category === 'survey' && !isDone(status) && isReady(idx, a)) {
      issues.push({ id: `survey:${a.id}`, severity: 'low', category: 'survey', title: `Survey due: ${activityTitle(idx, a)}`, detail: 'Prerequisite work is complete.', areaId: f.areaId, foundationId: f.id, to })
    }
    // Sequencing check: pour recorded without an approved pre-pour inspection.
    if (a.key === 'poured' && isDone(status)) {
      const pre = (idx.activitiesByOwner.get(a.plinthId ?? a.foundationId) ?? []).find((x) => x.key === 'preInspection')
      if (pre && effectiveStatus(idx, pre) !== 'approved') {
        issues.push({ id: `seq:${a.id}`, severity: 'high', category: 'sequence', title: `Poured without approved pre-pour inspection: ${activityTitle(idx, a)}`, detail: 'Check the record — pre-pour inspection is not approved.', areaId: f.areaId, foundationId: f.id, to })
      }
    }
  }

  // Plinths about to form without material readiness.
  for (const p of s.plinths) {
    const forming = (idx.activitiesByOwner.get(p.id) ?? []).find((a) => a.key === 'formed')
    const f = idx.foundation.get(p.foundationId)!
    if (forming && !isDone(effectiveStatus(idx, forming)) && forming.plannedDate && forming.plannedDate <= soon && !idx.ready.has(p.id) && p.anchorageTypeId) {
      issues.push({ id: `mat:${p.id}`, severity: forming.plannedDate <= addDays(today, 7) ? 'high' : 'medium', category: 'material', title: `Anchor bolts not ready: ${f.number} · Plinth ${p.index}`, detail: `Forming planned ${formatShortDate(forming.plannedDate)}; bolts are "${BOLT_STAGE_LABEL[plinthBoltStage(idx, p)].toLowerCase()}".`, areaId: f.areaId, foundationId: f.id, to: `/projects/${projectId}/materials` })
    }
  }

  for (const r of boltRows(idx)) {
    if (r.toOrder > 0) issues.push({ id: `order:${r.spec.id}`, severity: 'medium', category: 'procurement', title: `${r.toOrder} × ${specLabel(r.spec)} bolts not yet on order`, detail: `${r.spec.id} · required across project less issued and draft orders.`, areaId: null, foundationId: null, to: `/projects/${projectId}/materials` })
  }
  for (const r of bulkRows(idx)) {
    if (r.toOrder > 0) issues.push({ id: `order:${r.item.id}`, severity: 'low', category: 'procurement', title: `${r.toOrder} × ${r.item.description} not yet on order`, detail: idx.area.get(r.item.areaId)!.name, areaId: r.item.areaId, foundationId: null, to: `/projects/${projectId}/materials` })
  }

  for (const po of s.purchaseOrders) {
    const f = poFulfilment(idx, po)
    if (po.status === 'issued' && po.expectedDate && po.expectedDate < today && f.state !== 'complete' && f.state !== 'over-received') {
      const late = daysBetween(po.expectedDate, today)
      issues.push({ id: `po:${po.id}`, severity: late > 7 ? 'high' : 'medium', category: 'procurement', title: `Delivery late: ${po.number}`, detail: `${idx.supplier.get(po.supplierId)?.name} · expected ${formatShortDate(po.expectedDate)} · ${f.received} of ${f.ordered} received`, areaId: null, foundationId: null, to: `/projects/${projectId}/materials` })
    }
  }
  for (const d of s.deliveries) {
    for (const l of d.lines) {
      if (l.qtyShipped !== l.qtyReceived && !l.resolved) {
        issues.push({ id: `disc:${l.id}`, severity: 'medium', category: 'delivery', title: `Delivery discrepancy: ${d.number}`, detail: `Slip ${l.qtyShipped}, counted ${l.qtyReceived}. ${l.note}`.trim(), areaId: null, foundationId: null, to: `/projects/${projectId}/materials` })
      }
    }
  }

  for (const r of s.fabrication) {
    const to = `/projects/${projectId}/fabrication`
    if (r.siteReceipt !== 'received' && r.expectedDate && r.expectedDate < today) {
      issues.push({ id: `fab:${r.id}`, severity: 'medium', category: 'fabrication', title: `Templates late: ${r.number}`, detail: `${r.title} · expected ${formatShortDate(r.expectedDate)}`, areaId: r.areaId, foundationId: null, to })
    } else if (r.approval === 'revisions-requested') {
      issues.push({ id: `fab:${r.id}`, severity: 'low', category: 'fabrication', title: `Awaiting supplier revision: ${r.number}`, detail: r.title, areaId: r.areaId, foundationId: null, to })
    } else if (r.approval === 'approved' && r.authorization === 'pending') {
      issues.push({ id: `fab:${r.id}`, severity: 'low', category: 'fabrication', title: `Purchase authorization pending: ${r.number}`, detail: r.title, areaId: r.areaId, foundationId: null, to })
    }
  }

  for (const d of s.deficiencies) {
    if (d.status !== 'open') continue
    const f = d.foundationId ? idx.foundation.get(d.foundationId) : null
    issues.push({ id: `def:${d.id}`, severity: d.severity === 'major' ? 'high' : 'low', category: 'deficiency', title: `Deficiency: ${d.title}`, detail: `${idx.area.get(d.areaId)?.name}${f ? ` · ${f.number}` : ''} · raised ${formatShortDate(d.raised)}`, areaId: d.areaId, foundationId: d.foundationId, to: f ? foundationPath(projectId, f) : `/projects/${projectId}/areas/${d.areaId}` })
  }

  return issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

export interface UpcomingItem {
  activity: Activity
  title: string
  foundation: Foundation
  status: ActivityStatus
}

export function upcomingWork(idx: Index, today: ISODate, days = 14, areaId?: string): UpcomingItem[] {
  const end = addDays(today, days)
  return idx.state.activities
    .filter((a) => a.plannedDate && a.plannedDate >= today && a.plannedDate <= end && !isDone(effectiveStatus(idx, a)) && !getDef(a.scope, a.key).derived)
    .map((a) => ({ activity: a, title: activityTitle(idx, a), foundation: idx.foundation.get(a.foundationId)!, status: effectiveStatus(idx, a) }))
    .filter((x) => !areaId || x.foundation.areaId === areaId)
    .sort((a, b) => a.activity.plannedDate!.localeCompare(b.activity.plannedDate!))
}

export function activitiesWhere(idx: Index, pred: (a: Activity, def: ActivityDef, status: ActivityStatus) => boolean, areaId?: string): UpcomingItem[] {
  return idx.state.activities
    .filter((a) => pred(a, getDef(a.scope, a.key), effectiveStatus(idx, a)))
    .map((a) => ({ activity: a, title: activityTitle(idx, a), foundation: idx.foundation.get(a.foundationId)!, status: effectiveStatus(idx, a) }))
    .filter((x) => !areaId || x.foundation.areaId === areaId)
}

/* ── Workforce context ──────────────────────────────────────────────────── */

export function onSite(offsetDays: number, anchor: ISODate, date: ISODate): boolean {
  const cycle = ROTATION.onDays + ROTATION.offDays
  const d = (((daysBetween(anchor, date) - offsetDays) % cycle) + cycle) % cycle
  return d < ROTATION.onDays
}

export function crewsOnSite(idx: Index, date: ISODate) {
  const s = idx.state
  return {
    crews: s.crews.filter((c) => onSite(c.offsetDays, s.rotationAnchor, date)),
    superintendents: s.people.filter((p) => p.role === 'superintendent' && p.offsetDays !== null && onSite(p.offsetDays, s.rotationAnchor, date)),
  }
}


/* ── Plinth material readiness and area status ──────────────────────────── */

const MATERIAL_KEYS = PLINTH_ACTIVITIES.filter((d) => d.category === 'materials').map((d) => d.key)

/** A plinth is material-ready when bolts, nuts, washers, sole plates and templates are all complete. */
export function plinthMaterials(idx: Index, p: Plinth): { done: number; total: number; ready: boolean } {
  const acts = plinthActivities(idx, p).filter((a) => MATERIAL_KEYS.includes(a.key))
  const done = acts.filter((a) => isDone(effectiveStatus(idx, a))).length
  return { done, total: acts.length, ready: acts.length > 0 && done === acts.length }
}

/** Area status for dashboards: not started, in progress, or the handover phase once construction is complete. */
export function areaStatus(idx: Index, areaId: string): { label: string; phase: HandoverPhase | 'not-started' } {
  const ev = evaluateHandover(idx, areaId)
  if (ev.phase === 'in-progress' && ev.stats.progress === 0 && ev.stats.construction.done === 0) return { label: 'Not started', phase: 'not-started' }
  return { label: ev.label, phase: ev.phase }
}

/* ── Portfolio (company level) ──────────────────────────────────────────── */

export interface ProjectSummary {
  project: ConstructionState['projects'][number]
  progress: number // derived for detailed projects, reported for summary projects
  progressSource: 'derived' | 'reported'
  openIssues: number
  criticalIssues: number
}

export function projectSummaries(idx: Index, exceptionsFor: (projectId: string) => { severity: string }[]): ProjectSummary[] {
  const s = idx.state
  return s.projects.map((project): ProjectSummary => {
    if (project.tracking === 'detailed') {
      const ex = exceptionsFor(project.id)
      return { project, progress: computeStats(idx, foundationsOfProject(idx, project.id)).progress, progressSource: 'derived', openIssues: ex.length, criticalIssues: ex.filter((e) => e.severity === 'high').length }
    }
    const open = s.projectIssues.filter((i) => i.projectId === project.id && i.status === 'open')
    return { project, progress: project.reportedProgress ?? 0, progressSource: 'reported', openIssues: open.length, criticalIssues: open.filter((i) => i.severity === 'critical').length }
  })
}

export interface PortfolioCounts {
  total: number
  active: number // in delivery: active + at risk + delayed
  atRisk: number
  delayed: number
}

export function portfolioCounts(projects: ConstructionState['projects']): PortfolioCounts {
  return {
    total: projects.length,
    active: projects.filter((p) => IN_DELIVERY.includes(p.status)).length,
    atRisk: projects.filter((p) => p.status === 'at-risk').length,
    delayed: projects.filter((p) => p.status === 'delayed').length,
  }
}

export const statusRank = (s: ConstructionState['projects'][number]['status']) => PROJECT_STATUS_RANK[s]
