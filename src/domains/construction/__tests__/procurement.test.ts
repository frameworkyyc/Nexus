/* eslint-disable prefer-const -- fixtures where only some bindings are reassigned */
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { areaTree, consolidate, entryNotes, materialLabel } from '../tracker/consolidate'
import { embedChoices } from '../configActions'
import { materialStatus, mergeAcrossAreas, procurementRows, procStatus, progressCounts } from '../tracker/procurement'
import { expectedTotals, refreshRequirements } from '../tracker/requirements'
import { materialsIndicator } from '../packageProgress'
import { getIndex } from '../selectors'
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
    // 12×3 + 4×2 = 44 anchorages of A (×4 bolts) and 4×1 of B (×2 bolts). The bolts are physically identical, but each anchorage designation
    // is its own requirement: 176 for A and 8 for B, never one line of 184.
    expect(bolts.map((b) => [b.designation, b.required])).toEqual([['A', 176], ['B', 8]])
    expect(g.filter((x) => x.area === 'E-House' && x.category === 'nut').map((n) => [n.designation, n.required])).toEqual([['A', 352], ['B', 16]])
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
    expect(by(f2, 'B')).toBeUndefined() // B is a separate requirement
    expect(bolts.contributions.reduce((a, x) => a + x.qty, 0)).toBe(bolts.required)
    const b = consolidate(tracked(c), c).find((x) => x.area === 'E-House' && x.category === 'bolt' && x.designation === 'B')!
    expect(b.contributions.find((x) => x.foundationId === f2)?.qty).toBe(4 * 1 * 2)
  })

  it('updates when foundation quantities or anchorage configurations change', () => {
    let { c, A1, f1 } = world()
    let t = tracked(c)
    c = build(c, K.configureFoundation(f1, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(consolidate(t, c).find((x) => x.area === 'E-House' && x.category === 'bolt')!.required).toBe((20 * 3 + 8) * 4)
    c = build(c, K.setAnchorageComponents(A1, [{ kind: 'bolt', qty: 6, diameter: 'M25', length: 900, lengthUnit: 'mm', thread: 'both-ends', topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }]))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(consolidate(t, c).find((x) => x.area === 'E-House' && x.category === 'bolt')!.required).toBe((20 * 3 + 8) * 6)
  })

  it('combines a manually entered identical material with the calculated one without duplicating records', () => {
    const { c, eh, f1, A1 } = world()
    let t = tracked(c)
    const calc = consolidate(t, c).find((x) => x.area === 'E-House' && x.category === 'bolt')!
    // An entered bolt for anchorage type A joins A's calculated requirement; one with no anchorage type is generic and stays on its own line.
    t = run(t, c, A.addMaterials([{ areaId: eh, foundationId: f1, anchorageTypeId: A1, category: 'bolt', name: 'Anchor bolt', specification: calc.specification, size: '', unit: 'ea', requiredQty: 10, basis: 'fixed' } as never]))
    const g = consolidate(t, c).filter((x) => x.area === 'E-House' && x.category === 'bolt' && x.designation === 'A')
    expect(g).toHaveLength(1)
    expect(g[0].required).toBe(186)
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
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ ordered: 176, received: 0, outstanding: 176, status: 'ordered' })
    const po = t.orders![0]
    // One delivery of part of the bolts and all the nuts.
    t = run(t, c, A.recordDelivery({ orderId: po.id, date: TODAY, reference: 'DN-7', lines: [{ key: bolts.key, qty: 100 }, { key: nuts.key, qty: nuts.required }] }, TODAY), 'sam@example.com')
    expect(t.deliveries![0]).toMatchObject({ by: 'sam@example.com', at: NOW, reference: 'DN-7' })
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 100, outstanding: 76, status: 'partial' })
    expect(rowOf(t, c, 'E-House', 'Nut')).toMatchObject({ received: 352, outstanding: 0, status: 'received' })
    // A second shipment finishes the bolts.
    t = run(t, c, A.recordDelivery({ orderId: po.id, date: TODAY, lines: [{ key: bolts.key, qty: 76 }] }, TODAY))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 176, status: 'received' })
    // Nothing was recorded against individual foundations: no per-line receipts and no allocations.
    expect(t.manual.every((l) => l.receipts.length === 0)).toBe(true)
    expect(t.allocations).toHaveLength(0)
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ allocated: 0, unallocated: 176 })
    expect(t.history.filter((h) => h.action === 'order' || h.action === 'delivery')).toHaveLength(3)
  })

  it('validates orders and deliveries', () => {
    const { c } = world()
    let t = tracked(c)
    const b = rowOf(t, c, 'E-House', 'Anchor bolt')
    const order = (o: Partial<Parameters<typeof A.createPurchaseOrder>[0]> = {}) => A.createPurchaseOrder({ number: 'PO-1', supplier: 'Nucor', date: TODAY, lines: [{ key: b.key, qty: 10 }], ...o }, TODAY)
    expect(fails(t, c, order({ number: '' }))).toBeUndefined() // the PO number is optional
    expect(fails(t, c, order({ supplier: '' }))).toBeUndefined() // the supplier is optional
    expect(fails(t, c, order({ lines: [] }))).toMatch(/at least one/)
    expect(fails(t, c, order({ lines: [{ key: b.key, qty: 0 }] }))).toMatch(/whole number/)
    expect(fails(t, c, order({ lines: [{ key: 'nope', qty: 1 }] }))).toMatch(/no longer required/)
    expect(fails(t, c, order({ date: '2027-01-01' }))).toMatch(/future/)
    t = run(t, c, order())
    expect(fails(t, c, order({ number: 'po-1' }))).toMatch(/already exists/)
    expect(fails(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [] }, TODAY))).toMatch(/at least one/)
    expect(fails(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: rowOf(t, c, 'E-House', 'Nut').key, qty: 1 }] }, TODAY))).toMatch(/not on the purchase order/)
    expect(fails(t, c, A.addOrderLines(t.orders![0].id, [{ key: b.key, qty: 5 }]))).toMatch(/already on this order/)
  })

  it('distinguishes received from allocated, and limits allocation to what arrived and what a foundation needs', () => {
    const { c, f1, f2 } = world()
    let t = tracked(c)
    const b = rowOf(t, c, 'E-House', 'Anchor bolt')
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: b.key, qty: 150 }] }, TODAY)) // received without a purchase order
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 150, allocated: 0, status: 'partial' })
    expect(fails(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 130 }, { foundationId: f2, qty: 30 }]))).toMatch(/Only 150/)
    expect(fails(t, c, A.setAllocations(b.key, [{ foundationId: f2, qty: 100 }]))).toMatch(/cannot be allocated more than/) // OP-2 needs 4*2*4=32 of this designation (its 4×1 of type B is a separate requirement)
    t = run(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 100 }, { foundationId: f2, qty: 32 }]))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 150, allocated: 132, unallocated: 18 })
    // Allocating does not change what was received; reducing it frees the material again.
    t = run(t, c, A.setAllocations(b.key, [{ foundationId: f1, qty: 60 }]))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt')).toMatchObject({ received: 150, allocated: 92, unallocated: 58 })
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
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-9', supplier: 'Nucor', date: TODAY, lines: [{ key: b.key, qty: 176 }] }, TODAY))
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: b.key, qty: 100 }] }, TODAY))
    const before = { orders: t.orders, orderLines: t.orderLines, deliveries: t.deliveries, deliveryLines: t.deliveryLines, history: t.history.length }
    c = build(c, K.configureFoundation(f1, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    const after = rowOf(t, c, 'E-House', 'Anchor bolt')
    expect(after).toMatchObject({ required: 272, ordered: 176, received: 100, outstanding: 172, toOrder: 96, status: 'partial' })
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
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-T', supplier: 'Demo Lumber', date: TODAY, lines: [{ key: tpl.key, qty: tpl.required }] }, TODAY))
    c = build(c, K.setAnchorageComponents(A1, []))
    c = build(c, K.setAnchorageComponents(B1, []))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    const gone = procurementRows(t, c).find((r) => r.key === tpl.key)!
    expect(gone).toMatchObject({ required: 0, ordered: tpl.required, orphan: true })
  })

  it('keeps existing per-line orders and receipts counting toward the same totals', () => {
    const { c, eh, f1 } = world()
    let t = tracked(c)
    t = run(t, c, A.addMaterials([{ areaId: eh, foundationId: f1, category: 'other', name: 'Grout', specification: 'Non-shrink', size: '', unit: 'bag', requiredQty: 20, basis: 'fixed' } as never]))
    const id = t.manual.find((l) => l.component === 'Grout')!.id
    t = run(t, c, A.legacySetOrdered(id, 20))
    t = run(t, c, A.legacyAddReceipt(id, { date: TODAY, qty: 8, reference: 'old', note: '' }, TODAY))
    const g = procurementRows(t, c).find((r) => r.name === 'Grout')!
    expect(g).toMatchObject({ required: 20, ordered: 20, orderedOnLines: 20, received: 8, receivedOnLines: 8, allocated: 8, allocatedOnLines: 8, status: 'partial' })
    // A bulk delivery adds to it rather than replacing it.
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: g.key, qty: 12 }] }, TODAY))
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
    t = run(t, c, A.legacySetOrdered(id, 4))
    t = run(t, c, A.editMaterial(id, { basis: 'per-footing', requiredQty: 4 }))
    const line = t.manual.find((l) => l.id === id)!
    expect(line).toMatchObject({ requiredQty: 28, basis: 'per-footing', qtyEach: 4, orderedQty: 4 })
    expect(t.history.some((h) => h.materialId === id && h.action === 'quantity')).toBe(true)
  })
})

