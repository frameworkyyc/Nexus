import { identity } from '@/app/identity'
import { addDays, type ISODate } from '@/lib/date'
import { blankActivitiesFor } from './blankActivities'
import { DEFAULT_HANDOVER_REQUIREMENTS, getDef, isDone } from './config'
import { areaOfPlinth, boltsFullyAllocated, getIndex, plinthBoltRequirements, plinthHardware, qty } from './selectors'
import { applyBolts, applyGroups, configProblem, groupsOf, quantityBelowPours, type FoundationConfig } from './configActions'
import type { TrackerState } from './tracker/types'
import type {
  ProjectIssue, ProjectStatus, Activity, AutoMetric, ConstructionState, Deficiency, DocumentKind, FabricationRequest, HandoverRequirement, HistoryEntry, POLine, PurchaseOrder,
} from './types'

/** A reducer returns the next state, or an error message when a business rule is violated. */
export type Result = { state: ConstructionState; error?: undefined } | { error: string; state?: undefined }
/** Supplied by the server (and by the browser demo) for rules that need another module's records. Never taken from a client request. */
export interface Ctx { actor?: string; now?: string; /** Materials records, for rules about materials that reference a foundation. */ materials?: TrackerState }
export type Reducer = (s: ConstructionState, ctx?: Ctx) => Result

const ok = (state: ConstructionState): Result => ({ state })
const fail = (error: string): Result => ({ error })

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/* ── Activities ─────────────────────────────────────────────────────────── */

export type ActivityPatch = Partial<Pick<Activity, 'status' | 'plannedDate' | 'actualDate' | 'assigneeId' | 'notes' | 'docIds'>>

export const updateActivity = (id: string, patch: ActivityPatch, today: ISODate): Reducer => (s) => {
  const a = s.activities.find((x) => x.id === id)
  if (!a) return fail('Activity not found.')
  if (patch.status && getDef(a.scope, a.key).derived) return fail('This status is derived from Materials or Fabrication records and cannot be set here.')
  const next: Activity = { ...a, ...patch }
  if (patch.status) {
    if (isDone(patch.status) && !next.actualDate) next.actualDate = today
    if (patch.status === 'not-started') next.actualDate = null
  }
  if (patch.actualDate && !patch.status && !isDone(a.status) && !getDef(a.scope, a.key).derived) {
    next.status = getDef(a.scope, a.key).statusSet === 'qaqc' ? 'approved' : 'complete'
  }
  return ok({ ...s, activities: s.activities.map((x) => (x.id === id ? next : x)) })
}

export const setFoundationNotes = (id: string, notes: string): Reducer => (s) => ok({ ...s, foundations: s.foundations.map((f) => (f.id === id ? { ...f, notes } : f)) })
export const setPlinthNotes = (id: string, notes: string): Reducer => (s) => ok({ ...s, plinths: s.plinths.map((p) => (p.id === id ? { ...p, notes } : p)) })

export const linkFoundationDoc = (id: string, docId: string, linked: boolean): Reducer => (s) =>
  ok({ ...s, foundations: s.foundations.map((f) => (f.id === id ? { ...f, docIds: linked ? [...new Set([...f.docIds, docId])] : f.docIds.filter((d) => d !== docId) } : f)) })

export const addDocument = (title: string, kind: DocumentKind, revision: string, date: ISODate, onCreate?: (id: string) => void): Reducer => (s) => {
  if (!title.trim()) return fail('A document title is required.')
  const id = `DOC-${String(s.documents.length + 1).padStart(3, '0')}-${nextId('x').slice(-3)}`
  onCreate?.(id)
  return ok({ ...s, documents: [...s.documents, { id, title: `${title.trim()} (demonstration placeholder)`, kind, revision, date }] })
}

/* ── Anchorage library ──────────────────────────────────────────────────── */

export const setPlinthAnchorage = (plinthId: string, typeId: string | null): Reducer => (s) => {
  const hasStock = s.allocations.some((a) => a.plinthId === plinthId) || s.plinthReady.some((r) => r.plinthId === plinthId)
  if (hasStock) return fail('Return this plinth’s allocated material to stock before changing its anchorage type.')
  return ok({ ...s, plinths: s.plinths.map((p) => (p.id === plinthId ? { ...p, anchorageTypeId: typeId } : p)) })
}

export const updateAnchorageType = (id: string, patch: { description?: string; boltQty?: Record<string, number>; hardwareQty?: Record<string, number> }): Reducer => (s) => {
  const type = s.anchorageTypes.find((t) => t.id === id)
  if (!type) return fail('Anchorage type not found.')
  const bad = [...Object.values(patch.boltQty ?? {}), ...Object.values(patch.hardwareQty ?? {})].some((n) => !Number.isInteger(n) || n < 0)
  if (bad) return fail('Quantities must be whole numbers of zero or more.')
  const next = {
    ...type,
    description: patch.description ?? type.description,
    bolts: type.bolts.map((b) => ({ ...b, qtyPerPlinth: patch.boltQty?.[b.specId] ?? b.qtyPerPlinth })),
    hardware: type.hardware.map((h) => ({ ...h, qtyPerPlinth: patch.hardwareQty?.[`${h.kind}:${h.size}`] ?? h.qtyPerPlinth })),
  }
  // Lowering quantities must not strand allocations that exceed the new requirement.
  const idx = getIndex(s)
  for (const p of s.plinths.filter((x) => x.anchorageTypeId === id)) {
    for (const b of next.bolts) {
      if (qty(idx.allocatedToPlinth, `bolt:${b.specId}:${p.id}`) > b.qtyPerPlinth) return fail('Some plinths already have more bolts allocated than the new quantity. Return stock first.')
    }
  }
  return ok({ ...s, anchorageTypes: s.anchorageTypes.map((t) => (t.id === id ? next : t)) })
}

/* ── Allocation (separate from receiving) ───────────────────────────────── */

