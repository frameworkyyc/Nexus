/* eslint-disable prefer-const -- fixtures where only some bindings are reassigned */
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { consolidate, displayName, materialLabel } from '../tracker/consolidate'
import { mergeAcrossAreas, orderProgress, orderTitle, procurementRows, progressCounts } from '../tracker/procurement'
import { refreshRequirements } from '../tracker/requirements'
import { emptyTracker, type TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'

const TODAY = '2026-10-30'
const NOW = '2026-10-30T12:00:00Z'
function build(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const ctx = (c: ConstructionState) => ({ construction: c, actor: 'jo@example.com', now: NOW })
function run(t: TrackerState, c: ConstructionState, r: A.Reducer): TrackerState { const o = r(t, ctx(c)); if (o.error !== undefined) throw new Error(o.error); return o.state }
const fails = (t: TrackerState, c: ConstructionState, r: A.Reducer) => r(t, ctx(c)).error
const tracked = (c: ConstructionState, t: TrackerState = emptyTracker()) => refreshRequirements(t, c, { log: true, at: NOW })

/** Two anchorage designations with physically identical components: 5 × OP1-D2 and 10 × OP1-D3 foundations, one template and 4 bolts each. */
function world() {
  let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  c = build(c, K.createOrganization({ name: 'Northline' }))
  c = build(c, K.createProject({ name: 'P1' }))
  const pid = c.projects[0].id
  c = build(c, K.createArea(pid, 'E-House', []))
  c = build(c, K.addAnchorageType(pid, 'OP1-D2', 'Typical D2'))
  c = build(c, K.addAnchorageType(pid, 'OP1-D3', 'Typical D3'))
  const [D2, D3] = c.anchorageTypes.map((t) => t.id)
  const parts = [{ kind: 'bolt' as const, qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }, { kind: 'template' as const, qty: 1, spec: '19 mm plywood' }]
  c = build(c, K.setAnchorageComponents(D2, parts))
  c = build(c, K.setAnchorageComponents(D3, parts))
  const area = c.areas[0].id
  c = build(c, K.createFoundation(area, 'F-D2', '', null, 5, { groups: [{ anchorageTypeId: D2, count: 1 }] }))
  c = build(c, K.createFoundation(area, 'F-D3', '', null, 10, { groups: [{ anchorageTypeId: D3, count: 1 }] }))
  return { c, area, D2, D3, fD2: c.foundations[0].id, fD3: c.foundations[1].id }
}
const rowsOf = (t: TrackerState, c: ConstructionState, name: string) => procurementRows(t, c).filter((r) => r.name === name && r.required > 0)

describe('materials are separated by anchorage designation', () => {
  it('15 plywood templates are 5 × OP1-D2 and 10 × OP1-D3, in Materials and Procurement alike', () => {
    const { c, fD2, fD3 } = world()
    const t = tracked(c)
    const g = consolidate(t, c).filter((x) => x.name === 'Plywood template')
    expect(g.map((x) => [x.designation, x.required])).toEqual([['OP1-D2', 5], ['OP1-D3', 10]])
    expect(g.map((x) => displayName(x))).toEqual(['OP1-D2 Plywood template', 'OP1-D3 Plywood template'])
    expect(g.map((x) => materialLabel(x).title)).toEqual(['OP1-D2 Plywood template', 'OP1-D3 Plywood template'])
    // the foundation breakdown stays with each requirement
    expect(g[0].contributions.map((x) => [x.foundationId, x.qty])).toEqual([[fD2, 5]])
    expect(g[1].contributions.map((x) => [x.foundationId, x.qty])).toEqual([[fD3, 10]])
    // Procurement reads the same groups, with the same keys and quantities
    expect(rowsOf(t, c, 'Plywood template').map((r) => [r.key, r.required])).toEqual(g.map((x) => [x.key, x.required]))
    expect(g[0].key).not.toBe(g[1].key)
  })

  it('anchor bolts, nuts and washers are separated too, but identical components within one designation consolidate', () => {
    let { c, fD2, area, D2 } = world()
    c = build(c, K.createFoundation(area, 'F-D2b', '', null, 3, { groups: [{ anchorageTypeId: D2, count: 2 }] })) // a second D2 foundation: 6 more anchorages
    const t = tracked(c)
    for (const [cat, per] of [['bolt', 4], ['nut', 8], ['washer', 8]] as const) {
      const g = consolidate(t, c).filter((x) => x.category === cat)
      expect(g.map((x) => x.designation)).toEqual(['OP1-D2', 'OP1-D3'])
      expect(g.map((x) => x.required)).toEqual([(5 + 6) * per, 10 * per]) // both D2 foundations in one D2 line
    }
    expect(consolidate(t, c).find((x) => x.category === 'bolt' && x.designation === 'OP1-D2')!.contributions.map((x) => x.foundationId).sort()).toEqual([fD2, c.foundations[2].id].sort())
  })

  it('a generic material with no designation still consolidates by specification', () => {
    const { c, area, fD2, fD3 } = world()
    let t = tracked(c)
    const grout = (foundationId: string, qty: number) => ({ areaId: area, foundationId, category: 'other', name: 'Grout', specification: 'Type 10', size: '', unit: 'bag', requiredQty: qty, basis: 'fixed' }) as never
    t = run(t, c, A.addMaterials([grout(fD2, 5), grout(fD3, 7)], true))
    const g = consolidate(t, c).filter((x) => x.name === 'Grout')
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ required: 12, designation: '' })
    expect(displayName(g[0])).toBe('Grout')
    expect(g[0].contributions).toHaveLength(2) // the foundation breakdown is kept
  })

  it('across areas the overview merges per designation and keeps each area', () => {
    let { c, D2 } = world()
    c = build(c, K.createArea(c.projects[0].id, 'Pipe Rack', []))
    c = build(c, K.createFoundation(c.areas[1].id, 'PR-1', '', null, 2, { groups: [{ anchorageTypeId: D2, count: 1 }] }))
    const t = tracked(c)
    const rows = procurementRows(t, c)
    const m = mergeAcrossAreas(rows).filter((x) => x.name === 'Plywood template')
    expect(m.map((x) => [x.designation, x.required])).toEqual([['OP1-D2', 7], ['OP1-D3', 10]])
    expect(m[0].areas.map((a) => [a.area, a.required])).toEqual([['E-House', 5], ['Pipe Rack', 2]])
    expect(mergeAcrossAreas(rows).reduce((a, x) => a + x.required, 0)).toBe(rows.reduce((a, r) => a + r.required, 0)) // nothing double-counted or dropped
  })

  it('ordering one designation does not touch the other', () => {
    const { c } = world()
    let t = tracked(c)
    const [d2, d3] = rowsOf(t, c, 'Plywood template')
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-D2', supplier: 'Lumber', date: TODAY, lines: [{ key: d2.key, qty: 5 }] }, TODAY))
    t = run(t, c, A.recordDelivery({ date: TODAY, lines: [{ key: d2.key, qty: 5 }] }, TODAY))
    const [a, b] = rowsOf(t, c, 'Plywood template')
    expect(a).toMatchObject({ designation: 'OP1-D2', ordered: 5, received: 5, status: 'received' })
    expect(b).toMatchObject({ designation: 'OP1-D3', ordered: 0, received: 0, status: 'pending', toOrder: 10 })
    expect(d3.key).toBe(b.key)
  })
})