describe('material labels', () => {
  it('name a material by its anchorage designation and name, with the specification beneath; entered materials keep their name', () => {
    const { c, area, f3 } = staging()
    let t = tracked(c)
    const label = (cat: string, re: RegExp) => materialLabel(consolidate(t, c).find((g) => g.category === cat && re.test(g.specification + g.size))!)
    expect(label('bolt', /3\/4/)).toEqual({ title: 'OP1-D2 Anchor bolt', sub: '3/4" × 460 mm, all-thread' })
    expect(label('embed-plate', /320/)).toEqual({ title: 'OP1-D4 Embed plate', sub: '16 x 320 x 520 mm' })
    t = run(t, c, A.addMaterials([{ areaId: area, foundationId: '', category: 'other', name: 'Non-shrink grout', specification: 'Type 10', size: '', unit: 'bag', requiredQty: 5, basis: 'fixed' } as never]))
    expect(materialLabel(consolidate(t, c).find((g) => g.name === 'Non-shrink grout')!)).toEqual({ title: 'Non-shrink grout', sub: 'Type 10' })
    void f3
  })
  it('identical materials from several anchorage types are separate lines, each named by its designation', () => {
    let { c, A1, B1 } = world()
    const same = { kind: 'bolt' as const, qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }
    c = build(c, K.setAnchorageComponents(B1, [same]))
    c = build(c, K.configureFoundation(c.foundations[1].id, { groups: [{ anchorageTypeId: B1, count: 1 }] }))
    const g = consolidate(tracked(c), c).filter((x) => x.area === 'E-House' && x.category === 'bolt')
    expect(g).toHaveLength(2)
    expect(g.map((x) => materialLabel(x).title)).toEqual(['A Anchor bolt', 'B Anchor bolt'])
    void A1
  })
})

