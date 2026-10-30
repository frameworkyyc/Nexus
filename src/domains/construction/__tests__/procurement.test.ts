/* eslint-disable prefer-const -- fixtures where only some bindings are reassigned */
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { areaTree, consolidate, entryNotes, materialLabel } from '../tracker/consolidate'
import { procurementRows, procStatus } from '../tracker/procurement'
import { expectedTotals, refreshRequirements } from '../tracker/requirements'
import { emptyTracker, type TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'

const TODAY = '2026-10-30'
const NOW = '2026-10-30T12:00:00Z'
function build(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const ctx = (c: ConstructionState, actor = 'jo@example.com') => ({ construction: c, actor, now: NOW })
function run(t: TrackerState, c: ConstructionState, r: A.Reducer, actor?: string): TrackerState { const o = r(t, ctx(c, actor)); if (o.error !== undefined) throw new Error(o.error); return o.state }
const fails = (t: TrackerState, c: ConstructionState, r: A.Reducer) => r(t, ctx(c)).error

/**
 * E-House has two foundation designs (OP-1 ×12 with 3 plinths of A, OP-2 ×4 with 2 plinths of A and 1 of B). Type A: 4 × M25 × 900 bolts with
 * 2 nuts + 2 washers each, 1 template. Type B: 2 of the same bolts. Pipe Rack has one foundation of type A. Bolts are identical across both designs.
 */
function world() {
  let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  c = build(c, K.createOrganization({ name: 'Northline' }))
  c = build(c, K.createProject({ name: 'P1' }))
  const pid = c.projects[0].id
  c = build(c, K.createArea(pid, 'E-House', []))
  c = build(c, K.createArea(pid, 'Pipe Rack', []))
  c = build(c, K.addAnchorageType(pid, 'A', 'Type A'))
  c = build(c, K.addAnchorageType(pid, 'B', 'Type B'))
  const [A1, B1] = c.anchorageTypes.map((t) => t.id)
  const bolt = (qty: number) => ({ kind: 'bolt' as const, qty, diameter: 'M25', length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 })
  c = build(c, K.setAnchorageComponents(A1, [bolt(4), { kind: 'template', qty: 1, spec: '19 mm plywood' }]))
  c = build(c, K.setAnchorageComponents(B1, [bolt(2)]))
  const [eh, pr] = c.areas.map((a) => a.id)
  c = build(c, K.createFoundation(eh, 'OP-1', '', null, 12, { groups: [{ anchorageTypeId: A1, count: 3 }] }))
  c = build(c, K.createFoundation(eh, 'OP-2', '', null, 4, { groups: [{ anchorageTypeId: A1, count: 2 }, { anchorageTypeId: B1, count: 1 }] }))
  c = build(c, K.createFoundation(pr, 'PR-1', '', null, 5, { groups: [{ anchorageTypeId: A1, count: 1 }] }))
  const [f1, f2, f3] = c.foundations.map((f) => f.id)
  return { c, A1, B1, eh, pr, f1, f2, f3 }
}
const tracked = (c: ConstructionState) => refreshRequirements(emptyTracker(), c, { log: true, at: NOW })
const rowOf = (t: TrackerState, c: ConstructionState, area: string, name: string) => procurementRows(t, c).find((r) => r.area === area && r.name === name && r.category !== 'other')!

describe('consolidated materials', () => {
  it('groups identical materials in an area across all foundations, and keeps different specifications apart', () => {
    const { c } = world()
    const t = tracked(c)
    const g = consolidate(t, c)
    const bolts = g.filter((x) => x.area === 'E-House' && x.category === 'bolt')
    // 12×3 + 4×2 = 44 anchorages of A (×4 bolts) and 4×1 of B (×2 bolts): one line of 44*4 + 4*2 = 184 bolts.
    expect(bolts).toHaveLength(1)
    expect(bolts[0].required).toBe(184)
    expect(g.find((x) => x.area === 'E-House' && x.category === 'nut')!.required).toBe(368)
    expect(g.find((x) => x.area === 'Pipe Rack' && x.category === 'bolt')!.required).toBe(20)
    // The tree is Area → Category → Specification.
    const tree = areaTree(g)
    expect(tree.map((a) => a.name)).toEqual(['E-House', 'Pipe Rack'])
    expect(tree[0].categories.map((x) => x.label)).toEqual(['Anchor bolts', 'Nuts', 'Washers', 'Plywood templates'])
  })

  it('traces a total to the foundations and anchorage types behind it', () => {
    const { c, f1, f2 } = world()
    const bolts = consolidate(tracked(c), c).find((x) => x.area === 'E-House' && x.category === 'bolt')!
    const by = (f: string, code: string) => bolts.contributions.find((x) => x.foundationId === f && x.anchorage === code)?.qty
    expect(by(f1, 'A')).toBe(12 * 3 * 4)
    expect(by(f2, 'A')).toBe(4 * 2 * 4)
    expect(by(f2, 'B')).toBe(4 * 1 * 2)
    expect(bolts.contributions.reduce((a, x) => a + x.qty, 0)).toBe(bolts.required)
  })

  it('updates when foundation quantities or anchorage configurations change', () => {
    let { c, A1, f1 } = world()
    let t = tracked(c)
    c = build(c, K.configureFoundation(f1, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(consolidate(t, c).find((x) => x.area === 'E-House' && x.category === 'bolt')!.required).toBe((20 * 3 + 8) * 4 + 8)
    c = build(c, K.setAnchorageComponents(A1, [{ kind: 'bolt', qty: 6, diameter: 'M25', length: 900, lengthUnit: 'mm', thread: 'both-ends', topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }]))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(consolidate(t, c).find((x) => x.area === 'E-House' && x.category === 'bolt')!.required).toBe((20 * 3 + 8) * 6 + 8)
  })

  it('combines a manually entered identical material with the calculated one without duplicating records', () => {
    const { c, eh, f1 } = world()
    let t = tracked(c)
    const calc = consolidate(t, c).find((x) => x.area === 'E-House' && x.category === 'bolt')!
    t = run(t, c, A.addMaterials([{ areaId: eh, foundationId: f1, category: 'bolt', name: 'Anchor bolt', specification: calc.specification, size: '', unit: 'ea', requiredQty: 10, basis: 'fixed' } as never]))
    const g = consolidate(t, c).filter((x) => x.area === 'E-House' && x.category === 'bolt')
    expect(g).toHaveLength(1)
    expect(g[0].required).toBe(194)
    expect(new Set(g[0].contributions.map((x) => x.source))).toEqual(new Set(['calculated', 'entered']))
  })
})

describe('procurement', () => {
  it('statuses follow what is ordered and received', () => {
    expect(procStatus(100, 0, 0)).toBe('pending')
    expect(procStatus(100, 100, 0)).toBe('ordered')
    expect(procStatus(100, 100, 40)).toBe('partial')
    expect(procStatus(100, 100, 100)).toBe('received')
    expect(procStatus(100, 120, 120)).toBe('received')
    expect(procStatus(100, 0, 30)).toBe('partial')
  })

  it('orders several materials under one purchase order and receives them in bulk, once', () => {
    const { c } = world()
    let t = tracked(c)
    const bolts = rowOf(t, c, 'E-House', 'Anchor bolt'), nuts = rowOf(t, c, 'E-House', 'Nut')
    expect(bolts.status).toBe('pending')
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-1001', supplier: 'Nucor', date: TODAY, lines: [{ key: bolts.key, qty: bolts.required }, { key: nuts.key, qty: nuts.required }] }, TODAY))
    expect(t.orders).toHaveLength(1)
    expect(t.orderLines).toHaveLength(2)
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ ordered: 184, received: 0, outstanding: 184, status: 'ordered' })
    const po = t.orders![0]
    // One delivery of part of the bolts and all the nuts.
    t = run(t, c, A.recordDelivery({ orderId: po.id, date: TODAY, reference: 'DN-7', lines: [{ key: bolts.key, qty: 100 }, { key: nuts.key, qty: nuts.required }] }, TODAY), 'sam@example.com')
    expect(t.deliveries![0]).toMatchObject({ by: 'sam@example.com', at: NOW, reference: 'DN-7' })
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 100, outstanding: 84, status: 'partial' })
    expect(rowOf(t, c, 'E-House', 'Nut')).toMatchObject({ received: 368, outstanding: 0, status: 'received' })
    // A second shipment finishes the bolts.
    t = run(t, c, A.recordDelivery({ orderId: po.id, date: TODAY, lines: [{ key: bolts.key, qty: 84 }] }, TODAY))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 184, status: 'received' })
    // Nothing was recorded against individual foundations: no per-line receipts and no allocations.
    expect(t.manual.every((l) => l.receipts.length === 0)).toBe(true)
    expect(t.allocations).toHaveLength(0)
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ allocated: 0, unallocated: 184 })
    expect(t.history.filter((h) => h.action === 'order' || h.action === 'delivery')).toHaveLength(3)
  })

  it('validates orders and deliveries', () => {
    const { c } = world()
    let t = tracked(c)
    const b = rowOf(t, c, 'E-House', 'Anchor bolt')
    const order = (o: Partial<Parameters<typeof A.createPurchaseOrder>[0]> = {}) => A.createPurchaseOrder({ number: 'PO-1', supplier: 'Nucor', date: TODAY, lines: [{ key: b.key, qty: 10 }], ...o }, TODAY)
    expect(fails(t, c, order({ number: '' }))).toMatch(/number/)
    expect(fails(t, c, order({ supplier: '' }))).toMatch(/supplier/)
    expect(fails(t, c, order({ lines: [] }))).toMatch(/at least one/)
    expect(fails(t, c, order({ lines: [{ key: b.key, qty: 0 }] }))).toMatch(/whole number/)
    expect(fails(t, c, order({ lines: [{ key: 'nope', qty: 1 }] }))).toMatch(/no longer required/)
    expect(fails(t, c, order({ date: '2027-01-01' }))).toMatch(/future/)
    t = run(t, c, order())
    expect(fails(t, c, order({ number: 'po-1' }))).toMatch(/already exists/)
    expect(fails(t, c, A.recordDelivery({ date: TODAY, lines: [] }, TODAY))).toMatch(/at least one/)
    expect(fails(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: rowOf(t, c, 'E-House', 'Nut').key, qty: 1 }] }, TODAY))).toMatch(/not on the purchase order/)
    expect(fails(t, c, A.addOrderLines(t.orders![0].id, [{ key: b.key, qty: 5 }]))).toMatch(/already on this order/)
  })

  it('distinguishes received from allocated, and limits allocation to what arrived and what a foundation needs', () => {
    const { c, f1, f2 } = world()
    let t = tracked(c)
    const b = rowOf(t, c, 'E-House', 'Anchor bolt')
    t = run(t, c, A.recordDelivery({ date: TODAY, lines: [{ key: b.key, qty: 150 }] }, TODAY)) // received without a purchase order
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 150, allocated: 0, status: 'partial' })
    expect(fails(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 120 }, { foundationId: f2, qty: 40 }]))).toMatch(/Only 150/)
    expect(fails(t, c, A.setAllocations(b.key, [{ foundationId: f2, qty: 100 }]))).toMatch(/cannot be allocated more than/) // OP-2 needs 8*4+4*2=40
    t = run(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 100 }, { foundationId: f2, qty: 40 }]))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 150, allocated: 140, unallocated: 10 })
    // Allocating does not change what was received; reducing it frees the material again.
    t = run(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 60 }]))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 150, allocated: 100, unallocated: 50 })
    // A delivery that has been allocated against cannot be voided away.
    expect(fails(t, c, A.voidDelivery(t.deliveries![0].id))).toMatch(/allocated/)
    t = run(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 0 }, { foundationId: f2, qty: 0 }]))
    t = run(t, c, A.voidDelivery(t.deliveries![0].id))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 0, status: 'pending' })
  })

  it('recalculating requirements never overwrites orders, deliveries or history', () => {
    let { c, f1 } = world()
    let t = tracked(c)
    const b = rowOf(t, c, 'E-House', 'Anchor bolt')
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-9', supplier: 'Nucor', date: TODAY, lines: [{ key: b.key, qty: 184 }] }, TODAY))
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: b.key, qty: 100 }] }, TODAY))
    const before = { orders: t.orders, orderLines: t.orderLines, deliveries: t.deliveries, deliveryLines: t.deliveryLines, history: t.history.length }
    c = build(c, K.configureFoundation(f1, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    const after = rowOf(t, c, 'E-House', 'Anchor bolt')
    expect(after).toMatchObject({ required: 280, ordered: 184, received: 100, outstanding: 180, toOrder: 96, status: 'partial' })
    expect(t.orders).toEqual(before.orders)
    expect(t.orderLines).toEqual(before.orderLines)
    expect(t.deliveries).toEqual(before.deliveries)
    expect(t.deliveryLines).toEqual(before.deliveryLines)
    expect(t.history.length).toBeGreaterThanOrEqual(before.history) // only grows
  })

  it('keeps orders and deliveries visible, marked as no longer required, when the configuration drops a material', () => {
    let { c, A1, B1 } = world()
    let t = tracked(c)
    const tpl = rowOf(t, c, 'E-House', 'Plywood template')
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-T', supplier: 'Demo Lumber', date: TODAY, lines: [{ key: tpl.key, qty: 48 }] }, TODAY))
    c = build(c, K.setAnchorageComponents(A1, []))
    c = build(c, K.setAnchorageComponents(B1, []))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    const gone = procurementRows(t, c).find((r) => r.key === tpl.key)!
    expect(gone).toMatchObject({ required: 0, ordered: 48, orphan: true })
  })

  it('keeps existing per-line orders and receipts counting toward the same totals', () => {
    const { c, eh, f1 } = world()
    let t = tracked(c)
    t = run(t, c, A.addMaterials([{ areaId: eh, foundationId: f1, category: 'other', name: 'Grout', specification: 'Non-shrink', size: '', unit: 'bag', requiredQty: 20, basis: 'fixed' } as never]))
    const id = t.manual.find((l) => l.component === 'Grout')!.id
    t = run(t, c, A.setOrdered(id, 20))
    t = run(t, c, A.addReceipt(id, { date: TODAY, qty: 8, reference: 'old', note: '' }, TODAY))
    const g = procurementRows(t, c).find((r) => r.name === 'Grout')!
    expect(g).toMatchObject({ required: 20, ordered: 20, orderedOnLines: 20, received: 8, receivedOnLines: 8, allocated: 8, allocatedOnLines: 8, status: 'partial' })
    // A bulk delivery adds to it rather than replacing it.
    t = run(t, c, A.recordDelivery({ date: TODAY, lines: [{ key: g.key, qty: 12 }] }, TODAY))
    expect(procurementRows(t, c).find((r) => r.name === 'Grout')).toMatchObject({ received: 20, status: 'received', unallocated: 12 })
  })
})

