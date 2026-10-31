/* eslint-disable prefer-const -- fixtures where only some bindings are reassigned */
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { consolidate, displayName, materialLabel } from '../tracker/consolidate'
import { mergeAcrossAreas, procurementRows } from '../tracker/procurement'
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