describe('anchor bolts installed directly in footings', () => {
  const fbolt = (o: Record<string, unknown> = {}) => ({ qty: 4, diameter: '3/4"', length: 460, lengthUnit: 'mm' as const, thread: 'all-thread' as const, nutsPerBolt: 6, washersPerBolt: 2, ...o })
  /** `des` picks the anchorage designation ('' is the generic line with none, e.g. bolts cast directly in a footing). */
  const find = (c: ConstructionState, area: string, cat: string, re?: RegExp, des?: string) => consolidate(tracked(c), c).find((g) => g.area === area && g.category === cat && (!re || re.test(g.specification)) && (des === undefined || g.designation === des))!

  it('7 footings × 4 bolts = 28 bolts, with their nuts and washers, and no plinths or anchorage type', () => {
    let { c, area } = staging()
    const before = { plinths: c.plinths.length, groups: c.anchorageGroups?.length }
    c = build(c, K.createFoundation(area, 'FB-1', '', null, 7, { bolts: [fbolt()] }))
    const f = c.foundations.find((x) => x.number === 'FB-1')!
    expect(c.plinths.length).toBe(before.plinths) // no artificial plinth records
    expect(c.anchorageGroups?.length).toBe(before.groups)
    expect(c.foundationBolts).toHaveLength(1)
    // Bolts cast in a footing have no anchorage type, so they are identified by their foundation: apart from the identical OP1-D2 anchorage bolts.
    const bolts = find(c, 'E-House', 'bolt', /3\/4/, 'FB-1')
    expect(bolts.contributions.find((x) => x.foundationId === f.id)).toMatchObject({ qty: 28, anchorage: 'Footing', source: 'calculated' })
    expect(bolts.required).toBe(28)
    expect(find(c, 'E-House', 'nut', /3\/4/, 'FB-1').required).toBe(28 * 6)
    expect(find(c, 'E-House', 'washer', /3\/4/, 'FB-1').required).toBe(28 * 2)
    expect(find(c, 'E-House', 'bolt', /3\/4/, 'OP1-D2').required).toBe(36)
    expect(consolidate(tracked(c), c).filter((g) => g.area === 'E-House' && g.category === 'bolt' && /3\/4/.test(g.specification))).toHaveLength(2)
    expect(bolts.lines[0].calc.expression).toMatch(/4 per footing × 7 footings/)
  })

  it('a foundation can have plinths, footing bolts, both or neither; several bolt configurations are kept', () => {
    let { c, area } = staging()
    c = build(c, K.createFoundation(area, 'NONE', '', null, 3, {}))
    c = build(c, K.createFoundation(area, 'BOLTS', '', null, 2, { bolts: [fbolt(), fbolt({ qty: 2, diameter: '1"' })] }))
    const both = c.anchorageTypes.find((t) => t.code === 'OP1-D2')!.id
    c = build(c, K.createFoundation(area, 'BOTH', '', null, 5, { groups: [{ anchorageTypeId: both, count: 1 }], bolts: [fbolt({ qty: 1 })] }))
    expect(c.foundationBolts!.filter((b) => b.foundationId === c.foundations.find((f) => f.number === 'BOLTS')!.id)).toHaveLength(2)
    expect(c.plinths.filter((p) => p.foundationId === c.foundations.find((f) => f.number === 'BOLTS')!.id)).toHaveLength(0)
    expect(find(c, 'E-House', 'bolt', /^1"/, 'BOLTS').required).toBe(2 * 2) // BOLTS: 2 footings × 2
    expect(find(c, 'E-House', 'bolt', /^1"/, 'OP1-D3').required).toBe(4) // the OP1-D3 anchorage bolt stays apart
    expect(find(c, 'E-House', 'bolt', /3\/4/, 'BOLTS').required).toBe(2 * 4) // footing bolts of BOLTS
    expect(find(c, 'E-House', 'bolt', /3\/4/, 'BOTH').required).toBe(5 * 1) // and of BOTH: 5 footings × 1
    expect(find(c, 'E-House', 'bolt', /3\/4/, 'OP1-D2').required).toBe(36 + 5 * 4) // OP1-D2 anchorage bolts: 36, BOTH 5 × 4
    expect(find(c, 'E-House', 'nut').required).toBeGreaterThan(0)
  })

  it('is validated, and editing keeps ids, can clear bolts, and never touches plinths', () => {
    let { c, area } = staging()
    c = build(c, K.createFoundation(area, 'FB-2', '', null, 2, { bolts: [fbolt()] }))
    const f = c.foundations.find((x) => x.number === 'FB-2')!
    const err = (cfg: Record<string, unknown>) => K.configureFoundation(f.id, cfg as never)(c, {}).error
    expect(err({ bolts: [fbolt({ diameter: '' })] })).toMatch(/Anchor bolts 1: .*diameter/)
    expect(err({ bolts: [fbolt({ length: null })] })).toMatch(/length/)
    expect(err({ bolts: [fbolt({ qty: 0 })] })).toMatch(/per footing/)
    expect(err({ bolts: [fbolt({ thread: 'both-ends', topThread: 400, bottomThread: 100 })] })).toMatch(/longer than the bolt/)
    expect(err({ bolts: Array.from({ length: 11 }, () => fbolt()) })).toMatch(/up to 10/)
    const id = c.foundationBolts![0].id
    c = build(c, K.configureFoundation(f.id, { bolts: [{ ...fbolt({ qty: 6 }), id }] }))
    expect(c.foundationBolts!.find((b) => b.foundationId === f.id)).toMatchObject({ id, qty: 6 })
    expect(find(c, 'E-House', 'bolt', /3\/4/, 'FB-2').contributions.find((x) => x.foundationId === f.id)!.qty).toBe(12)
    const plinths = c.plinths.length
    c = build(c, K.configureFoundation(f.id, { quantity: 5 }))
    expect(find(c, 'E-House', 'bolt', /3\/4/, 'FB-2').contributions.find((x) => x.foundationId === f.id)!.qty).toBe(30) // follows the footing quantity
    c = build(c, K.configureFoundation(f.id, { bolts: [] }))
    expect(c.foundationBolts!.some((b) => b.foundationId === f.id)).toBe(false)
    expect(c.plinths.length).toBe(plinths)
  })

  it('an independent recount agrees, Procurement matches, and orders survive a bolt change', () => {
    let { c, area } = staging()
    c = build(c, K.createFoundation(area, 'FB-3', '', null, 7, { bolts: [fbolt()] }))
    let t = tracked(c)
    const expected = expectedTotals(c)
    for (const l of t.manual.filter((x) => x.origin === 'anchorage')) expect(l.requiredQty, l.component).toBe(expected.get(l.deriveKey!))
    const row = () => procurementRows(t, c).find((r) => r.category === 'bolt' && /3\/4/.test(r.specification) && r.designation === 'FB-3')!
    expect(row().required).toBe(28)
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-FB', supplier: 'Nucor', date: TODAY, lines: [{ key: row().key, qty: 28 }] }, TODAY))
    const f = c.foundations.find((x) => x.number === 'FB-3')!
    c = build(c, K.configureFoundation(f.id, { quantity: 10 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(row()).toMatchObject({ required: 40, ordered: 28, toOrder: 12 })
  })
})

describe('material status, installation and the overview', () => {
  it('status follows ordered, received and installed, and only reads "full" when the whole quantity has reached that stage', () => {
    const s = (required: number, ordered: number, received: number, installed: number) => materialStatus({ required, ordered, received, installed })
    expect(s(10, 0, 0, 0)).toBe('pending')
    expect(s(10, 4, 0, 0)).toBe('partially-ordered')
    expect(s(10, 10, 0, 0)).toBe('ordered')
    expect(s(10, 12, 3, 0)).toBe('partially-delivered')
    expect(s(10, 10, 10, 0)).toBe('delivered')
    expect(s(10, 10, 10, 4)).toBe('partially-installed')
    expect(s(10, 10, 10, 10)).toBe('installed')
    expect(s(10, 10, 10, 9)).toBe('partially-installed')
    expect(s(0, 0, 0, 0)).toBe('pending')
  })

  it('records installation separately from delivery and allocation, limited to what has arrived and what is required', () => {
    const { c } = world()
    let t = tracked(c)
    const key = rowOf(t, c, 'E-House', 'Anchor bolt').key
    const inst = (qty: number, date = TODAY) => A.recordInstallation({ key, qty, date }, TODAY)
    expect(fails(t, c, inst(5))).toMatch(/Only 0 .* has been received/) // nothing has arrived yet
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key, qty: 100 }] }, TODAY), 'sam@example.com')
    expect(fails(t, c, inst(0))).toMatch(/whole number/)
    expect(fails(t, c, inst(101))).toMatch(/Only 100/)
    expect(fails(t, c, A.recordInstallation({ key, qty: 1, date: '2027-01-01' }, TODAY))).toMatch(/future/)
    t = run(t, c, inst(40), 'sam@example.com')
    let row = rowOf(t, c, 'E-House', 'Anchor bolt')
    expect(row).toMatchObject({ installed: 40, received: 100, allocated: 0, stage: 'partially-installed', installable: 60 })
    expect(t.installations![0]).toMatchObject({ by: 'sam@example.com', at: NOW, qty: 40 })
    // never "Installed" until the full 176 are in
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key, qty: 76 }] }, TODAY))
    t = run(t, c, inst(136))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt').stage).toBe('installed')
    expect(fails(t, c, inst(1))).toMatch(/already installed/)
    // a delivery that has been installed from cannot be voided away
    expect(fails(t, c, A.voidDelivery(t.deliveries![1].id))).toMatch(/installed/)
    t = run(t, c, A.voidInstallation(t.installations![1].id))
    expect(rowOf(t, c, 'E-House', 'Anchor bolt').stage).toBe('partially-installed')
    expect(t.history.filter((h) => h.action === 'installation')).toHaveLength(3)
    row = rowOf(t, c, 'E-House', 'Anchor bolt')
    expect(row.received).toBe(176)
  })

  it('the overview combines matching specifications across areas, keeps each area, and counts each once', () => {
    const { c } = world()
    let t = tracked(c)
    const rows = procurementRows(t, c)
    const merged = mergeAcrossAreas(rows)
    const bolts = merged.find((m) => m.category === 'bolt')!
    expect(bolts.areas.map((a) => [a.area, a.required]).sort()).toEqual([['E-House', 176], ['Pipe Rack', 20]])
    expect(bolts.required).toBe(196)
    expect(merged.filter((m) => m.category === 'bolt').map((m) => m.designation)).toEqual(['A', 'B']) // one line per designation, not one per area
    expect(merged.reduce((a, m) => a + m.required, 0)).toBe(rows.reduce((a, r) => a + r.required, 0)) // nothing double-counted or dropped
    // a new area shows up with no extra work
    const { c: c2 } = world()
    const c3 = build(c2, K.createArea(c2.projects[0].id, 'Mole Sieve', []))
    const c4 = build(c3, K.createFoundation(c3.areas.find((a) => a.name === 'Mole Sieve')!.id, 'MS-1', '', null, 2, { groups: [{ anchorageTypeId: c3.anchorageTypes[0].id, count: 1 }] }))
    t = tracked(c4)
    expect(mergeAcrossAreas(procurementRows(t, c4)).find((m) => m.category === 'bolt' && m.designation === 'A')!.required).toBe(196 + 8)
    expect(mergeAcrossAreas(procurementRows(t, c4)).find((m) => m.category === 'bolt' && m.designation === 'A')!.areas.map((a) => a.area).sort()).toEqual(['E-House', 'Mole Sieve', 'Pipe Rack'])
  })

  it('gauge counts are in requirements, not units, and Ordered + Outstanding is always the total', () => {
    const { c } = world()
    let t = tracked(c)
    const rows = () => procurementRows(t, c).filter((r) => r.area === 'E-House')
    expect(progressCounts(rows())).toEqual({ total: 7, ordered: 0, delivered: 0, allocated: 0, outstanding: 7 })
    const bolt = rowOf(t, c, 'E-House', 'Anchor bolt'), nut = rowOf(t, c, 'E-House', 'Nut')
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-G', supplier: 'Nucor', date: TODAY, lines: [{ key: bolt.key, qty: 176 }, { key: nut.key, qty: 100 }] }, TODAY)) // nuts only partly ordered
    expect(progressCounts(rows())).toMatchObject({ total: 7, ordered: 1, delivered: 0, outstanding: 6 })
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: bolt.key, qty: 176 }] }, TODAY))
    t = run(t, c, A.setAllocations(bolt.key, [{ foundationId: c.foundations[0].id, qty: 144 }, { foundationId: c.foundations[1].id, qty: 16 }]))
    expect(progressCounts(rows())).toMatchObject({ total: 7, ordered: 1, delivered: 1, allocated: 0 }) // 160 of 176 allocated: not fully
    const p = progressCounts(rows())
    expect(p.ordered + p.outstanding).toBe(p.total)
  })
})