export interface AllocationRequest {
  itemType: 'bolt' | 'bulk'
  itemId: string
  plinthId: string
  qty: number
}

export const allocate = (requests: AllocationRequest[], today: ISODate): Reducer => (s) => {
  const idx = getIndex(s)
  const wanted = requests.filter((r) => r.qty !== 0)
  if (!wanted.length) return fail('Enter a quantity to allocate.')
  const draw = new Map<string, number>()
  const perPlinth = new Map<string, number>()
  for (const r of wanted) {
    if (!Number.isInteger(r.qty) || r.qty < 0) return fail('Quantities must be whole numbers.')
    const key = `${r.itemType}:${r.itemId}`
    draw.set(key, (draw.get(key) ?? 0) + r.qty)
    const pk = `${key}:${r.plinthId}`
    perPlinth.set(pk, (perPlinth.get(pk) ?? 0) + r.qty)
  }
  // Each pool is checked against what has been received minus what is already committed.
  for (const [key, want] of draw) {
    const available = qty(idx.received, key) - qty(idx.allocated, key)
    if (want > available) return fail(`Only ${available} available in received stock — cannot allocate ${want}. The same inventory cannot be allocated twice.`)
  }
  for (const [pk, want] of perPlinth) {
    const [kind, itemId, plinthId] = pk.split(':')
    const plinth = idx.plinth.get(plinthId)
    if (!plinth) return fail('Plinth not found.')
    const item = idx.bulk.get(itemId)
    if (kind === 'bulk' && item && item.areaId !== areaOfPlinth(idx, plinth)) return fail('Bulk stock can only be allocated within its own area.')
    const required =
      kind === 'bolt'
        ? plinthBoltRequirements(idx, plinth).find((r) => r.spec.id === itemId)?.qty ?? 0
        : plinthHardware(idx, plinth, areaOfPlinth(idx, plinth)).filter((h) => h.item?.id === itemId).reduce((t, h) => t + h.demand, 0)
    if (required === 0) return fail('That plinth does not require this material.')
    if (qty(idx.allocatedToPlinth, pk) + want > required) return fail(`Allocation would exceed the plinth requirement of ${required}.`)
  }
  const created = wanted.map((r) => ({ id: nextId('al'), itemType: r.itemType, itemId: r.itemId, plinthId: r.plinthId, qty: r.qty, date: today }))
  return ok({ ...s, allocations: [...s.allocations, ...created] })
}

export const returnAllocation = (allocationId: string): Reducer => (s) => {
  const a = s.allocations.find((x) => x.id === allocationId)
  if (!a) return fail('Allocation not found.')
  if (a.itemType === 'bolt' && s.plinthReady.some((r) => r.plinthId === a.plinthId)) return fail('Unmark “ready for installation” before returning bolts to stock.')
  return ok({ ...s, allocations: s.allocations.filter((x) => x.id !== allocationId) })
}

export const setBoltsReady = (plinthId: string, ready: boolean, today: ISODate): Reducer => (s) => {
  const idx = getIndex(s)
  const plinth = idx.plinth.get(plinthId)
  if (!plinth) return fail('Plinth not found.')
  if (!ready) return ok({ ...s, plinthReady: s.plinthReady.filter((r) => r.plinthId !== plinthId) })
  if (!boltsFullyAllocated(idx, plinth)) return fail('All anchor bolts for this plinth must be allocated before it can be marked ready for installation.')
  if (s.plinthReady.some((r) => r.plinthId === plinthId)) return ok(s)
  return ok({ ...s, plinthReady: [...s.plinthReady, { plinthId, date: today }] })
}

/* ── Purchasing and receiving ───────────────────────────────────────────── */

export const createPurchaseOrder = (supplierId: string, expectedDate: ISODate | null, notes: string, onCreate?: (id: string) => void): Reducer => (s) => {
  const id = nextId('po')
  const number = `PO-${identity.numberStem}-${String(100 + s.purchaseOrders.length + 1).padStart(4, '0')}`
  const po: PurchaseOrder = { id, number, supplierId, status: 'draft', issuedDate: null, expectedDate, notes, lines: [] }
  onCreate?.(id)
  return ok({ ...s, purchaseOrders: [...s.purchaseOrders, po] })
}

export const addPOLine = (poId: string, kind: POLine['kind'], itemId: string, qtyOrdered: number): Reducer => (s) => {
  const po = s.purchaseOrders.find((p) => p.id === poId)
  if (!po) return fail('Purchase order not found.')
  if (po.status === 'cancelled') return fail('This purchase order is cancelled.')
  if (!Number.isInteger(qtyOrdered) || qtyOrdered <= 0) return fail('Order quantity must be a positive whole number.')
  const existing = po.lines.find((l) => l.kind === kind && l.itemId === itemId)
  const lines = existing
    ? po.lines.map((l) => (l === existing ? { ...l, qtyOrdered: l.qtyOrdered + qtyOrdered } : l))
    : [...po.lines, { id: `${poId}-L${itemId}`, kind, itemId, qtyOrdered }]
  return ok({ ...s, purchaseOrders: s.purchaseOrders.map((p) => (p.id === poId ? { ...p, lines } : p)) })
}

export const issuePurchaseOrder = (poId: string, today: ISODate): Reducer => (s) => {
  const po = s.purchaseOrders.find((p) => p.id === poId)
  if (!po || po.status !== 'draft') return fail('Only draft purchase orders can be issued.')
  if (!po.lines.length) return fail('Add at least one line before issuing.')
  return ok({ ...s, purchaseOrders: s.purchaseOrders.map((p) => (p.id === poId ? { ...p, status: 'issued', issuedDate: today, expectedDate: p.expectedDate ?? addDays(today, 14) } : p)) })
}