describe('requirements and records made before designations existed', () => {
  /** Rewrites calculated lines and records to the previous key format (no designation on the end), as they are on an installation before this change. */
  function legacy(t: TrackerState, c: ConstructionState): TrackerState {
    const strip = (k: string) => k.slice(0, k.lastIndexOf('|'))
    const recs = <T extends { key: string; designation?: string }>(l: T): T => { const { designation: _d, ...rest } = l; void _d; return { ...rest, key: strip(l.key) } as unknown as T }
    return {
      ...t,
      manual: t.manual.map((l) => { if (!l.deriveKey) return l; const { designation: _d, ...rest } = l; void _d; return { ...rest, deriveKey: strip(l.deriveKey) } }),
      orderLines: (t.orderLines ?? []).map(recs), deliveryLines: (t.deliveryLines ?? []).map(recs), allocations: (t.allocations ?? []).map(recs), installations: (t.installations ?? []).map(recs),
    } as TrackerState
    void c
  }

  it('an old order and delivery follow a requirement that now has exactly one designation', () => {
    let { c, area, D2 } = world()
    // a type-specific bolt only used by D2
    c = build(c, K.setAnchorageComponents(D2, [{ kind: 'bolt', qty: 4, diameter: 'M30', length: 1000, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2 }]))
    let t = tracked(c)
    const bolt = () => procurementRows(t, c).find((r) => r.category === 'bolt' && /M30/.test(r.specification))!
    t = run(t, c, A.createPurchaseOrder({ number: 'PO-OLD', supplier: 'Nucor', date: TODAY, lines: [{ key: bolt().key, qty: 20 }] }, TODAY))
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: bolt().key, qty: 12 }] }, TODAY))
    const before = bolt()
    const old = legacy(t, c)
    expect(old.orderLines![0].key).not.toBe(before.key) // really the old format
    // every page load refreshes requirements in memory first; that connects them: nothing is lost or double-counted
    const loaded = refreshRequirements(old, c, { log: false })
    const read = procurementRows(loaded, c).find((r) => r.category === 'bolt' && /M30/.test(r.specification))!
    expect(read).toMatchObject({ designation: 'OP1-D2', required: 20, ordered: 20, received: 12, status: 'partial' })
    expect(procurementRows(loaded, c).filter((r) => r.orphan)).toHaveLength(0)
    // refreshing adopts the old calculated line rather than adding a second one, and never touches orders, deliveries or their count
    const next = tracked(c, old)
    expect(next.manual.filter((l) => l.origin === 'anchorage' && l.component === 'Anchor bolt' && /M30/.test(l.specification ?? ''))).toHaveLength(1)
    expect(next.manual.find((l) => l.component === 'Anchor bolt' && /M30/.test(l.specification ?? ''))).toMatchObject({ designation: 'OP1-D2', deriveKey: before.lines[0].deriveKey })
    expect(next.orders).toEqual(old.orders)
    expect(next.orderLines).toEqual(old.orderLines)
    expect(next.deliveryLines).toEqual(old.deliveryLines)
    expect(procurementRows(next, c).find((r) => /M30/.test(r.specification))).toMatchObject({ required: 20, ordered: 20, received: 12 })
    void area
  })

  it('an old order against a requirement now split across designations stays visible under its own key, not guessed', () => {
    const { c } = world()
    // before: both designations' identical templates were one 15-unit requirement
    let t = tracked(c)
    const old = legacy(t, c)
    const oldKey = old.manual.find((l) => l.component === 'Plywood template')!.deriveKey!
    const groupKey = consolidate(t, c).find((x) => x.name === 'Plywood template')!.key
    const key = groupKey.slice(0, groupKey.lastIndexOf('|'))
    const o = { id: 'po-old', number: 'PO-1', supplierId: null, supplier: 'Lumber', date: TODAY, expectedDate: null, notes: '', createdAt: NOW, createdBy: 'x' }
    const ref = { key, areaId: c.areas[0].id, area: 'E-House', category: 'template' as const, name: 'Plywood template', specification: '19 mm plywood', size: '', unit: 'ea' }
    t = { ...old, orders: [o], orderLines: [{ ...ref, id: 'pol-1', orderId: 'po-old', qty: 15 }] }
    const rows = procurementRows(refreshRequirements(t, c, { log: false }), c)
    const ordered = rows.filter((r) => r.name === 'Plywood template')
    expect(ordered.map((r) => [r.designation, r.required, r.ordered])).toEqual(expect.arrayContaining([['OP1-D2', 5, 0], ['OP1-D3', 10, 0], ['', 0, 15]]))
    expect(ordered.reduce((a, r) => a + r.ordered, 0)).toBe(15) // counted once, on the old key
    expect(oldKey).toBeTruthy()
    // refreshing creates the two designation requirements without removing anything
    const next = tracked(c, t)
    expect(next.orderLines).toEqual(t.orderLines)
    expect(next.manual.filter((l) => l.origin === 'anchorage' && l.component === 'Plywood template').map((l) => l.designation).sort()).toEqual(['OP1-D2', 'OP1-D3'])
  })
})