describe('Area Overview materials gauge stays in step with the Materials tab', () => {
  const entered = (area: string, n: number) => Array.from({ length: n }, (_, i) => ({ areaId: area, foundationId: '', category: 'other', name: `Item ${i + 1}`, specification: `Spec ${i + 1}`, size: '', unit: 'ea', requiredQty: 10, basis: 'fixed' }) as never)
  const gauge = (t: TrackerState, c: ConstructionState, areaId: string) => materialsIndicator(getIndex(c), areaId, t)
  const tab = (t: TrackerState, c: ConstructionState, areaId: string) => progressCounts(procurementRows(t, c).filter((r) => r.areaId === areaId && r.required > 0))

  it('18 requirements, 4 ordered and 4 delivered in full: 22%, 4/18 delivered, 14/18 not yet fully delivered', () => {
    const { c, eh } = world()
    let t = run(emptyTracker(), c, A.addMaterials(entered(eh, 18)))
    const rows = procurementRows(t, c).filter((r) => r.areaId === eh && r.name.startsWith('Item'))
    expect(rows).toHaveLength(18)
    // order 4 in full; ordering alone does not move the gauge
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-A', supplier: 'Nucor', date: TODAY, lines: rows.slice(0, 4).map((r) => ({ key: r.key, qty: 10 })) }, TODAY))
    let g = gauge(t, c, eh)
    expect(tab(t, c, eh)).toMatchObject({ ordered: 4 })
    expect(g.percent).toBe(0)
    expect(g.rows.find((r) => r.label === 'Delivered in full')!.value).toBe(`0 / ${tab(t, c, eh).total}`)
    // the same four delivered in full
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: rows.slice(0, 4).map((r) => ({ key: r.key, qty: 10 })) }, TODAY))
    g = gauge(t, c, eh)
    const total = tab(t, c, eh).total
    expect(tab(t, c, eh)).toMatchObject({ ordered: 4, delivered: 4 })
    expect(g.percent).toBe(Math.round((4 / total) * 100))
    expect(g.rows.find((r) => r.label === 'Delivered in full')!.value).toBe(`4 / ${total}`)
    expect(g.rows.find((r) => r.label === 'Not yet fully delivered')!.value).toBe(`${total - 4} / ${total}`)
    // a partial delivery on a fifth shows as partial, not as progress
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: rows[4].key, qty: 3 }] }, TODAY))
    g = gauge(t, c, eh)
    expect(g.percent).toBe(Math.round((4 / total) * 100))
    expect(g.rows[0].note).toBe('1 partially delivered')
  })

  it('the reported case exactly: 18 requirements, 4 delivered in full → 22%, 4 / 18 and 14 / 18', () => {
    let { c } = world()
    c = build(c, K.createArea(c.projects[0].id, 'Clean Area', []))
    const area = c.areas.find((a) => a.name === 'Clean Area')!.id
    let t = run(emptyTracker(), c, A.addMaterials(entered(area, 18)))
    const items = procurementRows(t, c).filter((r) => r.areaId === area)
    expect(items).toHaveLength(18)
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-R', supplier: 'Nucor', date: TODAY, lines: items.slice(0, 4).map((r) => ({ key: r.key, qty: 10 })) }, TODAY))
    expect(gauge(t, c, area).percent).toBe(0) // ordered 4/18 does not count as delivered
    expect(tab(t, c, area)).toMatchObject({ total: 18, ordered: 4, delivered: 0, outstanding: 14 })
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: items.slice(0, 4).map((r) => ({ key: r.key, qty: 10 })) }, TODAY))
    const g = gauge(t, c, area)
    expect(g.percent).toBe(22)
    expect(g.rows.map((r) => [r.label, r.value])).toEqual([['Delivered in full', '4 / 18'], ['Not yet fully delivered', '14 / 18']])
    expect(tab(t, c, area)).toMatchObject({ total: 18, ordered: 4, delivered: 4 })
  })

  it('follows requirement changes, voids, and every area including a new one, using the same figures as the Materials tab', () => {
    let { c, A1, eh } = world()
    let t = tracked(c)
    const check = (areaId: string) => {
      const g = gauge(t, c, areaId); const m = tab(t, c, areaId)
      expect(g.percent).toBe(m.total === 0 ? null : Math.round((m.delivered / m.total) * 100))
      if (m.total) { expect(g.rows[0].value).toBe(`${m.delivered} / ${m.total}`); expect(g.rows[1].value).toBe(`${m.total - m.delivered} / ${m.total}`) }
    }
    for (const a of c.areas) check(a.id)
    const bolt = rowOf(t, c, 'E-House', 'Anchor bolt')
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: bolt.key, qty: 176 }] }, TODAY))
    check(eh)
    expect(gauge(t, c, eh).percent).toBe(14) // 1 of E-House's 7 requirements (A and B bolts, nuts, washers, A template)
    // the requirement grows: no longer fully delivered
    c = build(c, K.configureFoundation(c.foundations[0].id, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    check(eh); expect(gauge(t, c, eh).percent).toBe(0)
    // voiding the delivery
    t = run(t, c, A.voidDelivery(t.deliveries![0].id))
    check(eh)
    // a new area gets the same behaviour
    c = build(c, K.createArea(c.projects[0].id, 'Mole Sieve', []))
    const ms = c.areas.find((a) => a.name === 'Mole Sieve')!.id
    expect(gauge(t, c, ms).percent).toBeNull()
    c = build(c, K.createFoundation(ms, 'MS-1', '', null, 2, { groups: [{ anchorageTypeId: A1, count: 1 }] }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    check(ms); expect(tab(t, c, ms).total).toBe(4)
    const b2 = rowOf(t, c, 'Mole Sieve', 'Anchor bolt')
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: b2.key, qty: 8 }] }, TODAY))
    check(ms); expect(gauge(t, c, ms).percent).toBe(25)
  })
})

