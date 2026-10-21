import { addDays } from '@/lib/date'
import { DEFAULT_HANDOVER_REQUIREMENTS, FOOTING_ACTIVITIES, PLINTH_ACTIVITIES, getDef } from './config'
import { effectiveStatus, getIndex } from './selectors'
import type {
  Activity, Allocation, AnchorageType, Area, BoltSpec, BulkMaterial, ConstructionState, Crew, Deficiency, Delivery, DocumentKind,
  DocumentRecord, FabricationRequest, Foundation, HandoverRecord, HardwareKind, HistoryEntry, ISODate, Person, Plinth,
  PlinthReady, POLine, PurchaseOrder, Supplier,
} from './types'

/**
 * Fictional demonstration data. Nothing here is verified project information.
 * From the brief: Mole Sieve 21-01 / 21-03 / 21-05 plinth 1 use OP1-02, and OP1-01 exists.
 * All other foundations, plinths, quantities, suppliers and dates are invented for the demo.
 */

const FOOT_SEQ = FOOTING_ACTIVITIES.map((d) => d.key) // layout … postInspection
const PLINTH_SEQ = PLINTH_ACTIVITIES.filter((d) => d.category !== 'materials').map((d) => d.key)

type FoundationSeed = [number: string, description: string, plinths: string[], fStep: number, pSteps: number[]]

const LAYOUT: Record<string, FoundationSeed[]> = {
  'mole-sieve': [
    ['21-01', 'Vessel pedestal', ['OP1-02'], 9, [8]],
    ['21-02', 'Vessel pedestal', ['OP1-01', 'OP1-01'], 9, [8, 6]],
    ['21-03', 'Skid support', ['OP1-02'], 9, [7]],
    ['21-04', 'Piping support', ['OP1-01', 'OP1-03'], 8, [3, 1]],
    ['21-05', 'Skid support', ['OP1-02'], 7, [0]],
    ['21-06', 'Piping support', ['OP1-01'], 6, [0]],
    ['21-07', 'Equipment support', ['OP1-03', 'OP1-03'], 5, [0, 0]],
    ['21-08', 'Equipment support', ['OP1-02', 'OP1-01'], 3, [0, 0]],
  ],
  'propane-bog': [
    ['22-01', 'Compressor foundation', ['OP2-01'], 9, [5]],
    ['22-02', 'Compressor foundation', ['OP2-01', 'OP2-01'], 8, [2, 1]],
    ['22-03', 'Vessel support', ['OP1-02'], 6, [0]],
    ['22-04', 'Cooler support', ['OP2-02'], 4, [0]],
    ['22-05', 'Pump foundation', ['OP2-01'], 3, [0]],
    ['22-06', 'Piping support', ['OP1-02', 'OP2-02'], 2, [0, 0]],
  ],
  piperack: [
    ['31-01', 'Pipe rack column', ['OP1-01'], 9, [6]],
    ['31-02', 'Pipe rack column', ['OP1-01'], 9, [5]],
    ['31-03', 'Pipe rack column', ['OP2-01'], 8, [3]],
    ['31-04', 'Pipe rack column', ['OP2-01'], 7, [0]],
    ['31-05', 'Braced frame column', ['OP2-02'], 6, [0]],
    ['31-06', 'Braced frame column', ['OP2-02'], 6, [0]],
    ['31-07', 'Braced frame column', ['OP2-02', 'OP1-01'], 5, [0, 0]],
    ['31-08', 'Braced frame column', ['OP2-02'], 4, [0]],
    ['31-09', 'Pipe rack column', ['OP2-01'], 3, [0]],
    ['31-10', 'Braced frame column', ['OP2-02'], 2, [0]],
    ['31-11', 'Pipe rack column', ['OP1-01', 'OP1-01'], 1, [0, 0]],
    ['31-12', 'Braced frame column', ['OP2-02'], 0, [0]],
  ],
  'locomotive-shelter': [
    ['41-01', 'Shelter column', ['OP3-01'], 6, [0]],
    ['41-02', 'Shelter column', ['OP3-01'], 5, [0]],
    ['41-03', 'Shelter column', ['OP3-01', 'OP3-01'], 3, [0, 0]],
    ['41-04', 'Door frame support', ['OP1-01'], 2, [0]],
    ['41-05', 'Door frame support', ['OP1-01'], 1, [0]],
    ['41-06', 'Shelter column', ['OP3-01'], 0, [0]],
  ],
  'e-house': [
    ['51-01', 'Building pier', ['OP3-01'], 2, [0]],
    ['51-02', 'Cable tray support', ['OP1-01'], 1, [0]],
    ['51-03', 'Building pier', ['OP3-01', 'OP1-01'], 0, [0, 0]],
    ['51-04', 'Transformer pad support', ['OP1-01'], 0, [0]],
  ],
}