describe('PO numbers are optional and editable', () => {
  const order = (key: string, o: Partial<Parameters<typeof A.createPurchaseOrder>[0]> = {}) => A.createPurchaseOrder({ number: '', supplier: 'Nucor', date: TODAY, lines: [{ key, qty: 5 }], ...o }, TODAY)

  it('materials can be ordered without a PO number, and status, quantities and deliveries are the same as with one', () => {
    const { c } = world()
    const t0 = tracked(c)
    const [d2] = rowsOf(t0, c, 'Plywood template')
    const withNo = run(t0, c, order(d2.key))
    const withPo = run(t0, c, order(d2.key, { number: 'PO-1' }))
    expect(withNo.orders![0].number).toBe('')
    const view = (t: TrackerState) => { const r = rowsOf(t, c, 'Plywood template')[0]; return { ordered: r.ordered, status: r.status, toOrder: r.toOrder, stage: r.stage } }
    expect(view(withNo)).toEqual(view(withPo))
    expect(view(withNo)).toMatchObject({ ordered: 5, status: 'ordered', stage: 'ordered' })
    // delivery against it, allocation and installation behave identically
    let t = run(withNo, c, A.recordDelivery({ orderId: withNo.orders![0].id, date: TODAY, lines: [{ key: d2.key, qty: 5 }] }, TODAY))
    t = run(t, c, A.setAllocations(d2.key, [{ foundationId: c.foundations[0].id, qty: 5 }]))
    t = run(t, c, A.recordInstallation({ key: d2.key, qty: 2, date: TODAY }, TODAY))
    expect(rowsOf(t, c, 'Plywood template')[0]).toMatchObject({ ordered: 5, received: 5, allocated: 5, installed: 2, status: 'received' })
    expect(t.history.find((h) => h.action === 'order')!.summary).toMatch(/no PO number/)
    expect(t.history.find((h) => h.action === 'delivery')!.summary).toMatch(/no PO number/)
  })

  it('several orders may have no number (no duplicate-number clash), while real numbers must still be unique', () => {
    const { c } = world()
    let t = tracked(c)
    const [d2, d3] = rowsOf(t, c, 'Plywood template')
    t = run(t, c, order(d2.key))
    t = run(t, c, order(d3.key, { lines: [{ key: d3.key, qty: 3 }] }))
    expect(t.orders).toHaveLength(2)
    t = run(t, c, order(d2.key, { number: 'PO-7', lines: [{ key: d2.key, qty: 1 }] }))
    expect(fails(t, c, order(d3.key, { number: 'po-7', lines: [{ key: d3.key, qty: 1 }] }))).toMatch(/already exists/)
  })

  it('a number can be added, corrected and cleared on an existing order without touching anything else, and the history keeps each change', () => {
    const { c } = world()
    let t = tracked(c)
    const [d2] = rowsOf(t, c, 'Plywood template')
    t = run(t, c, order(d2.key))
    const id = t.orders![0].id
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: d2.key, qty: 3 }] }, TODAY))
    const frozen = { lines: t.orderLines, deliveries: t.deliveries, deliveryLines: t.deliveryLines, allocations: t.allocations, row: rowsOf(t, c, 'Plywood template')[0] }
    const { number: _n, ...rest } = t.orders![0]; void _n
    t = run(t, c, A.setPurchaseOrderNumber(id, '  1706734-00 '))
    expect(t.orders![0]).toMatchObject({ ...rest, number: '1706734-00' }) // trimmed; nothing else on the order changed
    t = run(t, c, A.setPurchaseOrderNumber(id, '1706734-01'))
    expect(t.orders![0].number).toBe('1706734-01')
    expect(t.orders).toHaveLength(1) // edited in place, not cancelled and recreated
    expect(t.orders![0].cancelled).toBeUndefined()
    expect({ lines: t.orderLines, deliveries: t.deliveries, deliveryLines: t.deliveryLines, allocations: t.allocations, row: rowsOf(t, c, 'Plywood template')[0] }).toEqual(frozen)
    const notes = t.history.filter((h) => h.action === 'order' && /^PO number/.test(h.summary))
    expect(notes.map((h) => h.summary)).toEqual([
      expect.stringMatching(/PO number added: Not Assigned → 1706734-00/),
      expect.stringMatching(/PO number changed: 1706734-00 → 1706734-01/),
    ])
    t = run(t, c, A.setPurchaseOrderNumber(id, ''))
    expect(t.orders![0].number).toBe('')
    expect(t.history.at(-1)!.summary).toMatch(/1706734-01 → Not Assigned/)
    expect(run(t, c, A.setPurchaseOrderNumber(id, '')).history).toHaveLength(t.history.length) // no change, no history noise
  })

  it('refuses a number another order already uses, and an order that does not exist; a delivered order can still be renumbered', () => {
    const { c } = world()
    let t = tracked(c)
    const [d2, d3] = rowsOf(t, c, 'Plywood template')
    t = run(t, c, order(d2.key, { number: 'PO-1' }))
    t = run(t, c, order(d3.key, { lines: [{ key: d3.key, qty: 2 }] }))
    const [a, b] = t.orders!
    expect(fails(t, c, A.setPurchaseOrderNumber(b.id, 'po-1'))).toMatch(/already exists/)
    expect(fails(t, c, A.setPurchaseOrderNumber('nope', 'PO-9'))).toMatch(/not available/)
    expect(fails(t, c, A.setPurchaseOrderNumber(a.id, 'PO-1'))).toBeUndefined() // its own number again is fine
    t = run(t, c, A.recordDelivery({ orderId: b.id, date: TODAY, lines: [{ key: d3.key, qty: 2 }] }, TODAY))
    t = run(t, c, A.setPurchaseOrderNumber(b.id, 'PO-2'))
    expect(t.orders!.find((o) => o.id === b.id)!.number).toBe('PO-2')
  })

  it('a cancelled order can have its number corrected, and its number may then be reused by a live order', () => {
    const { c } = world()
    let t = tracked(c)
    const [d2] = rowsOf(t, c, 'Plywood template')
    t = run(t, c, order(d2.key, { number: 'PO-1' }))
    t = run(t, c, A.cancelPurchaseOrder(t.orders![0].id))
    t = run(t, c, order(d2.key, { number: 'PO-1' })) // the cancelled one does not hold the number
    expect(t.orders!.filter((o) => o.number === 'PO-1')).toHaveLength(2)
  })
})