describe('individual foundations within a designation', () => {
  const embedComp = (c: ConstructionState) => c.anchorageComponents!.find((x) => x.kind === 'embed-plate')!
  const unit = (label: string, qty?: number, componentId?: string) => ({ label, embeds: qty ? [{ componentId: componentId!, qty }] : [] })
  const embedLine = (c: ConstructionState) => consolidate(tracked(c), c).find((g) => g.area === 'E-House' && g.category === 'embed-plate')!

  it('A-1…B-n with one or two embed plates each: totals across all individual foundations, merged with the library specification', () => {
    let { c } = staging()
    const comp = embedComp(c)
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')! // 18 footings sharing OP1-D1
    const list = [...['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'].map((l) => unit(l, 1, comp.id)), ...['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6'].map((l) => unit(l, 2, comp.id))]
    c = build(c, K.setFoundationUnits(f.id, list))
    const g = embedLine(c)
    // OP1-01-05: 2 footings × 1 (library, via OP1-D4) + 6 × 1 + 6 × 2 individual
    expect(g.required).toBe(2 + 6 + 12)
    expect(consolidate(tracked(c), c).filter((x) => x.area === 'E-House' && x.category === 'embed-plate')).toHaveLength(1)
    const mine = g.contributions.filter((x) => x.foundationId === f.id)
    expect(mine).toHaveLength(12)
    expect(mine.find((x) => x.foundation === 'OP1-01-01 · B-3')).toMatchObject({ qty: 2, individual: true, anchorage: 'OP1-D4' })
    expect(mine.reduce((a, x) => a + x.qty, 0)).toBe(18)
    expect(g.contributions.reduce((a, x) => a + x.qty, 0)).toBe(g.required)
    // the shared config is untouched
    expect(c.foundations.find((x) => x.id === f.id)).toMatchObject({ quantity: 18 })
    expect(c.plinths.filter((p) => p.foundationId === f.id)).toHaveLength(1)
  })

  it('individual embed plates replace the type\'s embed plates for those footings only, so nothing is counted twice', () => {
    let { c } = staging()
    const comp = embedComp(c)
    const f = c.foundations.find((x) => x.number === 'OP1-01-05')! // 2 footings of OP1-D4 (1 embed plate each)
    expect(embedLine(c).required).toBe(2)
    c = build(c, K.setFoundationUnits(f.id, [unit('X-1', 3, comp.id)]))
    expect(embedLine(c).required).toBe(1 + 3) // one footing keeps the type's plate, X-1 has its own 3
    c = build(c, K.setFoundationUnits(f.id, [unit('X-1', 3, comp.id), unit('X-2', 1, comp.id)]))
    expect(embedLine(c).required).toBe(3 + 1)
    c = build(c, K.setFoundationUnits(f.id, [unit('X-1'), unit('X-2')])) // identifiers only: the type's plates still apply
    expect(embedLine(c).required).toBe(2)
    c = build(c, K.setFoundationUnits(f.id, []))
    expect(embedLine(c).required).toBe(2)
  })

  it('an independent recount agrees, Procurement matches Materials, and orders survive changes', () => {
    let { c } = staging()
    const comp = embedComp(c)
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')!
    c = build(c, K.setFoundationUnits(f.id, [unit('A-1', 1, comp.id), unit('A-2', 2, comp.id), unit('B-1')]))
    let t = tracked(c)
    const expected = expectedTotals(c)
    for (const l of t.manual.filter((x) => x.origin === 'anchorage')) expect(l.requiredQty, l.component).toBe(expected.get(l.deriveKey!))
    expect(procurementRows(t, c).map((r) => [r.key, r.required]).sort()).toEqual(consolidate(t, c).map((r) => [r.key, r.required]).sort())
    const row = () => procurementRows(t, c).find((r) => r.category === 'embed-plate')!
    expect(row().required).toBe(2 + 3)
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-EMB', supplier: 'Nucor', date: TODAY, lines: [{ key: row().key, qty: 5 }] }, TODAY))
    c = build(c, K.setFoundationUnits(f.id, [unit('A-1', 1, comp.id), unit('A-2', 2, comp.id), unit('B-1', 2, comp.id)]))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(row()).toMatchObject({ required: 7, ordered: 5, toOrder: 2 })
    expect(t.orderLines).toHaveLength(1)
  })

  it('reconciles with the designation: never more than its quantity, validated against the library', () => {
    let { c } = staging()
    const comp = embedComp(c)
    const f = c.foundations.find((x) => x.number === 'OP1-01-05')! // quantity 2
    const err = (units: Parameters<typeof K.setFoundationUnits>[1]) => K.setFoundationUnits(f.id, units)(c, {}).error
    expect(err([unit('A'), unit('B'), unit('C')])).toMatch(/at most 2/)
    expect(err([unit('A'), unit('a')])).toMatch(/more than once/)
    expect(err([unit('')])).toMatch(/identifier/)
    expect(err([{ label: 'A', embeds: [{ componentId: 'nope', qty: 1 }] }])).toMatch(/Anchorage Library/)
    expect(err([unit('A', 0.5 as never, comp.id)])).toMatch(/whole number/)
    expect(err([{ label: 'A', embeds: [{ componentId: comp.id, qty: 1 }, { componentId: comp.id, qty: 1 }] }])).toMatch(/twice/)
    c = build(c, K.setFoundationUnits(f.id, [unit('A', 1, comp.id), unit('B', 2, comp.id)]))
    expect(K.configureFoundation(f.id, { quantity: 1 })(c, {}).error).toMatch(/cannot go below 2/)
    expect(K.editFoundation(f.id, { quantity: 1 })(c, {}).error).toMatch(/cannot go below 2/)
    const d4 = c.anchorageTypes.find((t) => t.code === 'OP1-D4')!
    expect(K.setAnchorageComponents(d4.id, [])(c, {}).error).toMatch(/used by 2 individual foundations/)
    expect(K.setAnchorageComponents(d4.id, [{ id: comp.id, kind: 'embed-plate', qty: 2, size: comp.size }])(c, {}).error).toBeUndefined() // editing it is fine
    expect(c.foundationUnits!.find((u) => u.label === 'B')!.embeds[0].qty).toBe(2)
  })
})