const AREAS: [id: string, name: string][] = [
  ['mole-sieve', 'Mole Sieve'],
  ['propane-bog', 'Propane BOG'],
  ['piperack', 'Piperack'],
  ['locomotive-shelter', 'Locomotive Shelter'],
  ['e-house', 'E-House'],
]

const SUPPLIERS: Supplier[] = [
  { id: 'sup-fast', name: 'Northcoast Fastener Co.', category: 'Fasteners' },
  { id: 'sup-steel', name: 'Tidewater Steel Supply', category: 'Anchor rod & steel' },
  { id: 'sup-hw', name: 'Ridgeline Industrial Hardware', category: 'Hardware' },
  { id: 'sup-cnc', name: 'Cedar Ridge CNC Works', category: 'CNC fabrication' },
  { id: 'sup-cnc2', name: 'Harbour Millwork & Routing', category: 'CNC fabrication' },
]

const BOLT_SPECS: BoltSpec[] = [
  { id: 'BS-01', diameter: '3/4"', overallLength: 18, topThread: 4, bottomThread: 3, grade: 'ASTM F1554 Gr. 36' },
  { id: 'BS-02', diameter: '3/4"', overallLength: 24, topThread: 4, bottomThread: 3, grade: 'ASTM F1554 Gr. 36' },
  { id: 'BS-03', diameter: '1"', overallLength: 30, topThread: 5, bottomThread: 4, grade: 'ASTM F1554 Gr. 55' },
  { id: 'BS-04', diameter: '1"', overallLength: 36, topThread: 6, bottomThread: 4, grade: 'ASTM F1554 Gr. 55' },
  { id: 'BS-05', diameter: '1-1/4"', overallLength: 42, topThread: 6, bottomThread: 5, grade: 'ASTM F1554 Gr. 55' },
]

function anchorage(code: string, specId: string, bolts: number, size: string, nuts: number, washers: number): AnchorageType {
  return {
    id: code,
    code,
    description: `${bolts} × ${size} anchor bolts, hardware per bolt`,
    bolts: [{ specId, qtyPerPlinth: bolts }],
    hardware: [
      { kind: 'nut', size, qtyPerPlinth: nuts },
      { kind: 'washer', size, qtyPerPlinth: washers },
    ],
  }
}

const ANCHORAGE_TYPES: AnchorageType[] = [
  anchorage('OP1-01', 'BS-01', 8, '3/4"', 16, 8),
  anchorage('OP1-02', 'BS-02', 12, '3/4"', 24, 12),
  anchorage('OP1-03', 'BS-03', 8, '1"', 16, 8),
  anchorage('OP2-01', 'BS-03', 12, '1"', 24, 12),
  anchorage('OP2-02', 'BS-04', 12, '1"', 24, 12),
  anchorage('OP3-01', 'BS-05', 8, '1-1/4"', 16, 8),
]

const CREWS: Crew[] = [
  { id: 'crew-a', name: 'Crew A', offsetDays: 0 },
  { id: 'crew-b', name: 'Crew B', offsetDays: 7 },
  { id: 'crew-c', name: 'Crew C', offsetDays: 14 },
]