describe('materials without an anchorage type are named and separated by foundation', () => {
  const fbolt = { qty: 4, diameter: '3/4"', length: 460, lengthUnit: 'mm' as const, thread: 'all-thread' as const, nutsPerBolt: 2, washersPerBolt: 2 }
  function plain() {
    let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
    c = build(c, K.createOrganization({ name: 'Northline' }))
    c = build(c, K.createProject({ name: 'P1' }))
    c = build(c, K.createArea(c.projects[0].id, 'E-House', []))
    const area = c.areas[0].id
    c = build(c, K.createFoundation(area, 'OP1-01-01', '', null, 7, { bolts: [fbolt] }))
    c = build(c, K.createFoundation(area, 'OP1-21-26', '', null, 5, { bolts: [fbolt] }))
    return { c, area }
  }

  it('identical bolts, nuts and washers on two foundations are two requirements named by foundation, each with its own foundation', () => {
    const { c } = plain()
    const t = tracked(c)
    for (const [cat, per] of [['bolt', 4], ['nut', 8], ['washer', 8]] as const) {
      const g = consolidate(t, c).filter((x) => x.category === cat)
      expect(g.map((x) => [materialLabel(x).title, x.required])).toEqual([[`OP1-01-01 ${cat === 'bolt' ? 'Anchor bolt' : cat === 'nut' ? 'Nut' : 'Washer'}`, 7 * per], [`OP1-21-26 ${cat === 'bolt' ? 'Anchor bolt' : cat === 'nut' ? 'Nut' : 'Washer'}`, 5 * per]])
      expect(g.map((x) => x.contributions.map((y) => y.foundation))).toEqual([['OP1-01-01'], ['OP1-21-26']])
    }
    // Procurement reads the same groups
    expect(procurementRows(t, c).filter((r) => r.category === 'bolt').map((r) => [r.key, r.designation, r.required])).toEqual(consolidate(t, c).filter((r) => r.category === 'bolt').map((r) => [r.key, r.designation, r.required]))
  })

  it('an entered material with a foundation and no anchorage type takes the foundation designation; a type, if present, wins; "other" materials stay plain', () => {
    const { c, area } = plain()
    const f = c.foundations[0].id
    let t = tracked(c)
    const entered = (category: string, name: string, foundationId = f) => ({ areaId: area, foundationId, category, name, specification: 'X', size: '', unit: 'ea', requiredQty: 3, basis: 'fixed' }) as never
    t = run(t, c, A.addMaterials([entered('bolt', 'Anchor bolt'), entered('embed-plate', 'Embed plate'), entered('other', 'Grout')], true))
    const g = consolidate(t, c)
    expect(displayName(g.find((x) => x.name === 'Embed plate')!)).toBe('OP1-01-01 Embed plate')
    expect(displayName(g.find((x) => x.name === 'Anchor bolt' && x.specification === 'X')!)).toBe('OP1-01-01 Anchor bolt')
    expect(displayName(g.find((x) => x.name === 'Grout')!)).toBe('Grout')
  })

  it('orders and deliveries made against the previous (unseparated) footing-bolt key follow it when one foundation owns it, and stay visible when several do', () => {
    const { c } = plain()
    let t = tracked(c)
    const [a, b] = consolidate(t, c).filter((x) => x.category === 'bolt')
    const strip = (k: string) => k.slice(0, k.lastIndexOf('|'))
    expect(strip(a.key)).toBe(strip(b.key)) // identical specification: the old key was shared
    const o = { id: 'po1', number: 'PO-1', supplierId: null, supplier: 'Nucor', date: TODAY, expectedDate: null, notes: '', createdAt: NOW, createdBy: 'x' }
    const ref = { areaId: a.areaId, area: 'E-House', category: 'bolt' as const, name: 'Anchor bolt', specification: a.specification, size: '', unit: 'ea' }
    t = { ...t, orders: [o], orderLines: [{ ...ref, key: strip(a.key), id: 'l1', orderId: 'po1', qty: 10 }] }
    const rows = procurementRows(t, c).filter((r) => r.category === 'bolt')
    expect(rows.reduce((s, r) => s + r.ordered, 0)).toBe(10) // counted once
    expect(rows.find((r) => r.ordered === 10)!.required).toBe(0) // on its own old key, not guessed onto either foundation
    // with only one foundation left, the old key follows it
    const only = build(c, K.configureFoundation(c.foundations[1].id, { bolts: [] }))
    const r1 = procurementRows(refreshRequirements(t, only, { log: false }), only).filter((r) => r.category === 'bolt' && r.required > 0)
    expect(r1.map((r) => [r.designation, r.required, r.ordered])).toEqual([['OP1-01-01', 28, 10]])
  })
})