describe('embed plates added directly to a foundation', () => {
  const comp = (c: ConstructionState) => c.anchorageComponents!.find((x) => x.kind === 'embed-plate')!
  const embedLine = (c: ConstructionState) => consolidate(tracked(c), c).find((g) => g.area === 'E-House' && g.category === 'embed-plate')!
  const cfg = (c: ConstructionState, embeds: { componentId?: string; qty: number; mode: 'per-foundation' | 'total'; id?: string }[]) => ({ embeds: embeds.map((e) => ({ componentId: comp(c).id, ...e })) })

  it('per foundation multiplies by the physical foundations; total does not: 18 × 2 = 36, 2 in total = 2', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')! // 18 physical foundations, no embed plates of its own
    expect(embedLine(c).required).toBe(2) // OP1-01-05's two, from its anchorage type
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 2, mode: 'per-foundation' }])))
    expect(embedLine(c).required).toBe(2 + 36)
    expect(embedLine(c).contributions.find((x) => x.foundationId === f.id)!.qty).toBe(36)
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 2, mode: 'total' }])))
    expect(embedLine(c).required).toBe(2 + 2)
    expect(embedLine(c).lines[0].calc.expression).toMatch(/2 in total/)
    // both on one foundation, each with its own method
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 2, mode: 'per-foundation' }, { qty: 2, mode: 'total' }])))
    expect(embedLine(c).required).toBe(2 + 36 + 2)
    expect(consolidate(tracked(c), c).filter((g) => g.category === 'embed-plate' && g.area === 'E-House')).toHaveLength(1) // one consolidated line
    expect(embedLine(c).lines[0].calc.expression).toMatch(/2 per foundation × 18 foundations/)
    expect(c.foundations.find((x) => x.id === f.id)).toMatchObject({ quantity: 18 })
    expect(c.plinths.filter((p) => p.foundationId === f.id)).toHaveLength(1) // no plinth or group created
  })

  it('does not count a plate twice when the foundation\'s anchorage type already supplies it', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-05')! // 2 footings of OP1-D4: 1 plate per anchorage = 2
    expect(embedLine(c).required).toBe(2)
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 3, mode: 'per-foundation' }])))
    expect(embedLine(c).required).toBe(6) // replaces the type's 2, never 2 + 6
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 5, mode: 'total' }])))
    expect(embedLine(c).required).toBe(5)
    c = build(c, K.configureFoundation(f.id, { embeds: [] }))
    expect(embedLine(c).required).toBe(2) // back to the anchorage type's own
  })

  it('recalculates with the foundation quantity; Materials, Procurement and the recount agree; orders are kept', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')!
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 2, mode: 'per-foundation' }])))
    let t = tracked(c)
    const expected = expectedTotals(c)
    for (const l of t.manual.filter((x) => x.origin === 'anchorage')) expect(l.requiredQty, l.component).toBe(expected.get(l.deriveKey!))
    expect(procurementRows(t, c).map((r) => [r.key, r.required]).sort()).toEqual(consolidate(t, c).map((r) => [r.key, r.required]).sort())
    const row = () => procurementRows(t, c).find((r) => r.category === 'embed-plate')!
    expect(row().required).toBe(38)
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-EM', supplier: 'Nucor', date: TODAY, lines: [{ key: row().key, qty: 38 }] }, TODAY))
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: row().key, qty: 20 }] }, TODAY))
    c = build(c, K.configureFoundation(f.id, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(row()).toMatchObject({ required: 42, ordered: 38, received: 20, toOrder: 4 })
    expect(t.orderLines).toHaveLength(1)
    expect(t.deliveries).toHaveLength(1)
  })

  it('is validated against the library and cannot be removed from it while in use', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')!
    const err = (embeds: unknown[]) => K.configureFoundation(f.id, { embeds } as never)(c, {}).error
    expect(err([{ componentId: 'nope', qty: 1, mode: 'total' }])).toMatch(/Anchorage Library/)
    expect(err([{ componentId: comp(c).id, qty: 0, mode: 'total' }])).toMatch(/whole number/)
    expect(err([{ componentId: comp(c).id, qty: 1, mode: 'each' }])).toMatch(/per foundation or total/)
    expect(err([{ componentId: comp(c).id, qty: 1, mode: 'total' }, { componentId: comp(c).id, qty: 2, mode: 'total' }])).toMatch(/Combine/)
    expect(err(Array.from({ length: 11 }, () => ({ componentId: comp(c).id, qty: 1, mode: 'total' })))).toMatch(/up to 10/)
    c = build(c, K.configureFoundation(f.id, cfg(c, [{ qty: 2, mode: 'per-foundation' }])))
    const d4 = c.anchorageTypes.find((t) => t.code === 'OP1-D4')!
    expect(K.setAnchorageComponents(d4.id, [])(c, {}).error).toMatch(/used by 1 foundation/)
  })
})