const PEOPLE: Person[] = [
  { id: 'coord', name: 'Project Coordinator', role: 'coordinator', crewId: null, offsetDays: null },
  { id: 'supt-1', name: 'Daniel Whitfield', role: 'superintendent', crewId: null, offsetDays: 0 },
  { id: 'supt-2', name: 'Priya Natarajan', role: 'superintendent', crewId: null, offsetDays: 11 },
  { id: 'fm-a', name: 'Tom Haldane', role: 'foreman', crewId: 'crew-a', offsetDays: null },
  { id: 'fm-b', name: 'Rosa Delgado', role: 'foreman', crewId: 'crew-b', offsetDays: null },
  { id: 'fm-c', name: 'Callum Reid', role: 'foreman', crewId: 'crew-c', offsetDays: null },
  ...[
    ['a', ['Eli Marchetti', 'Noah Okafor', 'Sam Dubois', 'Kai Tanaka']],
    ['b', ['Liam Brandt', 'Ava Lindqvist', 'Jon Ferreira', 'Mia Thorsen']],
    ['c', ['Isla Brouwer', 'Raj Mehta', 'Ben Archer', 'Lena Kowalski']],
  ].flatMap(([c, names]) =>
    (names as string[]).map((name, i): Person => ({ id: `cp-${c}${i + 1}`, name, role: 'carpenter', crewId: `crew-${c}`, offsetDays: null })),
  ),
  { id: 'sv-1', name: 'Hannah Brooks', role: 'surveyor', crewId: null, offsetDays: null },
  { id: 'sv-2', name: 'Owen Pike', role: 'surveyor', crewId: null, offsetDays: null },
  { id: 'qc-1', name: 'Grace Ito', role: 'qc-inspector', crewId: null, offsetDays: null },
  { id: 'qc-2', name: 'Victor Lam', role: 'qc-inspector', crewId: null, offsetDays: null },
]

const FOREMEN = ['fm-a', 'fm-b', 'fm-c']
const SURVEYORS = ['sv-1', 'sv-2']
const INSPECTORS = ['qc-1', 'qc-2']