describe('supplier is optional and can be added or changed afterwards', () => {
  const order = (key: string, o: Partial<Parameters<typeof A.createPurchaseOrder>[0]> = {}) => A.createPurchaseOrder({ number: 'PO-1', supplier: '', date: TODAY, lines: [{ key, qty: 5 }], ...o }, TODAY)

  it('orders without a supplier behave exactly like orders with one', () => {
    const { c } = world()
    const t0 = tracked(c)
    const [d2] = rowsOf(t0, c, 'Plywood template')
    const none = run(t0, c, order(d2.key))
    const some = run(t0, c, order(d2.key, { supplier: 'Nucor' }))
    expect(none.orders![0].supplier).toBe('')
    const view = (t: TrackerState) => { const r = rowsOf(t, c, 'Plywood template')[0]; return { ordered: r.ordered, status: r.status, toOrder: r.toOrder, stage: r.stage } }
    expect(view(none)).toEqual(view(some))
    let t = run(none, c, A.recordDelivery({ orderId: none.orders![0].id, date: TODAY, lines: [{ key: d2.key, qty: 5 }] }, TODAY))
    t = run(t, c, A.setAllocations(d2.key, [{ foundationId: c.foundations[0].id, qty: 5 }]))
    expect(rowsOf(t, c, 'Plywood template')[0]).toMatchObject({ ordered: 5, received: 5, allocated: 5, status: 'received' })
    expect(none.history.find((h) => h.action === 'order')!.summary).not.toMatch(/ with /)
  })

  it('a supplier can be added, changed to a listed one, and cleared, in place, keeping the history; an unknown supplier is refused', () => {
    const { c } = world()
    let t = run(tracked(c), c, A.addSupplier('Nucor'))
    const nucor = t.suppliers![0].id
    const [d2] = rowsOf(t, c, 'Plywood template')
    t = run(t, c, order(d2.key))
    const id = t.orders![0].id
    const frozen = { lines: t.orderLines, number: t.orders![0].number, row: rowsOf(t, c, 'Plywood template')[0] }
    t = run(t, c, A.setPurchaseOrderSupplier(id, null, '  Local Lumber '))
    expect(t.orders![0]).toMatchObject({ supplier: 'Local Lumber', supplierId: null })
    t = run(t, c, A.setPurchaseOrderSupplier(id, nucor, ''))
    expect(t.orders![0]).toMatchObject({ supplier: 'Nucor', supplierId: nucor })
    expect(fails(t, c, A.setPurchaseOrderSupplier(id, 'nope', ''))).toMatch(/not available/)
    expect(fails(t, c, A.setPurchaseOrderSupplier('nope', null, 'X'))).toMatch(/not available/)
    t = run(t, c, A.setPurchaseOrderSupplier(id, null, ''))
    expect(t.orders![0]).toMatchObject({ supplier: '', supplierId: null })
    expect(t.orders).toHaveLength(1)
    expect({ lines: t.orderLines, number: t.orders![0].number, row: rowsOf(t, c, 'Plywood template')[0] }).toEqual(frozen)
    const notes = t.history.filter((h) => h.action === 'order' && /^Supplier /.test(h.summary)).map((h) => h.summary.replace(/ \(ordered.*/, ''))
    expect(notes).toEqual(['Supplier added on PO-1: Not Assigned → Local Lumber', 'Supplier changed on PO-1: Local Lumber → Nucor', 'Supplier changed on PO-1: Nucor → Not Assigned'])
    expect(run(t, c, A.setPurchaseOrderSupplier(id, null, '')).history).toHaveLength(t.history.length) // unchanged: no noise
  })
})

describe('order names', () => {
  const place = (key: string, o: Partial<Parameters<typeof A.createPurchaseOrder>[0]> = {}) => A.createPurchaseOrder({ number: '', supplier: '', date: TODAY, lines: [{ key, qty: 5 }], ...o }, TODAY)

  it('an order can be named when created, renamed afterwards and cleared, in place, with PO number and supplier kept separate', () => {
    const { c } = world()
    const t0 = tracked(c)
    const [d2] = rowsOf(t0, c, 'Plywood template')
    let t = run(t0, c, place(d2.key, { name: '  E-House   Formwork Materials ', number: 'PO-1', supplier: 'Nucor' }))
    const id = t.orders![0].id
    expect(t.orders![0]).toMatchObject({ name: 'E-House Formwork Materials', number: 'PO-1', supplier: 'Nucor' })
    expect(orderTitle(t, t.orders![0])).toBe('E-House Formwork Materials')
    const frozen = { lines: t.orderLines, row: rowsOf(t, c, 'Plywood template')[0], number: t.orders![0].number, supplier: t.orders![0].supplier }
    t = run(t, c, A.setPurchaseOrderName(id, 'Site Templates'))
    expect(orderTitle(t, t.orders![0])).toBe('Site Templates')
    expect(t.orders).toHaveLength(1)
    t = run(t, c, A.setPurchaseOrderName(id, ''))
    expect(t.orders![0].name).toBeUndefined()
    expect(orderTitle(t, t.orders![0])).toBe('E-House Plywood templates') // back to the default
    expect({ lines: t.orderLines, row: rowsOf(t, c, 'Plywood template')[0], number: t.orders![0].number, supplier: t.orders![0].supplier }).toEqual(frozen)
    expect(t.history.filter((h) => /^Order name/.test(h.summary)).map((h) => h.summary)).toEqual(['Order name changed: E-House Formwork Materials → Site Templates (PO-1)', 'Order name changed: Site Templates → Default name (PO-1)'])
    expect(run(t, c, A.setPurchaseOrderName(id, '')).history).toHaveLength(t.history.length)
    expect(fails(t, c, A.setPurchaseOrderName('nope', 'X'))).toMatch(/not available/)
  })

  it('an order without a name gets a default from its lines, without the record changing', () => {
    let { c } = world()
    c = build(c, K.createArea(c.projects[0].id, 'Pipe Rack', []))
    c = build(c, K.createFoundation(c.areas[1].id, 'PR-1', '', null, 2, { groups: [{ anchorageTypeId: c.anchorageTypes[0].id, count: 1 }] }))
    const t0 = tracked(c)
    const tpl = rowsOf(t0, c, 'Plywood template'), bolt = rowsOf(t0, c, 'Anchor bolt')
    const eh = tpl.find((r) => r.area === 'E-House')!, pr = tpl.find((r) => r.area === 'Pipe Rack')!
    const one = run(t0, c, place(eh.key))
    expect(orderTitle(one, one.orders![0])).toBe('E-House Plywood templates')
    const mixed = run(t0, c, place(eh.key, { lines: [{ key: eh.key, qty: 1 }, { key: bolt.find((r) => r.area === 'E-House')!.key, qty: 1 }] }))
    expect(orderTitle(mixed, mixed.orders![0])).toBe('E-House materials')
    const areas = run(t0, c, place(eh.key, { lines: [{ key: eh.key, qty: 1 }, { key: pr.key, qty: 1 }] }))
    expect(orderTitle(areas, areas.orders![0])).toBe('Plywood templates · 2 areas')
    expect(orderTitle({ orderLines: [] }, { ...one.orders![0], date: TODAY })).toMatch(/^Order of /)
    expect(one.orders![0].name).toBeUndefined() // nothing stored for the default
  })

  it('naming, PO number and supplier do not affect status, quantities or deliveries', () => {
    const { c } = world()
    const t0 = tracked(c)
    const [d2] = rowsOf(t0, c, 'Plywood template')
    const plain = run(t0, c, place(d2.key))
    const full = run(t0, c, place(d2.key, { name: 'Named', number: 'PO-9', supplier: 'Nucor' }))
    const view = (t: TrackerState) => { const o = t.orders![0]; const p = orderProgress(t, o.id); return { p: [p.ordered, p.received, p.due], row: rowsOf(t, c, 'Plywood template')[0].status } }
    expect(view(plain)).toEqual(view(full))
    for (const t of [plain, full]) {
      const part = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: d2.key, qty: 2 }] }, TODAY))
      expect(orderProgress(part, part.orders![0].id)).toMatchObject({ ordered: 5, received: 2, due: 3 })
      const rest = run(part, c, A.recordDelivery({ orderId: part.orders![0].id, date: TODAY, lines: [{ key: d2.key, qty: 3 }] }, TODAY))
      expect(orderProgress(rest, rest.orders![0].id)).toMatchObject({ ordered: 5, received: 5, due: 0 })
    }
  })
})