describe('embed plates created inside a foundation', () => {
  const plate = (o: Record<string, unknown> = {}) => ({ thickness: 16, width: 300, length: 300, unit: 'mm' as const, studCount: 4, studDiameter: 19, studLength: 150, ...o })
  const entry = (o: Record<string, unknown> = {}) => ({ plate: plate(), save: 'foundation' as const, qty: 2, mode: 'per-foundation' as const, ...o })
  const line = (c: ConstructionState, re = /16 × 300 × 300/) => consolidate(tracked(c), c).find((g) => g.area === 'E-House' && g.category === 'embed-plate' && re.test(g.size))!

  const total = (c: ConstructionState) => consolidate(tracked(c), c).filter((g) => g.area === 'E-House' && g.category === 'embed-plate' && /16 × 300 × 300/.test(g.size)).reduce((a, g) => a + g.required, 0)

  it('needs no anchorage type: 18 foundations × 2 = 36, named by the foundation and the plate specification', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')!
    c = build(c, K.configureFoundation(f.id, { embeds: [entry()] }))
    const g = line(c)
    expect(g.required).toBe(36)
    expect(materialLabel(g)).toEqual({ title: 'OP1-01-01 Embed plate', sub: '16 × 300 × 300 mm w/ 4 headed studs Ø19 × 150 mm long' })
    expect(g.contributions).toEqual([expect.objectContaining({ foundation: 'OP1-01-01', anchorage: 'OP1-01-01', qty: 36, source: 'calculated' })])
    expect(c.foundationEmbeds![0]).toMatchObject({ componentId: '', plate: { thickness: 16, width: 300, length: 300, unit: 'mm', studCount: 4 } })
    expect(c.libraryEmbedPlates ?? []).toHaveLength(0) // foundation specific: nothing added to the library
    expect(c.plinths.filter((p) => p.foundationId === f.id)).toHaveLength(1)
    c = build(c, K.configureFoundation(f.id, { embeds: [entry({ mode: 'total', qty: 2 })] }))
    expect(line(c).required).toBe(2)
    expect(line(c).lines[0].calc.expression).toMatch(/2 in total/)
  })

  it('works with no anchorage types at all', () => {
    let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
    c = build(c, K.createOrganization({ name: 'Northline' }))
    c = build(c, K.createProject({ name: 'Plant' }))
    c = build(c, K.createArea(c.projects[0].id, 'Shed', []))
    c = build(c, K.createFoundation(c.areas[0].id, 'F-1', '', null, 5, { embeds: [entry({ qty: 3 })] }))
    expect(consolidate(tracked(c), c).find((g) => g.category === 'embed-plate')!.required).toBe(15)
  })

  it('identical specifications on different foundations stay separate requirements, each named by its foundation', () => {
    let { c } = staging()
    const a = c.foundations.find((x) => x.number === 'OP1-01-01')!, b = c.foundations.find((x) => x.number === 'OP1-01-02')!
    c = build(c, K.configureFoundation(a.id, { embeds: [entry()] }))
    c = build(c, K.configureFoundation(b.id, { embeds: [entry({ qty: 3 })] })) // OP1-01-02 has 1 footing
    const g = consolidate(tracked(c), c).filter((x) => x.area === 'E-House' && x.category === 'embed-plate' && /16 × 300/.test(x.size))
    expect(g.map((x) => [materialLabel(x).title, x.required])).toEqual([['OP1-01-01 Embed plate', 36], ['OP1-01-02 Embed plate', 3]])
    expect(g.map((x) => x.contributions.map((y) => [y.foundation, y.qty]))).toEqual([[['OP1-01-01', 36]], [['OP1-01-02', 3]]])
    expect(total(c)).toBe(36 + 3)
  })

  it('saving to the library makes it reusable by other foundations and never saves a specification twice', () => {
    let { c } = staging()
    const a = c.foundations.find((x) => x.number === 'OP1-01-01')!, b = c.foundations.find((x) => x.number === 'OP1-01-02')!
    c = build(c, K.configureFoundation(a.id, { embeds: [entry({ save: 'library' })] }))
    expect(c.libraryEmbedPlates).toHaveLength(1)
    expect(c.foundationEmbeds!.find((e) => e.foundationId === a.id)).toMatchObject({ componentId: c.libraryEmbedPlates![0].id })
    expect(c.foundationEmbeds!.find((e) => e.foundationId === a.id)!.plate).toBeUndefined()
    // another foundation chooses it from the library list
    const choice = embedChoices(c, c.projects[0].id).find((x) => x.type === null)!
    expect(choice.component.size).toBe('16 × 300 × 300 mm w/ 4 headed studs Ø19 × 150 mm long')
    c = build(c, K.configureFoundation(b.id, { embeds: [{ componentId: choice.component.id, qty: 2, mode: 'total' }] }))
    expect(total(c)).toBe(36 + 2)
    // creating the same specification again from a third foundation reuses the library entry
    const d = c.foundations.find((x) => x.number === 'OP1-01-03')!
    c = build(c, K.configureFoundation(d.id, { embeds: [entry({ save: 'library', qty: 1 })] }))
    expect(c.libraryEmbedPlates).toHaveLength(1)
    expect(total(c)).toBe(36 + 2 + 7)
    // editing keeps entries and ids; a foundation's own entry can later be moved to the library
    const mine = c.foundationEmbeds!.find((e) => e.foundationId === a.id)!
    c = build(c, K.configureFoundation(a.id, { embeds: [{ id: mine.id, componentId: mine.componentId, qty: 1, mode: 'per-foundation' }] }))
    expect(total(c)).toBe(18 + 2 + 7)
  })

  it('keeps quantities in step: recount agrees, Procurement matches Materials, orders and deliveries are kept', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')!
    c = build(c, K.configureFoundation(f.id, { embeds: [entry({ save: 'library' }), entry({ plate: plate({ studCount: null, studDiameter: null, studLength: null }), qty: 4, mode: 'total' })] }))
    let t = tracked(c)
    const expected = expectedTotals(c)
    for (const l of t.manual.filter((x) => x.origin === 'anchorage')) expect(l.requiredQty, l.component).toBe(expected.get(l.deriveKey!))
    expect(procurementRows(t, c).map((r) => [r.key, r.required]).sort()).toEqual(consolidate(t, c).map((r) => [r.key, r.required]).sort())
    const row = () => procurementRows(t, c).find((r) => r.category === 'embed-plate' && /16 × 300 × 300 mm/.test(r.size) && /headed/.test(r.size))!
    expect(row().required).toBe(36)
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-CP', supplier: 'Nucor', date: TODAY, lines: [{ key: row().key, qty: 36 }] }, TODAY))
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: row().key, qty: 10 }] }, TODAY))
    c = build(c, K.configureFoundation(f.id, { quantity: 20 }))
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(row()).toMatchObject({ required: 40, ordered: 36, received: 10, toOrder: 4 })
    expect(t.orderLines).toHaveLength(1)
    expect(t.deliveries).toHaveLength(1)
  })

  it('validates the plate, the studs and the quantity method', () => {
    let { c } = staging()
    const f = c.foundations.find((x) => x.number === 'OP1-01-01')!
    const err = (e: Record<string, unknown>) => K.configureFoundation(f.id, { embeds: [entry(e)] } as never)(c, {}).error
    expect(err({ plate: plate({ thickness: 0 }) })).toMatch(/thickness, width and length/)
    expect(err({ plate: plate({ length: null }) })).toMatch(/thickness, width and length/)
    expect(err({ plate: plate({ unit: 'cm' }) })).toMatch(/mm or inches/)
    expect(err({ plate: plate({ studDiameter: null }) })).toMatch(/stud diameter/)
    expect(err({ plate: plate({ studCount: 0 }) })).toMatch(/headed studs/)
    expect(err({ plate: undefined })).toMatch(/thickness, width and length/)
    expect(err({ mode: 'each' })).toMatch(/per foundation or total/)
    expect(err({ qty: 0 })).toMatch(/whole number/)
    expect(err({ save: 'cloud' })).toMatch(/where to save/)
    expect(K.configureFoundation(f.id, { embeds: [entry(), entry()] } as never)(c, {}).error).toMatch(/Combine/)
    c = build(c, K.configureFoundation(f.id, { embeds: [entry(), entry({ mode: 'total' })] })) // same plate with a different method is fine
    expect(c.foundationEmbeds).toHaveLength(2)
  })
})