export const cancelPurchaseOrder = (poId: string): Reducer => (s) => {
  const received = s.deliveries.some((d) => d.poId === poId && d.lines.some((l) => l.qtyReceived > 0))
  if (received) return fail('Stock has already been received against this purchase order.')
  return ok({ ...s, purchaseOrders: s.purchaseOrders.map((p) => (p.id === poId ? { ...p, status: 'cancelled' } : p)) })
}

export const setPOExpected = (poId: string, date: ISODate | null): Reducer => (s) => ok({ ...s, purchaseOrders: s.purchaseOrders.map((p) => (p.id === poId ? { ...p, expectedDate: date } : p)) })

export interface ReceiptLine {
  poLineId: string
  qtyShipped: number
  qtyReceived: number
  note: string
}

/** Receiving only adds to on-site stock. Plinths are not considered material-ready until stock is allocated. */
export const receiveDelivery = (poId: string, receipt: { date: ISODate; reference: string; receivedBy: string; notes: string; lines: ReceiptLine[] }): Reducer => (s) => {
  const po = s.purchaseOrders.find((p) => p.id === poId)
  if (!po || po.status !== 'issued') return fail('Deliveries can only be received against an issued purchase order.')
  const lines = receipt.lines.filter((l) => l.qtyReceived > 0 || l.qtyShipped > 0)
  if (!lines.length) return fail('Enter received quantities for at least one line.')
  for (const l of lines) {
    if (![l.qtyShipped, l.qtyReceived].every((n) => Number.isInteger(n) && n >= 0)) return fail('Quantities must be whole numbers of zero or more.')
    const poLine = po.lines.find((x) => x.id === l.poLineId)
    if (!poLine) return fail('Line does not belong to this purchase order.')
    const so_far = s.deliveries.flatMap((d) => d.lines).filter((x) => x.poLineId === l.poLineId).reduce((t, x) => t + x.qtyReceived, 0)
    if (so_far + l.qtyReceived > poLine.qtyOrdered && !l.note.trim()) return fail('Receiving more than was ordered requires a note explaining the over-receipt.')
  }
  const number = `DEL-${String(s.deliveries.length + 1).padStart(4, '0')}`
  const delivery = {
    id: nextId('del'), number, poId, receivedDate: receipt.date, reference: receipt.reference.trim() || '—', receivedBy: receipt.receivedBy, notes: receipt.notes,
    lines: lines.map((l) => ({ id: nextId('dl'), poLineId: l.poLineId, qtyShipped: l.qtyShipped, qtyReceived: l.qtyReceived, note: l.note, resolved: l.qtyShipped === l.qtyReceived })),
  }
  return ok({ ...s, deliveries: [...s.deliveries, delivery] })
}

export const resolveDeliveryLine = (lineId: string, resolved: boolean): Reducer => (s) =>
  ok({ ...s, deliveries: s.deliveries.map((d) => ({ ...d, lines: d.lines.map((l) => (l.id === lineId ? { ...l, resolved } : l)) })) })


/* ── Custom fabrication ─────────────────────────────────────────────────── */

const entry = (date: ISODate, text: string): HistoryEntry => ({ id: nextId('h'), date, by: 'Project Coordinator', text })

export type FabricationPatch = Partial<Omit<FabricationRequest, 'id' | 'number' | 'history'>>

const FIELD_LABEL: Partial<Record<keyof FabricationRequest, string>> = {
  approval: 'Approval status', authorization: 'Purchase authorization', fabrication: 'Fabrication status', pickup: 'Pickup status',
  siteReceipt: 'Site receipt', revision: 'Drawing revision', quantity: 'Template quantity', reuse: 'Reuse', expectedDate: 'Expected completion',
}

/** Enforces the real-world order of the workflow and records every change in the request history. */
export const updateFabrication = (id: string, patch: FabricationPatch, today: ISODate): Reducer => (s) => {
  const r = s.fabrication.find((x) => x.id === id)
  if (!r) return fail('Fabrication request not found.')
  const n = { ...r, ...patch }
  const authorized = n.authorization === 'authorized' || n.authorization === 'paid' || n.authorization === 'not-required'
  if (n.fabrication !== 'not-started' && !(n.approval === 'approved' && authorized)) {
    return fail('The supplier drawing must be approved and purchase authorized before fabrication can start.')
  }
  if (n.pickup !== 'not-ready' && n.fabrication !== 'complete') return fail('Templates cannot be ready for pickup until fabrication is complete.')
  if (n.siteReceipt === 'received' && n.pickup !== 'collected') return fail('Templates must be collected before they can be received on site.')
  if (n.approval === 'approved' && !n.supplierDrawingDocId) return fail('Link the supplier drawing before approving it.')
  if (!Number.isInteger(n.quantity) || n.quantity < 0) return fail('Quantity must be a whole number.')
  const changes: string[] = []
  for (const k of Object.keys(patch) as (keyof FabricationRequest)[]) {
    if (FIELD_LABEL[k] && patch[k as keyof FabricationPatch] !== r[k]) changes.push(`${FIELD_LABEL[k]}: ${String(r[k])} → ${String(patch[k as keyof FabricationPatch])}`)
  }
  if (n.siteReceipt === 'received' && !n.receivedDate) n.receivedDate = today
  if (n.siteReceipt === 'pending') n.receivedDate = null
  const history = changes.length ? [...r.history, entry(today, changes.join('; '))] : r.history
  return ok({ ...s, fabrication: s.fabrication.map((x) => (x.id === id ? { ...n, history } : x)) })
}

export const addFabricationNote = (id: string, text: string, today: ISODate): Reducer => (s) => {
  if (!text.trim()) return fail('Enter a note.')
  return ok({ ...s, fabrication: s.fabrication.map((x) => (x.id === id ? { ...x, history: [...x.history, entry(today, text.trim())] } : x)) })
}

export const setFabricationPlinths = (id: string, plinthIds: string[], today: ISODate): Reducer => (s) => {
  const r = s.fabrication.find((x) => x.id === id)
  if (!r) return fail('Fabrication request not found.')
  return ok({ ...s, fabrication: s.fabrication.map((x) => (x.id === id ? { ...x, plinthIds, history: [...x.history, entry(today, `Assignments updated: ${plinthIds.length} plinth${plinthIds.length === 1 ? '' : 's'}`)] } : x)) })
}

