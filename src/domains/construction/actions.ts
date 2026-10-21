import { addDays, type ISODate } from '@/lib/date'
import { getDef, isDone } from './config'
import { areaOfPlinth, boltsFullyAllocated, getIndex, plinthBoltRequirements, plinthHardware, qty } from './selectors'
import type {
  ProjectIssue, ProjectStatus, Activity, AutoMetric, ConstructionState, Deficiency, DocumentKind, FabricationRequest, HandoverRequirement, HistoryEntry, POLine, PurchaseOrder,
} from './types'

/** A reducer returns the next state, or an error message when a business rule is violated. */
export type Result = { state: ConstructionState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: ConstructionState) => Result

const ok = (state: ConstructionState): Result => ({ state })
const fail = (error: string): Result => ({ error })

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

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
  const number = `PO-928-${String(100 + s.purchaseOrders.length + 1).padStart(4, '0')}`
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
  const number = `FAB-928-${String(s.fabrication.length + 1).padStart(3, '0')}`
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