describe('footing anchor bolts: quantity method', () => {
  const fb = (o: Record<string, unknown> = {}) => ({ qty: 4, diameter: '3/4"', length: 460, lengthUnit: 'mm' as const, thread: 'all-thread' as const, nutsPerBolt: 6, washersPerBolt: 2, ...o })
  /** Mole Sieve OP1-21-26: 5 footings, each with the typical OP1-D2 anchorage (4 bolts, 6 nuts and 2 washers per bolt). */
  function moleSieve() {
    let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
    c = build(c, K.createOrganization({ name: 'Northline' }))
    c = build(c, K.createProject({ name: 'Terrestrial' }))
    c = build(c, K.createArea(c.projects[0].id, 'Mole Sieve', []))
    c = build(c, K.addAnchorageType(c.projects[0].id, 'OP1-D2', 'typical'))
    const d2 = c.anchorageTypes[0].id
    c = build(c, K.setAnchorageComponents(d2, [{ kind: 'bolt', qty: 4, diameter: '3/4"', length: 460, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 6, washersPerBolt: 2 }]))
    c = build(c, K.createFoundation(c.areas[0].id, 'OP1-21-26', '', null, 5, { groups: [{ anchorageTypeId: d2, count: 1 }] }))
    return { c, f: c.foundations[0].id }
  }
  const req = (c: ConstructionState, cat: string) => consolidate(tracked(c), c).filter((g) => g.area === 'Mole Sieve' && g.category === cat)

  const reqD = (c: ConstructionState, cat: string, des: string) => req(c, cat).filter((g) => g.designation === des)

  it('OP1-21-26: 4 extra bolts as a total is 4 additional, not 20, beside the typical 20 (footing bolts are identified by their foundation, apart from OP1-D2 bolts)', () => {
    let { c, f } = moleSieve()
    expect(req(c, 'bolt')[0].required).toBe(20) // typical only
    c = build(c, K.configureFoundation(f, { bolts: [fb({ mode: 'total' })] }))
    const bolts = req(c, 'bolt')
    expect(bolts).toHaveLength(2) // OP1-D2 anchorage bolts, and the footing bolts, which belong to no designation: nothing lost
    const typical = reqD(c, 'bolt', 'OP1-D2')[0], extra = reqD(c, 'bolt', 'OP1-21-26')[0]
    expect(typical.required).toBe(20) // the typical bolts are never replaced
    expect(extra.required).toBe(4) // 4 additional, never 20 extra
    expect(extra.contributions.find((x) => x.anchorage === 'Footing')!.qty).toBe(4)
    expect(typical.contributions.find((x) => x.anchorage === 'OP1-D2')!.qty).toBe(20)
    expect(typical.lines[0].calc.expression).toMatch(/4 per anchorage × 5 OP1-D2/)
    expect(extra.lines[0].calc.expression).toMatch(/4 extra on the footings, in total/)
    expect(reqD(c, 'nut', 'OP1-D2')[0].required + reqD(c, 'nut', 'OP1-21-26')[0].required).toBe(20 * 6 + 4 * 6) // 144 nuts
    expect(reqD(c, 'washer', 'OP1-D2')[0].required + reqD(c, 'washer', 'OP1-21-26')[0].required).toBe(20 * 2 + 4 * 2) // 48 washers
    expect(c.foundationBolts![0].mode).toBe('total')
  })

  it('per foundation multiplies by the physical foundations; total stays fixed when the quantity changes', () => {
    let { c, f } = moleSieve()
    c = build(c, K.configureFoundation(f, { bolts: [fb({ mode: 'per-foundation', qty: 4 }), fb({ mode: 'total', qty: 4, diameter: 'M24', length: 900 })] }))
    const of = (re: RegExp, des: string) => reqD(c, 'bolt', des).find((g) => re.test(g.specification))!
    expect(of(/3\/4/, 'OP1-D2').required).toBe(20) // typical
    expect(of(/3\/4/, 'OP1-21-26').required).toBe(4 * 5) // 4 × 5 foundations
    expect(of(/M24/, 'OP1-21-26').required).toBe(4)
    c = build(c, K.configureFoundation(f, { quantity: 8 }))
    expect(of(/3\/4/, 'OP1-D2').required).toBe(32) // both follow the quantity
    expect(of(/3\/4/, 'OP1-21-26').required).toBe(32)
    expect(of(/M24/, 'OP1-21-26').required).toBe(4) // the total does not
    // two configurations of the same specification, one of each method, are both counted
    c = build(c, K.configureFoundation(f, { bolts: [fb({ mode: 'per-foundation', qty: 1 }), fb({ mode: 'total', qty: 4 })] }))
    expect(reqD(c, 'bolt', 'OP1-21-26').find((g) => /3\/4/.test(g.specification))!.required).toBe(8 + 4) // 1 × 8 foundations + 4 in total, both counted
    expect(reqD(c, 'bolt', 'OP1-D2')[0].required).toBe(32)
  })

  it('existing configurations default to per foundation, so current calculations are unchanged', () => {
    let { c, f } = moleSieve()
    c = build(c, K.configureFoundation(f, { bolts: [fb()] })) // no mode given
    expect(c.foundationBolts![0].mode).toBe('per-foundation')
    expect(reqD(c, 'bolt', 'OP1-21-26')[0].required).toBe(20)
    expect(reqD(c, 'bolt', 'OP1-D2')[0].required).toBe(20)
    // a bolt saved before the method existed (no mode at all) counts per foundation
    const legacy = { ...c, foundationBolts: c.foundationBolts!.map((b) => { const o = { ...b } as Partial<typeof b>; delete o.mode; return o as typeof b }) }
    expect(consolidate(tracked(legacy), legacy).find((g) => g.category === 'bolt' && g.designation === 'OP1-21-26')!.required).toBe(20)
    expect(K.configureFoundation(f, { bolts: [fb({ mode: 'each' })] } as never)(c, {}).error).toMatch(/per foundation or total/)
  })

  it('recount, Procurement and orders: additional bolts are counted beside the typical ones and history is kept', () => {
    let { c, f } = moleSieve()
    c = build(c, K.configureFoundation(f, { bolts: [fb({ mode: 'total' })] }))
    let t = tracked(c)
    const expected = expectedTotals(c)
    for (const l of t.manual.filter((x) => x.origin === 'anchorage')) expect(l.requiredQty, l.component).toBe(expected.get(l.deriveKey!))
    expect(procurementRows(t, c).map((r) => [r.key, r.required]).sort()).toEqual(consolidate(t, c).map((r) => [r.key, r.required]).sort())
    const row = () => procurementRows(t, c).find((r) => r.category === 'bolt' && r.designation === 'OP1-D2')!
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-20', supplier: 'Nucor', date: TODAY, lines: [{ key: row().key, qty: 20 }] }, TODAY))
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: row().key, qty: 12 }] }, TODAY))
    c = build(c, K.configureFoundation(f, { bolts: [fb({ mode: 'total' })] })) // re-saving the same configuration changes nothing that was ordered or received
    t = refreshRequirements(t, c, { log: true, at: NOW })
    expect(row()).toMatchObject({ required: 20, ordered: 20, received: 12, toOrder: 0 })
    expect(procurementRows(t, c).find((r) => r.category === 'bolt' && r.designation === 'OP1-21-26')).toMatchObject({ required: 4, ordered: 0 })
    expect(t.orderLines).toHaveLength(1)
    expect(t.deliveries).toHaveLength(1)
  })
})