export const createFabrication = (input: { areaId: string; anchorageTypeId: string; supplierId: string; quantity: number; plinthIds: string[] }, today: ISODate, onCreate?: (id: string) => void): Reducer => (s) => {
  const id = nextId('fab')
  const number = `FAB-${identity.numberStem}-${String(s.fabrication.length + 1).padStart(3, '0')}`
  const area = s.areas.find((a) => a.id === input.areaId)
  const designId = `DOC-${String(s.documents.length + 1).padStart(3, '0')}-${id.slice(-3)}`
  const request: FabricationRequest = {
    id, number, title: `${input.anchorageTypeId} anchor bolt templates — ${area?.name ?? ''}`, ...input, reuse: 'to-be-confirmed',
    originalDesignDocId: designId, supplierDrawingDocId: null, revision: 'A', quotation: { reference: '', amount: null, date: null },
    approval: 'not-submitted', authorization: 'pending', fabrication: 'not-started', pickup: 'not-ready', siteReceipt: 'pending',
    expectedDate: null, receivedDate: null, notes: '', history: [entry(today, 'Request created; original design prepared.')],
  }
  onCreate?.(id)
  return ok({
    ...s,
    documents: [...s.documents, { id: designId, title: `Template layout ${input.anchorageTypeId} — original design (demonstration placeholder)`, kind: 'design', revision: 'A', date: today }],
    fabrication: [...s.fabrication, request],
  })
}


/* ── Deficiencies ───────────────────────────────────────────────────────── */

export const addDeficiency = (input: Pick<Deficiency, 'areaId' | 'foundationId' | 'plinthId' | 'title' | 'severity'>, today: ISODate): Reducer => (s) => {
  if (!input.title.trim()) return fail('Describe the deficiency.')
  return ok({ ...s, deficiencies: [...s.deficiencies, { ...input, title: input.title.trim(), id: nextId('def'), status: 'open', raised: today, closed: null }] })
}

export const setDeficiencyStatus = (id: string, status: Deficiency['status'], today: ISODate): Reducer => (s) =>
  ok({ ...s, deficiencies: s.deficiencies.map((d) => (d.id === id ? { ...d, status, closed: status === 'closed' ? today : null } : d)) })

/* ── Handover ───────────────────────────────────────────────────────────── */

const patchHandover = (s: ConstructionState, areaId: string, fn: (h: ConstructionState['handover'][number]) => ConstructionState['handover'][number]) =>
  ok({ ...s, handover: s.handover.map((h) => (h.areaId === areaId ? fn(h) : h)) })

export const setRequirementDone = (areaId: string, reqId: string, done: boolean, today: ISODate): Reducer => (s) =>
  patchHandover(s, areaId, (h) => ({ ...h, requirements: h.requirements.map((r) => (r.id === reqId ? { ...r, done, doneDate: done ? today : null } : r)) }))

export const addRequirement = (areaId: string, label: string, metric: AutoMetric | null): Reducer => (s) => {
  if (!label.trim()) return fail('Enter a requirement name.')
  const req: HandoverRequirement = { id: nextId('req'), label: label.trim(), metric, done: false, doneDate: null, note: '' }
  return patchHandover(s, areaId, (h) => ({ ...h, requirements: [...h.requirements, req] }))
}

export const renameRequirement = (areaId: string, reqId: string, label: string): Reducer => (s) =>
  patchHandover(s, areaId, (h) => ({ ...h, requirements: h.requirements.map((r) => (r.id === reqId ? { ...r, label } : r)) }))

export const removeRequirement = (areaId: string, reqId: string): Reducer => (s) => {
  const h = s.handover.find((x) => x.areaId === areaId)
  if (h && h.acceptance === 'accepted') return fail('Requirements cannot be changed after acceptance.')
  return patchHandover(s, areaId, (x) => ({ ...x, requirements: x.requirements.filter((r) => r.id !== reqId) }))
}

export const setHandoverNotes = (areaId: string, notes: string): Reducer => (s) => patchHandover(s, areaId, (h) => ({ ...h, notes }))

/** Handover acceptance is always a deliberate action; completing construction never sets it. */
export const submitHandover = (areaId: string, today: ISODate, met: boolean): Reducer => (s) => {
  if (!met) return fail('All handover requirements must be met before submitting.')
  return patchHandover(s, areaId, (h) => ({ ...h, acceptance: 'submitted', submittedDate: today }))
}

export const recordAcceptance = (areaId: string, accepted: boolean, by: string, today: ISODate): Reducer => (s) => {
  const h = s.handover.find((x) => x.areaId === areaId)
  if (!h || h.acceptance !== 'submitted') return fail('The area must be submitted for handover first.')
  if (accepted && !by.trim()) return fail('Record who accepted the handover.')
  return patchHandover(s, areaId, (x) => (accepted ? { ...x, acceptance: 'accepted', acceptedDate: today, acceptedBy: by.trim() } : { ...x, acceptance: 'returned' }))
}

export const reopenHandover = (areaId: string): Reducer => (s) => patchHandover(s, areaId, (h) => ({ ...h, acceptance: 'not-submitted', submittedDate: null, acceptedDate: null, acceptedBy: '' }))


/** Orders a shortfall onto a new draft PO (optionally issuing it) in one atomic step. */
export const orderOnNewPO = (input: { supplierId: string; expectedDate: ISODate | null; notes: string; kind: POLine['kind']; itemId: string; qty: number; issue: boolean }, today: ISODate): Reducer => (s) => {
  let id = ''
  const created = createPurchaseOrder(input.supplierId, input.expectedDate, input.notes, (x) => (id = x))(s)
  if (created.error !== undefined) return created
  const lined = addPOLine(id, input.kind, input.itemId, input.qty)(created.state)
  if (lined.error !== undefined) return lined
  return input.issue ? issuePurchaseOrder(id, today)(lined.state) : lined
}