describe('areas flow through Foundations, Materials and Procurement', () => {
  it('a new area appears with its requirements, and a rename updates every list without touching orders', () => {
    let { c, A1 } = world()
    c = build(c, K.createArea(c.projects[0].id, 'Control Building', [], { identifier: 'A-300' }))
    const area = c.areas.find((a) => a.name === 'Control Building')!
    c = build(c, K.createFoundation(area.id, 'CB-1', '', null, 2, { groups: [{ anchorageTypeId: A1, count: 2 }] }))
    let t = tracked(c)
    const row = () => procurementRows(t, c).find((r) => r.areaId === area.id && r.name === 'Anchor bolt')!
    expect(row()).toMatchObject({ area: 'Control Building', required: 2 * 2 * 4 })
    expect(areaTree(consolidate(t, c)).map((a) => a.name)).toContain('Control Building')
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-CB', supplier: 'Nucor', date: TODAY, lines: [{ key: row().key, qty: 16 }] }, TODAY))
    const orders = t.orderLines
    c = build(c, K.editArea(area.id, { name: 'Control Bldg', description: 'Renamed' }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(row()).toMatchObject({ area: 'Control Bldg', ordered: 16, key: orders![0].key })
    expect(areaTree(consolidate(t, c)).map((a) => a.name)).toContain('Control Bldg')
    expect(t.orderLines).toEqual(orders)
  })
})

/** The staging E-House: OP1-01-03 is 7 footings of one OP1-D2 anchorage each (4 bolts, 6 nuts and 2 washers per bolt, 1 sole plate). */
function staging() {
  let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  c = build(c, K.createOrganization({ name: 'Northline' }))
  c = build(c, K.createProject({ name: 'Terrestrial' }))
  const pid = c.projects[0].id
  c = build(c, K.createArea(pid, 'E-House', []))
  for (const code of ['OP1-D1', 'OP1-D2', 'OP1-D3', 'OP1-D4']) c = build(c, K.addAnchorageType(pid, code, code))
  const id = Object.fromEntries(c.anchorageTypes.map((t) => [t.code, t.id]))
  const bolt = (d: string) => ({ kind: 'bolt' as const, qty: 4, diameter: d, length: 460, lengthUnit: 'mm' as const, thread: 'all-thread' as const, nutsPerBolt: 6, washersPerBolt: 2 })
  c = build(c, K.setAnchorageComponents(id['OP1-D2'], [bolt('3/4"'), { kind: 'sole-plate', qty: 1, size: '6 x 280 x 280 mm' }]))
  c = build(c, K.setAnchorageComponents(id['OP1-D3'], [bolt('1"'), { kind: 'sole-plate', qty: 1, size: '6 x 300 x 300 mm' }]))
  c = build(c, K.setAnchorageComponents(id['OP1-D4'], [{ kind: 'embed-plate', qty: 1, size: '16 x 320 x 520 mm' }]))
  const area = c.areas[0].id
  const mk = (n: string, q: number, groups: [string, number][]) => { c = build(c, K.createFoundation(area, n, '', null, q, { groups: groups.map(([k, count]) => ({ anchorageTypeId: id[k], count })) })) }
  mk('OP1-01-01', 18, [['OP1-D1', 1]]); mk('OP1-01-01A', 1, [['OP1-D1', 1], ['OP1-D2', 1]]); mk('OP1-01-01B', 1, [['OP1-D1', 1], ['OP1-D2', 1]])
  mk('OP1-01-02', 1, [['OP1-D1', 3]]); mk('OP1-01-03', 7, [['OP1-D2', 1]]); mk('OP1-01-04', 1, [['OP1-D3', 1]]); mk('OP1-01-05', 2, [['OP1-D4', 1]])
  return { c, area, f3: c.foundations.find((f) => f.number === 'OP1-01-03')!.id }
}

describe('quantity audit: footing quantity × anchorages per footing × quantity per anchorage', () => {
  it('OP1-01-03 (7 footings × 1 OP1-D2 × 4 bolts) needs 28 bolts, and every material follows the same rule', () => {
    const { c } = staging()
    const g = consolidate(tracked(c), c)
    const total = (cat: string, spec?: RegExp) => g.find((x) => x.category === cat && (!spec || spec.test(x.specification + x.size)))!
    const bolts = total('bolt', /3\/4/)
    expect(bolts.contributions.find((x) => x.foundation === 'OP1-01-03')!.qty).toBe(28)
    expect(bolts.required).toBe(36) // OP1-01-01A 4 + OP1-01-01B 4 + OP1-01-03 28
    expect(total('nut', /3\/4/).required).toBe(36 * 6)
    expect(total('washer', /3\/4/).required).toBe(36 * 2)
    expect(total('sole-plate', /280/).required).toBe(9) // 1 + 1 + 7
    expect(total('bolt', /1"/).required).toBe(4)
    expect(total('sole-plate', /300/).required).toBe(1)
    expect(total('embed-plate').required).toBe(2) // OP1-01-05: 2 footings × 1
  })

  it('an independent recount agrees with the calculation for every calculated requirement', () => {
    const { c } = staging()
    const t = tracked(c)
    const expected = expectedTotals(c)
    const calc = t.manual.filter((l) => l.origin === 'anchorage')
    expect(calc.length).toBe(expected.size)
    for (const l of calc) expect(l.requiredQty, l.component).toBe(expected.get(l.deriveKey!))
  })

  it('Materials and Procurement show the same quantity for every requirement', () => {
    const { c } = staging()
    const t = tracked(c)
    const grouped = consolidate(t, c)
    const proc = procurementRows(t, c)
    expect(proc.map((r) => [r.key, r.required]).sort()).toEqual(grouped.map((r) => [r.key, r.required]).sort())
    for (const g of grouped) expect(g.contributions.reduce((a, x) => a + x.qty, 0), g.name).toBe(g.required)
  })

  it('an entered fixed 4 on OP1-01-03 is flagged, and counting it on every footing gives 28 without losing its history', () => {
    const { c, area, f3 } = staging()
    let t = tracked(c)
    const typeId = c.anchorageTypes.find((x) => x.code === 'OP1-D2')!.id
    t = run(t, c, A.addMaterials([{ areaId: area, foundationId: f3, anchorageTypeId: typeId, category: 'bolt', name: 'Anchor bolt', specification: 'ASTM F1554 Gr.55', size: '', unit: 'ea', requiredQty: 4, basis: 'fixed' } as never]))
    const entered = consolidate(t, c).find((g) => g.lines.some((l) => l.origin === 'manual' && l.component === 'Anchor bolt'))!
    expect(entered.required).toBe(4)
    const notes = entryNotes(entered, c, consolidate(t, c))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ foundation: 'OP1-01-03', entered: 4, footings: 7, perFooting: 28, calculated: 28 })
    const id = entered.lines[0].id
    t = run(t, c, A.setOrdered(id, 4))
    t = run(t, c, A.editMaterial(id, { basis: 'per-footing', requiredQty: 4 }))
    const line = t.manual.find((l) => l.id === id)!
    expect(line).toMatchObject({ requiredQty: 28, basis: 'per-footing', qtyEach: 4, orderedQty: 4 })
    expect(t.history.some((h) => h.materialId === id && h.action === 'quantity')).toBe(true)
  })
})

describe('material labels', () => {
  it('name the anchorage types that need a material, with the specification beneath; entered materials keep their name', () => {
    const { c, area, f3 } = staging()
    let t = tracked(c)
    const label = (cat: string, re: RegExp) => materialLabel(consolidate(t, c).find((g) => g.category === cat && re.test(g.specification + g.size))!)
    expect(label('bolt', /3\/4/)).toEqual({ title: 'OP1-D2', sub: '3/4" × 460 mm, all-thread' })
    expect(label('embed-plate', /320/)).toEqual({ title: 'OP1-D4', sub: '16 x 320 x 520 mm' })
    t = run(t, c, A.addMaterials([{ areaId: area, foundationId: '', category: 'other', name: 'Non-shrink grout', specification: 'Type 10', size: '', unit: 'bag', requiredQty: 5, basis: 'fixed' } as never]))
    expect(materialLabel(consolidate(t, c).find((g) => g.name === 'Non-shrink grout')!)).toEqual({ title: 'Non-shrink grout', sub: 'Type 10' })
    void f3
  })
  it('identical materials from several anchorage types are one line naming them all', () => {
    let { c, A1, B1 } = world()
    const same = { kind: 'bolt' as const, qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }
    c = build(c, K.setAnchorageComponents(B1, [same]))
    c = build(c, K.configureFoundation(c.foundations[1].id, { groups: [{ anchorageTypeId: B1, count: 1 }] }))
    const g = consolidate(tracked(c), c).filter((x) => x.area === 'E-House' && x.category === 'bolt')
    expect(g).toHaveLength(1)
    expect(materialLabel(g[0]).title).toBe('A, B')
    void A1
  })
})