export function buildSeed(today: ISODate): ConstructionState {
  let counter = 0
  const uid = (p: string) => `${p}-${++counter}`

  const areas: Area[] = AREAS.map(([id, name], i) => ({ id, projectId: 'reef', name, sequence: i + 1 }))
  const foundations: Foundation[] = []
  const plinths: Plinth[] = []
  const activities: Activity[] = []
  const documents: DocumentRecord[] = []

  const doc = (title: string, kind: DocumentKind, revision: string, date: ISODate): string => {
    const id = `DOC-${String(documents.length + 1).padStart(3, '0')}`
    documents.push({ id, title: `${title} (demonstration placeholder)`, kind, revision, date })
    return id
  }

  /* ── Foundations, plinths, activities ─────────────────────────────── */
  const steps = new Map<string, number>() // plinthId → completed step count
  const footingSteps = new Map<string, number>()
  let n = 0

  for (const area of areas) {
    for (const [number, description, plinthTypes, fStep, pSteps] of LAYOUT[area.id]) {
      n++
      const off = n % 7
      const stagger = n * 2 // later foundations are scheduled further out
      const foundation: Foundation = { id: `f-${number}`, areaId: area.id, number, description, notes: '', docIds: [] }
      foundations.push(foundation)
      footingSteps.set(foundation.id, fStep)

      const make = (scope: 'footing' | 'plinth', key: string, plinthId: string | null, status: Activity['status'], planned: ISODate | null, actual: ISODate | null, assignee: string | null, notes = ''): Activity => ({
        id: `${plinthId ?? foundation.id}:${key}`, key, scope, foundationId: foundation.id, plinthId, status, plannedDate: planned, actualDate: actual, assigneeId: assignee, notes, docIds: [],
      })

      const sequence = (scope: 'footing' | 'plinth', seq: string[], step: number, plinthId: string | null, lead: number, spacing: number) => {
        seq.forEach((key, k) => {
          const def = getDef(scope, key)
          const isInspection = def.statusSet === 'qaqc'
          let status: Activity['status'] = 'not-started'
          let planned: ISODate | null
          let actual: ISODate | null = null
          if (k < step) {
            status = isInspection ? 'approved' : 'complete'
            actual = addDays(today, -((step - k) * spacing + off))
            planned = addDays(actual, [0, -1, 1, 0, 2, -2][k % 6])
          } else {
            planned = addDays(today, (k - step) * spacing + 1 + (off % 3) + lead + stagger)
            if (k === step && step > 0) {
              status = isInspection ? 'pending-review' : 'in-progress'
              planned = addDays(today, (off % 5) - 2 + (lead > 0 ? lead : 0))
            }
          }
          const pool = def.category === 'survey' ? SURVEYORS : isInspection ? INSPECTORS : FOREMEN
          const assignee = status === 'not-started' ? null : pool[(n + k) % pool.length]
          activities.push(make(scope, key, plinthId, status, planned, actual, assignee))
        })
      }

      sequence('footing', FOOT_SEQ, fStep, null, 0, 3)

      plinthTypes.forEach((typeId, i) => {
        const plinth: Plinth = { id: `p-${number}-${i + 1}`, foundationId: foundation.id, index: i + 1, anchorageTypeId: typeId, notes: '' }
        plinths.push(plinth)
        const pStep = pSteps[i]
        steps.set(plinth.id, pStep)
        const lead = fStep < 7 ? (7 - fStep) * 3 : 0
        sequence('plinth', PLINTH_SEQ, pStep, plinth.id, lead, 2)
        // Materials activities: statuses for bolts / nuts / washers / templates are derived at read time.
        const matPlanned = addDays(today, Math.max(2, lead - 4) + off)
        for (const def of PLINTH_ACTIVITIES.filter((d) => d.category === 'materials')) {
          const manualStatus: Activity['status'] = def.key === 'solePlates' ? (pStep >= 2 ? 'complete' : fStep >= 5 ? 'in-progress' : 'not-started') : 'not-started'
          const done = manualStatus === 'complete'
          activities.push(make('plinth', def.key, plinth.id, manualStatus, done ? addDays(today, -(pStep * 2 + 6)) : matPlanned, done ? addDays(today, -(pStep * 2 + 6)) : null, null))
        }
      })
    }
  }

  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))
  const plinthMap = byId(plinths)
  const typeMap = byId(ANCHORAGE_TYPES)
  const areaOfPlinth = (p: Plinth) => foundations.find((f) => f.id === p.foundationId)!.areaId
  const fStepOf = (p: Plinth) => footingSteps.get(p.foundationId)!

  // One demonstration block: forming held by an unresolved site condition.
  const blocked = activities.find((a) => a.id === 'f-21-08:formed')
  if (blocked) {
    blocked.status = 'blocked'
    blocked.notes = 'Forming held — underground utility locate not yet confirmed (demonstration note).'
  }

  // Placeholder inspection records for the most advanced area.
  for (const f of foundations.filter((x) => x.areaId === 'mole-sieve')) {
    const pre = activities.find((a) => a.id === `${f.id}:preInspection`)
    if (pre && pre.status === 'approved' && pre.actualDate) {
      const d = doc(`Pre-pour inspection record — ${f.number}`, 'inspection', '0', pre.actualDate)
      pre.docIds.push(d)
      f.docIds.push(d)
    }
  }

  /* ── Anchor bolt procurement, receiving, allocation ───────────────── */
  const allocations: Allocation[] = []
  const plinthReady: PlinthReady[] = []
  const purchaseOrders: PurchaseOrder[] = []
  const deliveries: Delivery[] = []
  const poLine = (poId: string, kind: POLine['kind'], itemId: string, qty: number): POLine => ({ id: `${poId}-L${itemId}`, kind, itemId, qtyOrdered: qty })

  const po1: PurchaseOrder = { id: 'po-0101', number: 'PO-928-0101', supplierId: 'sup-fast', status: 'issued', issuedDate: addDays(today, -45), expectedDate: addDays(today, -21), notes: 'Anchor bolts — set 1 (demonstration)', lines: [] }
  const po2: PurchaseOrder = { id: 'po-0102', number: 'PO-928-0102', supplierId: 'sup-steel', status: 'issued', issuedDate: addDays(today, -30), expectedDate: addDays(today, -6), notes: 'Anchor bolts — set 2 (demonstration)', lines: [] }
  const po3: PurchaseOrder = { id: 'po-0103', number: 'PO-928-0103', supplierId: 'sup-steel', status: 'draft', issuedDate: null, expectedDate: null, notes: 'Top-up of 1" × 30" bolts — not yet issued', lines: [] }
  purchaseOrders.push(po1, po2, po3)

  const received: Record<string, number> = {}
  for (const spec of BOLT_SPECS) {
    const users = plinths
      .map((p) => ({ p, qty: typeMap.get(p.anchorageTypeId!)!.bolts.find((b) => b.specId === spec.id)?.qtyPerPlinth ?? 0 }))
      .filter((x) => x.qty > 0)
    const required = users.reduce((s, x) => s + x.qty, 0)
    const must = users.filter((x) => steps.get(x.p.id)! >= 2)
    const mustQty = must.reduce((s, x) => s + x.qty, 0)

    let ordered = 0
    let recv = 0
    if (spec.id === 'BS-01') { recv = required + 4; ordered = recv }
    else if (spec.id === 'BS-02') { ordered = required; recv = mustQty + Math.round(0.5 * (required - mustQty)) }
    else if (spec.id === 'BS-03') { ordered = Math.max(Math.ceil(0.75 * required), mustQty + 12); recv = Math.min(ordered, mustQty + 8) }
    else if (spec.id === 'BS-04') { ordered = required; recv = 0 }
    received[spec.id] = recv

    if (ordered > 0) (['BS-01', 'BS-02'].includes(spec.id) ? po1 : po2).lines.push(poLine(['BS-01', 'BS-02'].includes(spec.id) ? po1.id : po2.id, 'bolt', spec.id, ordered))
    if (spec.id === 'BS-03' && required > ordered) po3.lines.push(poLine(po3.id, 'bolt', spec.id, required - ordered))

    // Allocation: plinths already forming get their full set and are marked ready; spare stock is sorted to the next plinths.
    // Part of a skid is left sorted but unallocated, so allocation can be demonstrated.
    const reserve = spec.id === 'BS-02' ? 12 : 0
    let pool = recv
    const ordering = [...must, ...users.filter((x) => !must.includes(x)).sort((a, b) => steps.get(b.p.id)! - steps.get(a.p.id)! || fStepOf(b.p) - fStepOf(a.p))]
    for (const { p, qty } of ordering) {
      const isMust = must.some((m) => m.p.id === p.id)
      const take = Math.min(qty, isMust ? pool : Math.max(0, pool - reserve))
      if (take <= 0) continue
      pool -= take
      const when = addDays(today, -(steps.get(p.id)! * 2 + 3))
      allocations.push({ id: uid('al'), itemType: 'bolt', itemId: spec.id, plinthId: p.id, qty: take, date: when })
      if (must.some((m) => m.p.id === p.id) && !plinthReady.some((r) => r.plinthId === p.id)) plinthReady.push({ plinthId: p.id, date: when })
    }
  }
  // A plinth is only "ready" if everything it needs from bolts is allocated; drop any that are not.
  for (let i = plinthReady.length - 1; i >= 0; i--) {
    const p = plinthMap.get(plinthReady[i].plinthId)!
    const ok = typeMap.get(p.anchorageTypeId!)!.bolts.every((b) => allocations.filter((a) => a.itemType === 'bolt' && a.itemId === b.specId && a.plinthId === p.id).reduce((s, a) => s + a.qty, 0) >= b.qtyPerPlinth)
    if (!ok) plinthReady.splice(i, 1)
  }

  const split = (total: number, first: number) => [Math.round(total * first), total - Math.round(total * first)]
  const d1: Delivery = { id: 'del-0001', number: 'DEL-0001', poId: po1.id, receivedDate: addDays(today, -38), reference: 'SKID-0412', receivedBy: 'Project Coordinator', notes: 'First skid — sorted on site over two days.', lines: [] }
  const d2: Delivery = { id: 'del-0002', number: 'DEL-0002', poId: po1.id, receivedDate: addDays(today, -24), reference: 'SKID-0455', receivedBy: 'Project Coordinator', notes: 'Second skid.', lines: [] }
  const d3: Delivery = { id: 'del-0003', number: 'DEL-0003', poId: po2.id, receivedDate: addDays(today, -12), reference: 'SKID-0471', receivedBy: 'Project Coordinator', notes: 'Partial shipment; balance to follow.', lines: [] }
  const dl = (poId: string, spec: string, shipped: number, got: number, note = ''): Delivery['lines'][number] => ({ id: `${poId}-D${spec}-${shipped}-${got}`, poLineId: `${poId}-L${spec}`, qtyShipped: shipped, qtyReceived: got, note, resolved: false })
  {
    const [a1, a2] = split(received['BS-01'], 0.6)
    d1.lines.push(dl(po1.id, 'BS-01', a1, a1)); d2.lines.push(dl(po1.id, 'BS-01', a2, a2))
    const [b1, b2] = split(received['BS-02'], 0.6)
    d1.lines.push(dl(po1.id, 'BS-02', b1, b1))
    d2.lines.push(dl(po1.id, 'BS-02', b2 + 6, b2, 'Packing slip lists 6 more than counted on site — supplier notified (demonstration).'))
    d3.lines.push(dl(po2.id, 'BS-03', received['BS-03'], received['BS-03']))
  }
  deliveries.push(...[d1, d2, d3].filter((d) => d.lines.some((l) => l.qtyReceived > 0)))

  /* ── Bulk hardware (nuts & washers) ───────────────────────────────── */
  const bulkMaterials: BulkMaterial[] = []
  const bulkProfile: Record<string, { order: number; recv: number; poNo: string; expected: number }> = {
    'mole-sieve': { order: 1, recv: 0.6, poNo: '0110', expected: 8 },
    'propane-bog': { order: 1, recv: 0, poNo: '0111', expected: 3 },
    piperack: { order: 1, recv: 1, poNo: '0112', expected: -10 },
  }
  for (const area of areas) {
    const areaPlinths = plinths.filter((p) => areaOfPlinth(p) === area.id)
    const combos = new Map<string, { kind: HardwareKind; size: string; demand: number; must: number }>()
    for (const p of areaPlinths) {
      for (const h of typeMap.get(p.anchorageTypeId!)!.hardware) {
        const k = `${h.kind}:${h.size}`
        const c = combos.get(k) ?? { kind: h.kind, size: h.size, demand: 0, must: 0 }
        c.demand += h.qtyPerPlinth
        if (steps.get(p.id)! >= 2) c.must += h.qtyPerPlinth
        combos.set(k, c)
      }
    }
    const profile = bulkProfile[area.id]
    const po: PurchaseOrder | null = profile
      ? { id: `po-${profile.poNo}`, number: `PO-928-${profile.poNo}`, supplierId: 'sup-hw', status: 'issued', issuedDate: addDays(today, -28), expectedDate: addDays(today, profile.expected), notes: `${area.name} nuts and washers (demonstration)`, lines: [] }
      : null
    const del: Delivery | null = po ? { id: `del-${po.id.slice(3)}`, number: `DEL-${po.id.slice(3)}`, poId: po.id, receivedDate: addDays(today, -14), reference: `HW-${po.id.slice(3)}`, receivedBy: 'Project Coordinator', notes: '', lines: [] } : null
    for (const c of combos.values()) {
      const sample = area.id === 'mole-sieve' && c.kind === 'nut' && c.size === '3/4"'
      const requiredQty = sample ? 700 : Math.ceil((c.demand * 1.15) / 10) * 10
      const item: BulkMaterial = {
        id: `bm-${area.id}-${c.kind}-${c.size.replace(/\W/g, '')}`, areaId: area.id, kind: c.kind, size: c.size, requiredQty, sample,
        description: c.kind === 'nut' ? `Heavy hex nut ${c.size}` : `Flat washer ${c.size}`,
        grade: c.kind === 'nut' ? 'ASTM A563 Gr. A' : 'ASTM F436',
      }
      bulkMaterials.push(item)
      if (!po || !del) continue
      const got = Math.max(Math.round(profile.recv * requiredQty), c.must)
      po.lines.push(poLine(po.id, 'bulk', item.id, Math.max(requiredQty, got)))
      if (got > 0) del.lines.push({ id: `${del.id}-${item.id}`, poLineId: `${po.id}-L${item.id}`, qtyShipped: got, qtyReceived: got, note: '', resolved: false })
      // Allocate to plinths that are already forming, then to the next-up plinths while stock lasts.
      let pool = got
      const targets = areaPlinths
        .filter((p) => typeMap.get(p.anchorageTypeId!)!.hardware.some((h) => h.kind === c.kind && h.size === c.size))
        .sort((a, b) => steps.get(b.id)! - steps.get(a.id)! || fStepOf(b) - fStepOf(a))
      for (const p of targets) {
        const need = typeMap.get(p.anchorageTypeId!)!.hardware.filter((h) => h.kind === c.kind && h.size === c.size).reduce((s, h) => s + h.qtyPerPlinth, 0)
        const advanced = steps.get(p.id)! >= 2 || fStepOf(p) >= 8
        if (!advanced || pool < need) continue
        pool -= need
        allocations.push({ id: uid('al'), itemType: 'bulk', itemId: item.id, plinthId: p.id, qty: need, date: addDays(today, -(steps.get(p.id)! * 2 + 3)) })
      }
    }
    if (po && del) {
      purchaseOrders.push(po)
      if (del.lines.length) deliveries.push(del)
    }
  }

  /* ── Custom fabrication: plywood templates ────────────────────────── */
  const fabrication: FabricationRequest[] = []
  const groups = new Map<string, Plinth[]>()
  for (const p of plinths) {
    const k = `${areaOfPlinth(p)}|${p.anchorageTypeId}`
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  const rotation = ['cutting', 'authPending', 'review', 'revisions', 'quote', 'ready', 'cutting'] as const
  let nonReceived = 0
  let seq = 0
  for (const [key, members] of groups) {
    const [areaId, typeId] = key.split('|')
    seq++
    const advanced = members.some((p) => steps.get(p.id)! >= 2)
    const profile = advanced ? 'received' : rotation[nonReceived++ % rotation.length]
    const area = areas.find((a) => a.id === areaId)!
    const supplierId = seq % 2 ? 'sup-cnc' : 'sup-cnc2'
    const number = `FAB-928-${String(seq).padStart(3, '0')}`
    const reusable = seq % 5 === 0 && members.length > 2
    const history: HistoryEntry[] = []
    const log = (daysAgo: number, text: string) => history.push({ id: `${number}-h${history.length + 1}`, date: addDays(today, -daysAgo), by: 'Project Coordinator', text })
    const originalDesignDocId = doc(`Template layout ${typeId} — original design, ${area.name}`, 'design', 'A', addDays(today, -60 + seq))
    log(60 - seq, 'Original template design prepared and issued to supplier for quotation.')
    const base = { approval: 'not-submitted', authorization: 'pending', fabrication: 'not-started', pickup: 'not-ready', siteReceipt: 'pending' } as const
    let state: Pick<FabricationRequest, 'approval' | 'authorization' | 'fabrication' | 'pickup' | 'siteReceipt'>
    let revision = 'A'
    let drawing: string | null = null
    let quote: FabricationRequest['quotation'] = { reference: '', amount: null, date: null }
    let expectedDate: ISODate | null = null
    let receivedDate: ISODate | null = null
    const withDrawing = (rev: string, daysAgo: number) => {
      drawing = doc(`Supplier drawing — ${typeId} templates Rev ${rev}`, 'drawing', rev, addDays(today, -daysAgo))
      quote = { reference: `Q-${number.slice(-3)}`, amount: 900 + members.length * 140, date: addDays(today, -daysAgo) }
    }
    if (profile === 'quote') { state = { ...base, approval: 'quote-requested' }; log(5, 'Quotation requested from supplier.') }
    else if (profile === 'review') { withDrawing('A', 6); state = { ...base, approval: 'under-review' }; log(8, 'Quotation requested.'); log(6, 'Supplier returned proposed drawing Rev A and quotation.') }
    else if (profile === 'revisions') { withDrawing('A', 9); revision = 'A'; state = { ...base, approval: 'revisions-requested' }; log(11, 'Quotation requested.'); log(9, 'Supplier drawing Rev A received.'); log(4, 'Revisions requested: hole pattern offset to be rechecked against the anchorage type.') }
    else if (profile === 'authPending') { withDrawing('B', 10); revision = 'B'; state = { ...base, approval: 'approved' }; log(14, 'Quotation requested.'); log(10, 'Supplier drawing Rev B received.'); log(3, 'Drawing approved for fabrication of templates (not a construction approval). Purchase authorization pending.') }
    else {
      withDrawing('B', 24); revision = 'B'
      log(30, 'Quotation requested.'); log(24, 'Supplier drawing Rev B received.'); log(20, 'Drawing approved; purchase authorized.')
      state = { ...base, approval: 'approved', authorization: 'authorized', fabrication: 'cutting' }
      expectedDate = addDays(today, 4); log(6, 'Supplier started CNC cutting.')
      if (profile === 'ready') { state = { ...state, authorization: 'paid', fabrication: 'complete', pickup: 'ready' }; expectedDate = addDays(today, -1); log(1, 'Templates complete; ready for pickup.') }
      if (profile === 'received') {
        state = { approval: 'approved', authorization: 'paid', fabrication: 'complete', pickup: 'collected', siteReceipt: 'received' }
        expectedDate = addDays(today, -26); receivedDate = addDays(today, -23)
        log(25, 'Templates complete; ready for pickup.'); log(24, 'Collected and transported to site.'); log(23, 'Received on site and available for installation.')
      }
    }
    fabrication.push({
      id: `fab-${seq}`, number, title: `${typeId} anchor bolt templates — ${area.name}`, areaId, anchorageTypeId: typeId, supplierId,
      quantity: reusable ? 2 : members.length, reuse: reusable ? 'reusable' : advanced || seq % 3 ? 'single-use' : 'to-be-confirmed',
      plinthIds: members.map((p) => p.id), originalDesignDocId, supplierDrawingDocId: drawing, revision, quotation: quote,
      ...state, expectedDate, receivedDate, notes: '', history,
    })
  }

  /* ── Deficiencies, handover, workforce ────────────────────────────── */
  const defect = (areaNumber: string, title: string, severity: Deficiency['severity'], status: Deficiency['status'], ago: number): Deficiency => {
    const f = foundations.find((x) => x.number === areaNumber)!
    return { id: uid('def'), areaId: f.areaId, foundationId: f.id, plinthId: null, title, severity, status, raised: addDays(today, -ago), closed: status === 'closed' ? addDays(today, -Math.max(1, ago - 5)) : null }
  }
  const deficiencies: Deficiency[] = [
    defect('21-01', 'Minor surface honeycombing on east face — patch required', 'minor', 'open', 12),
    defect('21-03', 'Anchor bolt projection outside tolerance — re-survey required', 'major', 'open', 6),
    defect('22-01', 'Possible cold joint at pour interface — QC to confirm', 'minor', 'open', 9),
    defect('31-01', 'Grout pad rework at column base', 'minor', 'closed', 20),
  ]

  const handover: HandoverRecord[] = areas.map((a) => ({
    areaId: a.id,
    requirements: DEFAULT_HANDOVER_REQUIREMENTS.map((r, i) => ({ id: `${a.id}-req-${i + 1}`, label: r.label, metric: r.metric, done: false, doneDate: null, note: '' })),
    acceptance: 'not-submitted', submittedDate: null, acceptedDate: null, acceptedBy: '',
    notes: 'Handover checklist is a placeholder until the REEF requirements are defined.',
  }))

  const state: ConstructionState = {
    company: { id: 'progressive', name: 'Progressive' },
    projects: [{ id: 'reef', companyId: 'progressive', name: 'REEF', jobNumber: '928', location: 'Ridley Island, British Columbia', scope: 'Concrete Foundations' }],
    areas, foundations, plinths, boltSpecs: BOLT_SPECS, anchorageTypes: ANCHORAGE_TYPES, bulkMaterials, suppliers: SUPPLIERS,
    purchaseOrders, deliveries, allocations, plinthReady, fabrication, activities, documents, deficiencies, handover,
    crews: CREWS, people: PEOPLE, rotationAnchor: addDays(today, -5),
  }

  // Derived material activities that are already complete take their dates from the underlying records.
  const idx = getIndex(state)
  for (const p of plinths) {
    const acts = idx.activitiesByOwner.get(p.id) ?? []
    const finish = (key: string, date: ISODate | undefined) => {
      const a = acts.find((x) => x.key === key)
      if (a && date && effectiveStatus(idx, a) === 'complete') {
        a.actualDate = date
        a.plannedDate = addDays(date, -2)
      }
    }
    const latest = (kind: HardwareKind) =>
      allocations.filter((a) => a.itemType === 'bulk' && a.plinthId === p.id && idx.bulk.get(a.itemId)?.kind === kind).map((a) => a.date).sort().at(-1)
    finish('anchorBolts', idx.ready.get(p.id)?.date)
    finish('nuts', latest('nut'))
    finish('washers', latest('washer'))
    finish('templates', (idx.fabByPlinth.get(p.id) ?? []).find((r) => r.receivedDate)?.receivedDate ?? undefined)
  }
  return state
}