/* ── Projects (company level) ───────────────────────────────────────────── */

/** Status is always recorded by a person. It is never derived from a completion percentage. */
export const setProjectStatus = (projectId: string, status: ProjectStatus, note: string): Reducer => (s) => {
  if (!s.projects.some((p) => p.id === projectId)) return fail('Project not found.')
  if ((status === 'at-risk' || status === 'delayed' || status === 'on-hold') && !note.trim()) return fail('Record why the project is ' + status.replace('-', ' ') + '.')
  return ok({ ...s, projects: s.projects.map((p) => (p.id === projectId ? { ...p, status, statusNote: note.trim() } : p)) })
}

export const setReportedProgress = (projectId: string, value: number): Reducer => (s) => {
  const p = s.projects.find((x) => x.id === projectId)
  if (!p) return fail('Project not found.')
  if (p.tracking !== 'summary') return fail('This project’s progress is calculated from its activity records.')
  if (!Number.isInteger(value) || value < 0 || value > 100) return fail('Enter a whole number from 0 to 100.')
  return ok({ ...s, projects: s.projects.map((x) => (x.id === projectId ? { ...x, reportedProgress: value } : x)) })
}

export const addProjectIssue = (projectId: string, title: string, severity: ProjectIssue['severity'], today: ISODate): Reducer => (s) => {
  if (!title.trim()) return fail('Describe the issue.')
  return ok({ ...s, projectIssues: [...s.projectIssues, { id: nextId('pi'), projectId, title: title.trim(), severity, status: 'open', recorded: today }] })
}

export const setProjectIssueStatus = (id: string, status: ProjectIssue['status']): Reducer => (s) =>
  ok({ ...s, projectIssues: s.projectIssues.map((i) => (i.id === id ? { ...i, status } : i)) })

/* ── Foundation register (saved project data) ───────────────────────────── */

const FOUNDATION_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

/** Why a foundation name cannot be used in an area, or null. Archived foundations still hold their number, so it cannot be reused by accident. */
function numberProblem(s: ConstructionState, areaId: string, number: string, exceptId?: string): string | null {
  const area = s.areas.find((a) => a.id === areaId)
  if (!area) return 'Area not found.'
  if (area.archived) return `${area.name} is archived. Restore it before adding foundations.`
  if (!FOUNDATION_NUMBER.test(number)) return 'Use letters, digits, dots, dashes or underscores for the foundation name (for example FND-101).'
  const clash = s.foundations.find((f) => f.areaId === areaId && f.id !== exceptId && f.number.toLowerCase() === number.toLowerCase())
  return clash ? `Foundation ${number} already exists in ${area.name}${clash.archived ? ' (archived — restore it instead)' : ''}.` : null
}

const newFoundation = (s: ConstructionState, areaId: string, number: string, description: string, plinthCount: number | null, quantity: number) => {
  let id = `f-${areaId}-${number}`
  for (let n = 2; s.foundations.some((f) => f.id === id); n++) id = `f-${areaId}-${number}-${n}` // an id is never reused, even after a rename
  const foundation = { id, areaId, number, description: description.trim(), notes: '', docIds: [] as string[], quantity, plinthsPerFoundation: plinthCount }
  // One set of plinth records per designation (not per physical foundation). An unknown count creates none and is not treated as zero.
  // The plinths start in one group with no anchorage type; the foundation can be configured with real anchorage groups afterwards.
  const groupId = `${id}-g1`
  const plinths = Array.from({ length: plinthCount ?? 0 }, (_, i) => ({ id: `${id}-p${i + 1}`, foundationId: id, index: i + 1, anchorageTypeId: null, notes: '', groupId, dims: null }))
  const anchorageGroups = plinths.length ? [{ id: groupId, foundationId: id, anchorageTypeId: null, count: plinths.length, dims: null }] : []
  return { foundation, plinths, anchorageGroups, activities: blankActivitiesFor(foundation, plinths) }
}

const MAX_QUANTITY = 1_000_000
/** Quantity: a whole number, 1 or more. Absent means 1. */
const quantityProblem = (q: unknown) => (q === undefined || q === null || (typeof q === 'number' && Number.isInteger(q) && q >= 1 && q <= MAX_QUANTITY) ? null : 'Quantity must be a whole number of 1 or more.')
/** Plinths per foundation: a whole number from 0 to 100, or null when not known. */
const plinthProblem = (n: unknown) => (n === null || (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100) ? null : 'Plinths per foundation must be a whole number from 0 to 100, or left blank if not known.')

/**
 * Adds a foundation designation to an area: one row, however many physical foundations (`quantity`) it stands for, with the plinth records of
 * one foundation. Every applicable activity starts as "not started". A name that already exists in the area (archived or not) is refused.
 */
export const createFoundation = (areaId: string, number: string, description: string, plinthCount: number | null, quantity: number = 1, config?: FoundationConfig): Reducer => (s) => {
  const num = String(number).trim()
  const bad = numberProblem(s, areaId, num) ?? quantityProblem(quantity) ?? plinthProblem(plinthCount)
  if (bad) return fail(bad)
  const { foundation, plinths, anchorageGroups, activities } = newFoundation(s, areaId, num, String(description), config?.groups ? null : plinthCount, quantity ?? 1)
  const made: ConstructionState = { ...s, foundations: [...s.foundations, foundation], plinths: [...s.plinths, ...plinths], anchorageGroups: [...(s.anchorageGroups ?? []), ...anchorageGroups], activities: [...s.activities, ...activities] }
  if (!config) return ok(made)
  const cfgBad = configProblem(made, foundation, config)
  if (cfgBad) return fail(cfgBad)
  const fresh = made.foundations.find((f) => f.id === foundation.id)!
  const withDims = { ...made, foundations: made.foundations.map((f) => (f.id === foundation.id ? { ...f, ...(config.footing ? { footing: config.footing } : {}), ...(config.plinthBase ? { plinthBase: config.plinthBase } : {}) } : f)) }
  const applied = config.groups ? applyGroups(withDims, { ...fresh }, config.groups) : withDims
  if (typeof applied === 'string') return fail(applied)
  return ok(config.bolts ? applyBolts(applied, applied.foundations.find((f) => f.id === foundation.id)!, config.bolts) : applied)
}