describe('editing and deleting orders', () => {
  const place = (lines: { key: string; qty: number }[], o: Partial<Parameters<typeof A.createPurchaseOrder>[0]> = {}) => A.createPurchaseOrder({ number: 'PO-1', supplier: 'Nucor', date: TODAY, lines, ...o }, TODAY)
  function setup2() {
    const { c } = world()
    let t = tracked(c)
    const [d2, d3] = rowsOf(t, c, 'Plywood template')
    const bolt = rowsOf(t, c, 'Anchor bolt')[0]
    t = run(t, c, place([{ key: d2.key, qty: 5 }, { key: d3.key, qty: 6 }, { key: bolt.key, qty: 20 }], { name: 'Site order' }))
    return { c, t, d2, d3, bolt, id: t.orders![0].id, lineOf: (tt: TrackerState, k: string) => tt.orderLines!.find((l) => l.key === k)! }
  }
  const row = (t: TrackerState, c: ConstructionState, d: string, name = 'Plywood template') => rowsOf(t, c, name).find((r) => r.designation === d)!

  it('edits name, PO number, supplier and quantities together; totals, to-order and stage recalculate; each change is in the history', () => {
    const { c, t: t0, d2, d3, id, lineOf } = setup2()
    expect(row(t0, c, 'OP1-D3')).toMatchObject({ ordered: 6, toOrder: 4 })
    const t = run(t0, c, A.editPurchaseOrder(id, { name: 'Formwork', number: 'PO-2', supplier: 'Local', supplierId: null, quantities: [{ lineId: lineOf(t0, d2.key).id, qty: 4 }, { lineId: lineOf(t0, d3.key).id, qty: 10 }] }))
    expect(t.orders).toHaveLength(1)
    expect(t.orders![0]).toMatchObject({ id, name: 'Formwork', number: 'PO-2', supplier: 'Local' })
    expect(row(t, c, 'OP1-D2')).toMatchObject({ ordered: 4, toOrder: 1, stage: 'partially-ordered' })
    expect(row(t, c, 'OP1-D3')).toMatchObject({ ordered: 10, toOrder: 0, stage: 'ordered' }) // fully covered now
    expect(orderProgress(t, id).ordered).toBe(4 + 10 + 20)
    expect(t.orderLines).toHaveLength(3) // edited in place: no duplicate or lost lines
    const h = t.history.filter((x) => x.action === 'order').slice(-2)
    expect(h[0].summary).toMatch(/Order details changed on Site order: Order name Site order → Formwork; PO number PO-1 → PO-2; Supplier Nucor → Local/)
    expect(h[1].summary).toMatch(/Quantities changed on Formwork: .*OP1-D2 Plywood template.*5 → 4; .*OP1-D3 Plywood template.*6 → 10 \(order now 34 items\)/)
    expect(h[1].changes).toHaveLength(2)
    // identical edit again: nothing changes, nothing is logged
    expect(run(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lineOf(t, d2.key).id, qty: 4 }] })).history).toHaveLength(t.history.length)
  })

  it('refuses invalid quantities and conflicting details, leaving the order exactly as it was', () => {
    const { c, t, d2, id, lineOf } = setup2()
    const lid = lineOf(t, d2.key).id
    for (const qty of [0, -3, 1.5, Number.NaN]) expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty }] }))).toMatch(/whole number of 1 or more/)
    expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 2 }, { lineId: lid, qty: 3 }] }))).toMatch(/listed twice/)
    expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: 'nope', qty: 2 }] }))).toMatch(/no longer on this order/)
    expect(fails(t, c, A.editPurchaseOrder('nope', { name: 'x' }))).toMatch(/not available/)
    expect(fails(t, c, A.editPurchaseOrder(id, { supplierId: 'missing' }))).toMatch(/not available/)
    const other = run(t, c, place([{ key: rowsOf(t, c, 'Plywood template')[1].key, qty: 1 }], { number: 'PO-9' }))
    expect(fails(other, c, A.editPurchaseOrder(id, { number: 'po-9' }))).toMatch(/already exists/)
    const cancelled = run(t, c, A.cancelPurchaseOrder(id))
    expect(fails(cancelled, c, A.editPurchaseOrder(id, { name: 'x' }))).toMatch(/not available/)
  })

  it('cannot reduce a line below what was delivered against it; partial deliveries keep working after an increase', () => {
    const { c, t: t0, d3, id, lineOf } = setup2()
    let t = run(t0, c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: d3.key, qty: 4 }] }, TODAY))
    const lid = lineOf(t, d3.key).id
    expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 3 }] }))).toMatch(/4 has already been delivered .* cannot be reduced below that/)
    t = run(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 4 }] })) // exactly what was delivered is fine
    expect(orderProgress(t, id).lines.find((l) => l.line.id === lid)).toMatchObject({ received: 4, due: 0 })
    t = run(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 9 }] }))
    expect(orderProgress(t, id).lines.find((l) => l.line.id === lid)).toMatchObject({ received: 4, due: 5 })
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: d3.key, qty: 5 }] }, TODAY))
    expect(row(t, c, 'OP1-D3')).toMatchObject({ ordered: 9, received: 9, status: 'partial', toOrder: 1 }) // 9 of the 10 required
  })

  it('cannot leave a requirement ordered for less than has been allocated', () => {
    const { c, t: t0, d2, id, lineOf } = setup2()
    // 5 arrive without an order and are all allocated; the order for the same requirement is 5
    let t = run(t0, c, A.recordDelivery({ date: TODAY, lines: [{ key: d2.key, qty: 5 }] }, TODAY))
    t = run(t, c, A.setAllocations(d2.key, [{ foundationId: c.foundations[0].id, qty: 5 }]))
    const lid = lineOf(t, d2.key).id
    expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 3 }] }))).toMatch(/5 has been allocated .* more than the 3 that would remain ordered/)
    expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 5 }] }))).toBeUndefined()
    expect(fails(t, c, A.editPurchaseOrder(id, { quantities: [{ lineId: lid, qty: 8 }] }))).toBeUndefined()
  })

  it('deleting an order removes it from the calculations at once, keeps a full record in the history, and the requirements read as still to order', () => {
    const { c, t: t0, d2, d3, bolt, id } = setup2()
    const before = progressCounts(procurementRows(t0, c).filter((r) => r.required > 0))
    const t = run(t0, c, A.deletePurchaseOrder(id))
    expect(t.orders).toHaveLength(0)
    expect(t.orderLines).toHaveLength(0)
    expect(row(t, c, 'OP1-D2')).toMatchObject({ ordered: 0, toOrder: 5, status: 'pending', stage: 'pending' })
    expect(row(t, c, 'OP1-D3')).toMatchObject({ ordered: 0, toOrder: 10 })
    expect(rowsOf(t, c, 'Anchor bolt')[0]).toMatchObject({ ordered: 0, toOrder: bolt.required })
    const after = progressCounts(procurementRows(t, c).filter((r) => r.required > 0))
    expect(before.ordered).toBeGreaterThanOrEqual(0)
    expect(after.ordered).toBe(0)
    expect(after.outstanding).toBe(after.total)
    const last = t.history.at(-1)!
    expect(last.action).toBe('order')
    expect(last.summary).toMatch(/^Order deleted: Site order · PO PO-1 · Nucor · ordered 2026-10-30 — 3 materials, 31 items: 5 × .*OP1-D2 Plywood template.*; 6 × .*OP1-D3 Plywood template.*; 20 × /)
    expect(last.changes).toHaveLength(3)
    expect(last.changes.every((x) => x.to === 'deleted')).toBe(true)
    expect(t.history.filter((x) => x.action === 'order')).toHaveLength(2) // the placement and the deletion both remain
    void d2; void d3
    expect(fails(t, c, A.deletePurchaseOrder(id))).toMatch(/no longer exists/)
  })

  it('a deleted order can be placed again without duplicate records or a number clash', () => {
    const { c, t: t0, d2, id } = setup2()
    let t = run(t0, c, A.deletePurchaseOrder(id))
    t = run(t, c, place([{ key: d2.key, qty: 5 }])) // same PO number as the deleted one
    expect(t.orders).toHaveLength(1)
    expect(row(t, c, 'OP1-D2')).toMatchObject({ ordered: 5, toOrder: 0 })
  })

  it('refuses to delete an order with deliveries and explains; allows it after the deliveries are voided; refuses when allocations would exceed what stays ordered', () => {
    const { c, t: t0, d2, id } = setup2()
    let t = run(t0, c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: d2.key, qty: 2 }] }, TODAY))
    expect(fails(t, c, A.deletePurchaseOrder(id))).toMatch(/Deliveries have been recorded against Site order, so it cannot be deleted\. Void those deliveries first/)
    expect(fails(t, c, A.cancelPurchaseOrder(id))).toMatch(/cannot be cancelled/) // the existing safe workflow is equally protective
    t = run(t, c, A.voidDelivery(t.deliveries![0].id))
    // allocations from a delivery that arrived with no order
    const t1 = run(t, c, A.recordDelivery({ date: TODAY, lines: [{ key: d2.key, qty: 5 }] }, TODAY))
    const t2 = run(t1, c, A.setAllocations(d2.key, [{ foundationId: c.foundations[0].id, qty: 5 }]))
    expect(fails(t2, c, A.deletePurchaseOrder(id))).toMatch(/cannot be deleted\. .*5 has been allocated/)
    expect(run(t, c, A.deletePurchaseOrder(id)).orders).toHaveLength(0)
    // a cancelled order (already out of the calculations) can always be deleted, and its record stays in the history
    const cancelled = run(t, c, A.cancelPurchaseOrder(id))
    const gone = run(cancelled, c, A.deletePurchaseOrder(id))
    expect(gone.orders).toHaveLength(0)
    expect(gone.history.at(-1)!.summary).toMatch(/was cancelled/)
  })
})