/** Renames a foundation. Its id, plinths, activities and every material, survey and QA/QC record that points at it are unaffected. */
export const renameFoundation = (id: string, number: string): Reducer => (s) => {
  const f = s.foundations.find((x) => x.id === id)
  if (!f) return fail('Foundation not found.')
  const num = String(number).trim()
  const bad = numberProblem(s, f.areaId, num, id)
  return bad ? fail(bad) : ok({ ...s, foundations: s.foundations.map((x) => (x.id === id ? { ...x, number: num } : x)) })
}


/**
 * Edits a foundation designation: description, notes, quantity and plinths per foundation. Changing quantity touches nothing else (materials, activities
 * and plinths are not affected). Changing plinths per foundation adds plinth records, or removes the highest-numbered ones only when nothing has been
 * recorded on them; otherwise it is refused.
 */
export const editFoundation = (id: string, patch: { description?: string; notes?: string; quantity?: number; plinthsPerFoundation?: number | null }): Reducer => (s) => {
  const f = s.foundations.find((x) => x.id === id)
  if (!f) return fail('Foundation not found.')
  const bad = (patch.quantity !== undefined ? quantityProblem(patch.quantity) : null) ?? (patch.plinthsPerFoundation !== undefined ? plinthProblem(patch.plinthsPerFoundation) : null)
  if (bad) return fail(bad)
  const qBad = patch.quantity !== undefined ? quantityBelowPours(s, id, patch.quantity) : null
  if (qBad) return fail(qBad)
  const next = {
    ...f,
    ...(patch.description !== undefined ? { description: String(patch.description).trim().slice(0, 300) } : {}),
    ...(patch.notes !== undefined ? { notes: String(patch.notes).slice(0, 2000) } : {}),
    ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
  }
  let base: ConstructionState = { ...s, foundations: s.foundations.map((x) => (x.id === id ? next : x)) }
  if (patch.plinthsPerFoundation !== undefined) {
    // The plinth count is the sum of the anchorage groups. This legacy shortcut works only while there is a single group (or none).
    const target = patch.plinthsPerFoundation
    const groups = groupsOf(s, id)
    const mine = s.plinths.filter((p) => p.foundationId === id)
    if (target === null) {
      if (mine.length > 0) return fail('This foundation already has plinth records, so the count cannot be set back to unknown. Enter the number of plinths.')
      base = { ...base, foundations: base.foundations.map((x) => (x.id === id ? { ...x, plinthsPerFoundation: null } : x)) }
    } else {
      if (groups.length > 1) return fail('This foundation has several anchorage groups. Change the number of plinths in each group instead.')
      const input = target === 0 ? [] : [{ id: groups[0]?.id, anchorageTypeId: groups[0]?.anchorageTypeId ?? null, count: target, dims: groups[0]?.dims ?? null }]
      const applied = applyGroups(base, next, input)
      if (typeof applied === 'string') return fail(applied)
      base = applied
      base = { ...base, foundations: base.foundations.map((x) => (x.id === id ? { ...x, plinthsPerFoundation: target } : x)) }
    }
  }
  return ok(base)
}

/**
 * Archiving hides a foundation from pickers and the default register view; every record stays and keeps pointing at it. It is refused while
 * active materials are assigned to the foundation (move or archive them first), and when materials cannot be checked.
 */
export const archiveFoundation = (id: string, archived: boolean): Reducer => (s, ctx) => {
  const f = s.foundations.find((x) => x.id === id)
  if (!f) return fail('Foundation not found.')
  if (archived) {
    if (!ctx?.materials) return fail('Materials could not be checked, so this foundation was not archived.')
    const used = [...ctx.materials.lines, ...ctx.materials.manual].filter((l) => !l.archived && l.foundationId === id).length
    if (used > 0) return fail(`${used} active material${used === 1 ? ' is' : 's are'} assigned to foundation ${f.number}. Move or archive them first.`)
  }
  return ok({ ...s, foundations: s.foundations.map((x) => (x.id === id ? { ...x, archived } : x)) })
}

export interface NewFoundation { number: string; description: string; /** Plinths on each foundation; null = not known. */ plinthCount: number | null; /** Physical foundations sharing this name. Absent = 1. */ quantity?: number }

/** Sets up a new construction area together with its foundations, so the register is complete from the start. */
export const createArea = (projectId: string, name: string, foundations: NewFoundation[], details: { identifier?: string; description?: string } = {}): Reducer => (s) => {
  if (!s.projects.some((p) => p.id === projectId)) return fail('Project not found.')
  const clean = String(name).trim().replace(/\s+/g, ' ')
  if (!clean || clean.length > 60) return fail('Enter an area name of 60 characters or fewer.')
  if (s.areas.some((a) => a.projectId === projectId && a.name.toLowerCase() === clean.toLowerCase())) return fail(`An area named ${clean} already exists.`)
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area'
  let id = `area-${slug}`
  for (let n = 2; s.areas.some((a) => a.id === id); n++) id = `area-${slug}-${n}`
  const area = { id, projectId, name: clean, identifier: String(details.identifier ?? '').trim().slice(0, 40), description: String(details.description ?? '').trim().slice(0, 300), sequence: Math.max(0, ...s.areas.filter((a) => a.projectId === projectId).map((a) => a.sequence)) + 1 }
  let next: ConstructionState = {
    ...s, areas: [...s.areas, area],
    handover: [...s.handover, { areaId: id, requirements: DEFAULT_HANDOVER_REQUIREMENTS.map((r, i) => ({ id: `${id}-req-${i + 1}`, label: r.label, metric: r.metric, done: false, doneDate: null, note: '' })), acceptance: 'not-submitted' as const, submittedDate: null, acceptedDate: null, acceptedBy: '', notes: '' }],
  }
  for (const f of foundations ?? []) {
    const num = String(f.number).trim()
    const bad = numberProblem(next, id, num) ?? quantityProblem(f.quantity) ?? plinthProblem(f.plinthCount)
    if (bad) return fail(bad)
    const made = newFoundation(next, id, num, String(f.description ?? ''), f.plinthCount, f.quantity ?? 1)
    next = { ...next, foundations: [...next.foundations, made.foundation], plinths: [...next.plinths, ...made.plinths], anchorageGroups: [...(next.anchorageGroups ?? []), ...made.anchorageGroups], activities: [...next.activities, ...made.activities] }
  }
  return ok(next)
}

/** Adds several foundations to one area at once (a whole register). All are checked first: every one is added or none is. */
export const addFoundations = (areaId: string, items: NewFoundation[]): Reducer => (s) => {
  if (!Array.isArray(items) || items.length === 0) return fail('Enter at least one foundation.')
  if (items.length > 200) return fail('Add 200 foundations or fewer at a time.')
  let next = s
  for (const [i, f] of items.entries()) {
    const num = String(f.number).trim()
    const bad = numberProblem(next, areaId, num) ?? quantityProblem(f.quantity) ?? plinthProblem(f.plinthCount)
    if (bad) return fail(`${items.length > 1 ? `Row ${i + 1}: ` : ''}${bad}`)
    const made = newFoundation(next, areaId, num, String(f.description ?? ''), f.plinthCount, f.quantity ?? 1)
    next = { ...next, foundations: [...next.foundations, made.foundation], plinths: [...next.plinths, ...made.plinths], anchorageGroups: [...(next.anchorageGroups ?? []), ...made.anchorageGroups], activities: [...next.activities, ...made.activities] }
  }
  return ok(next)
}

/* ── Organization, projects, areas, anchorage library (saved project data) ── */

const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const slug = (v: string, fallback: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isoDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())

export interface OrganizationInput { name: string; legalName?: string; location?: string; contactName?: string; contactEmail?: string; contactPhone?: string; website?: string; notes?: string }

function organizationFrom(input: Partial<OrganizationInput>, base: ConstructionState['company']): ConstructionState['company'] | string {
  const next = { ...base }
  if (input.name !== undefined) { const n = text(input.name, 80); if (n.length < 2) return 'Enter the organization name (at least 2 characters).'; next.name = n }
  const fields = { legalName: 80, location: 120, contactName: 80, contactEmail: 120, contactPhone: 40, website: 120, notes: 500 } as const
  for (const [k, max] of Object.entries(fields) as [keyof typeof fields, number][]) if (input[k] !== undefined) next[k] = text(input[k], max)
  if (next.contactEmail && !EMAIL.test(next.contactEmail)) return 'Enter a valid contact email address.'
  return next
}

/** Creates the organization. A new installation has none; only one can exist. */
export const createOrganization = (input: OrganizationInput): Reducer => (s) => {
  if (s.company.id) return fail('An organization already exists.')
  const company = organizationFrom(input, { id: `org-${slug(text(input.name, 80), 'organization')}`, name: '' })
  return typeof company === 'string' ? fail(company) : ok({ ...s, company })
}

export const updateOrganization = (patch: Partial<OrganizationInput>): Reducer => (s) => {
  if (!s.company.id) return fail('Create the organization first.')
  const company = organizationFrom(patch, s.company)
  return typeof company === 'string' ? fail(company) : ok({ ...s, company })
}

export interface ProjectInput { name: string; jobNumber?: string; client?: string; location?: string; description?: string; scope?: string; startDate?: string | null; endDate?: string | null; status?: ProjectStatus }
const STATUSES: ProjectStatus[] = ['planning', 'active', 'at-risk', 'delayed', 'on-hold', 'complete']

function projectProblem(s: ConstructionState, input: Partial<ProjectInput>, exceptId?: string): string | null {
  if (input.name !== undefined) {
    const n = text(input.name, 100)
    if (n.length < 2) return 'Enter the project name (at least 2 characters).'
    if (s.projects.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) return `A project named ${n} already exists.`
  }
  if (input.status !== undefined && !STATUSES.includes(input.status)) return 'Choose a project status.'
  for (const k of ['startDate', 'endDate'] as const) if (input[k] && !isoDate(input[k])) return 'Enter valid dates.'
  return null
}

/** Creates a project. Only the name is required; it starts with no areas, foundations, materials, assignments or progress. */
export const createProject = (input: ProjectInput): Reducer => (s) => {
  if (!s.company.id) return fail('Create the organization first.')
  const bad = projectProblem(s, input)
  if (bad) return fail(bad)
  if (input.startDate && input.endDate && input.endDate < input.startDate) return fail('The expected completion date is before the start date.')
  const name = text(input.name, 100)
  let id = `proj-${slug(name, 'project')}`
  for (let n = 2; s.projects.some((p) => p.id === id); n++) id = `proj-${slug(name, 'project')}-${n}`
  const project = {
    id, companyId: s.company.id, name, jobNumber: text(input.jobNumber, 40), client: text(input.client, 100), location: text(input.location, 120), scope: text(input.scope, 120), status: input.status ?? 'planning',
    statusNote: '', tracking: 'detailed' as const, reportedProgress: null, description: text(input.description, 500), startDate: input.startDate || null, endDate: input.endDate || null,
  }
  return ok({ ...s, projects: [...s.projects, project] })
}

export const updateProject = (id: string, patch: Partial<ProjectInput>): Reducer => (s) => {
  const p = s.projects.find((x) => x.id === id)
  if (!p) return fail('Project not found.')
  const bad = projectProblem(s, patch, id)
  if (bad) return fail(bad)
  const next = { ...p }
  if (patch.name !== undefined) next.name = text(patch.name, 100)
  for (const [k, max] of [['jobNumber', 40], ['client', 100], ['location', 120], ['scope', 120], ['description', 500]] as const) if (patch[k] !== undefined) next[k] = text(patch[k], max)
  if (patch.startDate !== undefined) next.startDate = patch.startDate || null
  if (patch.endDate !== undefined) next.endDate = patch.endDate || null
  if (patch.status !== undefined) next.status = patch.status
  if (next.startDate && next.endDate && next.endDate < next.startDate) return fail('The expected completion date is before the start date.')
  return ok({ ...s, projects: s.projects.map((x) => (x.id === id ? next : x)) })
}

/** Renames or describes an area. Its id, foundations and every record pointing at it are unaffected. */
export const editArea = (areaId: string, patch: { name?: string; identifier?: string; description?: string }): Reducer => (s) => {
  const a = s.areas.find((x) => x.id === areaId)
  if (!a) return fail('Area not found.')
  const next = { ...a }
  if (patch.name !== undefined) {
    const n = text(patch.name, 60)
    if (!n) return fail('Enter an area name of 60 characters or fewer.')
    if (s.areas.some((x) => x.id !== areaId && x.projectId === a.projectId && x.name.toLowerCase() === n.toLowerCase())) return fail(`An area named ${n} already exists.`)
    next.name = n
  }
  if (patch.identifier !== undefined) next.identifier = text(patch.identifier, 40)
  if (patch.description !== undefined) next.description = text(patch.description, 300)
  return ok({ ...s, areas: s.areas.map((x) => (x.id === areaId ? next : x)) })
}

/** Archiving hides an area from pickers and lists. Refused while active materials are assigned to it, and when materials cannot be checked. */
export const archiveArea = (areaId: string, archived: boolean): Reducer => (s, ctx) => {
  const a = s.areas.find((x) => x.id === areaId)
  if (!a) return fail('Area not found.')
  if (archived) {
    if (!ctx?.materials) return fail('Materials could not be checked, so this area was not archived.')
    const used = [...ctx.materials.lines, ...ctx.materials.manual].filter((l) => !l.archived && l.areaId === areaId).length
    if (used > 0) return fail(`${used} active material${used === 1 ? ' is' : 's are'} assigned to ${a.name}. Move or archive them first.`)
  }
  return ok({ ...s, areas: s.areas.map((x) => (x.id === areaId ? { ...x, archived } : x)) })
}

const ANCHORAGE_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/
const anchorageClash = (s: ConstructionState, projectId: string, code: string, exceptId?: string) => s.anchorageTypes.find((t) => t.id !== exceptId && (t.projectId ?? projectId) === projectId && t.code.toLowerCase() === code.toLowerCase())

/** Adds an anchorage type to the project's library. A code that already exists (even archived) is refused, so a definition is never duplicated. */
export const addAnchorageType = (projectId: string, code: string, description: string): Reducer => (s) => {
  if (!s.projects.some((p) => p.id === projectId)) return fail('Project not found.')
  const c = text(code, 40)
  if (!ANCHORAGE_CODE.test(c)) return fail('Enter an anchorage code using letters, digits, spaces, dots, dashes or slashes (for example AB-101).')
  const clash = anchorageClash(s, projectId, c)
  if (clash) return fail(`Anchorage type ${clash.code} already exists${clash.archived ? ' (archived — restore it instead)' : ''}.`)
  let id = `anc-${projectId}-${slug(c, 'type')}`
  for (let n = 2; s.anchorageTypes.some((t) => t.id === id); n++) id = `anc-${projectId}-${slug(c, 'type')}-${n}`
  return ok({ ...s, anchorageTypes: [...s.anchorageTypes, { id, projectId, code: c, description: text(description, 200), bolts: [], hardware: [] }] })
}

/** Renames or describes an anchorage type. Materials and plinths point at its id, so none are affected. */
export const editAnchorageType = (id: string, patch: { code?: string; description?: string }): Reducer => (s) => {
  const t = s.anchorageTypes.find((x) => x.id === id)
  if (!t) return fail('Anchorage type not found.')
  const next = { ...t }
  if (patch.code !== undefined) {
    const c = text(patch.code, 40)
    if (!ANCHORAGE_CODE.test(c)) return fail('Enter an anchorage code using letters, digits, spaces, dots, dashes or slashes.')
    if (t.projectId && anchorageClash(s, t.projectId, c, id)) return fail(`Anchorage type ${c} already exists.`)
    next.code = c
  }
  if (patch.description !== undefined) next.description = text(patch.description, 200)
  return ok({ ...s, anchorageTypes: s.anchorageTypes.map((x) => (x.id === id ? next : x)) })
}

export const archiveAnchorageType = (id: string, archived: boolean): Reducer => (s, ctx) => {
  const t = s.anchorageTypes.find((x) => x.id === id)
  if (!t) return fail('Anchorage type not found.')
  if (archived) {
    if (!ctx?.materials) return fail('Materials could not be checked, so this anchorage type was not archived.')
    const used = [...ctx.materials.lines, ...ctx.materials.manual].filter((l) => !l.archived && l.anchorageTypeId === id).length
    if (used > 0) return fail(`${used} active material${used === 1 ? ' uses' : 's use'} anchorage type ${t.code}. Change them first.`)
  }
  return ok({ ...s, anchorageTypes: s.anchorageTypes.map((x) => (x.id === id ? { ...x, archived } : x)) })
}

export { configureFoundation, setAnchorageComponents, setFoundationUnits, setPlinthDims } from './configActions'
export { addPourItems, cancelPour, completePour, createPour, recordPour, recordPourOverride, removePourItem, setPourActual, updatePour } from './pourActions'
