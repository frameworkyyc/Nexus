import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { materialsIndicator } from '../packageProgress'
import { getIndex } from '../selectors'
import { areaMaterialsSummary, orderProgress, procurementRows, progressCounts, unlinkedDeliveries, type ProcRow } from '../tracker/procurement'
import { refreshRequirements } from '../tracker/requirements'
import { emptyTracker, type TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'

const TODAY = '2026-10-30'
const NOW = '2026-10-30T12:00:00Z'
function build(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
function run(t: TrackerState, c: ConstructionState, r: A.Reducer): TrackerState { const o = r(t, { construction: c, actor: 'jo@example.com', now: NOW }); if (o.error !== undefined) throw new Error(o.error); return o.state }
const fails = (t: TrackerState, c: ConstructionState, r: A.Reducer) => r(t, { construction: c, actor: 'jo@example.com', now: NOW }).error
const tracked = (c: ConstructionState) => refreshRequirements(emptyTracker(), c, { log: true, at: NOW })

/** Two areas with every material category: bolts, nuts, washers (from the bolt), sole plates, plywood templates and embed plates. */
function world() {
  let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  c = build(c, K.createOrganization({ name: 'Northline' }))
  c = build(c, K.createProject({ name: 'P1' }))
  const pid = c.projects[0].id
  c = build(c, K.createArea(pid, 'E-House', []))
  c = build(c, K.createArea(pid, 'Pipe Rack', []))
  c = build(c, K.addAnchorageType(pid, 'OP1-D2', 'D2'))
  c = build(c, K.addAnchorageType(pid, 'OP1-D3', 'D3'))
  const [D2, D3] = c.anchorageTypes.map((t) => t.id)
  const bolt = (d: string) => ({ kind: 'bolt' as const, qty: 4, diameter: d, length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 })
  c = build(c, K.setAnchorageComponents(D2, [bolt('M25'), { kind: 'sole-plate', qty: 1, size: '6 x 280 x 280 mm' }, { kind: 'template', qty: 1, spec: '19 mm plywood' }]))
  c = build(c, K.setAnchorageComponents(D3, [bolt('M30'), { kind: 'embed-plate', qty: 1, size: '16 x 320 x 520 mm' }]))
  const [eh, pr] = c.areas.map((a) => a.id)
  c = build(c, K.createFoundation(eh, 'F-1', '', null, 5, { groups: [{ anchorageTypeId: D2, count: 1 }] }))
  c = build(c, K.createFoundation(eh, 'F-2', '', null, 3, { groups: [{ anchorageTypeId: D3, count: 1 }] }))
  c = build(c, K.createFoundation(pr, 'F-3', '', null, 4, { groups: [{ anchorageTypeId: D2, count: 1 }, { anchorageTypeId: D3, count: 1 }] }))
  return { c, eh, pr, D2, D3 }
}

/** Everything the three kinds of view show for one area, each worked out the way that view does it. */
function views(t: TrackerState, c: ConstructionState, areaId: string) {
  const rows = procurementRows(t, c).filter((r) => r.areaId === areaId && r.required > 0)
  const gauges = progressCounts(rows) // the Materials gauges and the Procurement gauges
  const indicator = materialsIndicator(getIndex(c), areaId, t) // the Area Overview
  const summary = areaMaterialsSummary(t, c, areaId)
  return { rows, gauges, indicator, summary, stages: [...new Set(rows.map((r) => r.stage))], statuses: [...new Set(rows.map((r) => r.status))] }
}
const allPending = (v: ReturnType<typeof views>) => {
  expect(v.stages).toEqual(['pending'])
  expect(v.statuses).toEqual(['pending'])
  expect(v.gauges).toMatchObject({ ordered: 0, delivered: 0, allocated: 0, outstanding: v.gauges.total })
  expect(v.indicator.percent).toBe(0)
  expect(v.rows.every((r) => r.ordered === 0 && r.received === 0 && r.allocated === 0 && r.installed === 0 && r.toOrder === r.required)).toBe(true)
}
/** The three surfaces must tell one story. */
const agree = (v: ReturnType<typeof views>) => {
  expect(v.summary.counts).toEqual(v.gauges)
  expect(v.indicator.percent).toBe(v.gauges.total === 0 ? null : Math.round((v.gauges.delivered / v.gauges.total) * 100))
  expect(v.indicator.rows[0].value).toBe(`${v.gauges.delivered} / ${v.gauges.total}`)
  expect(v.rows.filter((r) => r.stage === 'delivered' || r.stage === 'installed').length).toBe(v.gauges.delivered)
}
const orderAll = (t: TrackerState, c: ConstructionState, rows: ProcRow[], o: { name: string; number?: string }) =>
  run(t, c, A.createPurchaseOrder({ ...o, number: o.number ?? '', supplier: '', date: TODAY, lines: rows.map((r) => ({ key: r.key, qty: r.required })) }, TODAY))
const receiveLines = (rows: ProcRow[], f = 1) => rows.map((r) => ({ key: r.key, qty: Math.max(1, Math.floor(r.required * f)) }))
const foundationFingerprint = (c: ConstructionState) => JSON.stringify({ f: c.foundations, p: c.plinths, g: c.anchorageGroups, a: c.areas })
const requiredOf = (t: TrackerState, c: ConstructionState) => procurementRows(t, c).filter((r) => r.required > 0).map((r) => [r.key, r.required])

describe('Materials, Procurement and Area Overview stay in step through an order\'s whole life', () => {
  it('covers every category in two areas (the world is as intended)', () => {
    const { c, eh, pr } = world()
    const t = tracked(c)
    expect([...new Set(procurementRows(t, c).filter((r) => r.required > 0).map((r) => r.category))].sort()).toEqual(['bolt', 'embed-plate', 'nut', 'sole-plate', 'template', 'washer'])
    for (const a of [eh, pr]) { const v = views(t, c, a); expect(v.rows.length).toBeGreaterThan(5); allPending(v); agree(v) }
  })

  it('create → partial delivery → correct → void → delete: every status, quantity and gauge returns to Pending / 0 / 0%', () => {
    const { c, eh, pr } = world()
    const base = tracked(c)
    const required0 = requiredOf(base, c), foundations0 = foundationFingerprint(c)
    const all = procurementRows(base, c).filter((r) => r.required > 0)
    // 1. create an order covering everything in both areas
    let t = orderAll(base, c, all, { name: 'Everything' })
    for (const a of [eh, pr]) { const v = views(t, c, a); expect(v.stages).toEqual(['ordered']); expect(v.gauges).toMatchObject({ ordered: v.gauges.total, delivered: 0, outstanding: 0 }); expect(v.indicator.percent).toBe(0); agree(v) }
    // 2. a partial delivery (half of every material), against the order
    const id = t.orders![0].id
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, reference: 'DN-1', lines: receiveLines(all, 0.5) }, TODAY))
    for (const a of [eh, pr]) { const v = views(t, c, a); expect(v.stages).toEqual(['partially-delivered']); expect(v.gauges.delivered).toBe(0); expect(v.indicator.percent).toBe(0); expect(v.summary.partlyDelivered).toBe(v.gauges.total); agree(v) }
    expect(orderProgress(t, id)).toMatchObject({ ordered: all.reduce((a, r) => a + r.required, 0) })
    // 3. a second delivery completes every material in E-House only
    const house = all.filter((r) => r.areaId === eh)
    const half = procurementRows(t, c).filter((r) => r.areaId === eh && r.required > 0)
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, reference: 'DN-2', lines: half.map((r) => ({ key: r.key, qty: r.required - r.received })) }, TODAY))
    const vh = views(t, c, eh), vp = views(t, c, pr)
    expect(vh.gauges).toMatchObject({ delivered: vh.gauges.total }); expect(vh.indicator.percent).toBe(100); expect(vh.stages).toEqual(['delivered']); agree(vh)
    expect(vp.indicator.percent).toBe(0); agree(vp)
    // 4. correct the first delivery (reduce one line), then void both deliveries
    const dn1 = t.deliveries!.find((d) => d.reference === 'DN-1')!, dn2 = t.deliveries!.find((d) => d.reference === 'DN-2')!
    const line = t.deliveryLines!.find((l) => l.deliveryId === dn1.id)!
    t = run(t, c, A.correctDelivery(dn1.id, { quantities: [{ lineId: line.id, qty: 1 }] }, TODAY))
    expect(t.deliveryLines!.find((l) => l.id === line.id)!.qty).toBe(1)
    t = run(t, c, A.voidDelivery(dn2.id)); t = run(t, c, A.voidDelivery(dn1.id))
    for (const a of [eh, pr]) { const v = views(t, c, a); expect(v.stages).toEqual(['ordered']); expect(v.rows.every((r) => r.received === 0)).toBe(true); expect(v.indicator.percent).toBe(0); agree(v) }
    expect(t.deliveries).toHaveLength(0); expect(t.deliveryLines).toHaveLength(0)
    // 5. delete the order: everything is back to Pending, requirements and foundations are untouched
    t = run(t, c, A.deletePurchaseOrder(id))
    for (const a of [eh, pr]) { const v = views(t, c, a); allPending(v); agree(v) }
    expect(requiredOf(t, c)).toEqual(required0)
    expect(foundationFingerprint(c)).toBe(foundations0)
    // the audit trail kept every step
    const acts = t.history.map((h) => h.action + ':' + h.summary.split(' ')[0])
    expect(acts.filter((x) => x.startsWith('order:')).length).toBeGreaterThanOrEqual(2)
    expect(t.history.filter((h) => h.action === 'delivery').length).toBeGreaterThanOrEqual(5) // 2 received, 1 corrected, 2 voided
    void house
  })

  it('an order in one area leaves the other area untouched, and deleting it restores only its own area', () => {
    const { c, eh, pr } = world()
    const base = tracked(c)
    const house = procurementRows(base, c).filter((r) => r.areaId === eh && r.required > 0)
    let t = orderAll(base, c, house, { name: 'House only' })
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receiveLines(house, 1) }, TODAY)) // full
    expect(views(t, c, eh).indicator.percent).toBe(100)
    allPending(views(t, c, pr))
    t = run(t, c, A.voidDelivery(t.deliveries![0].id)); t = run(t, c, A.deletePurchaseOrder(t.orders![0].id))
    allPending(views(t, c, eh)); allPending(views(t, c, pr))
  })

  it('orders for several areas on one order: deleting it resets both areas', () => {
    const { c, eh, pr } = world()
    const base = tracked(c)
    const some = procurementRows(base, c).filter((r) => r.required > 0 && ['bolt', 'nut'].includes(r.category))
    let t = orderAll(base, c, some, { name: 'Hardware' })
    expect(views(t, c, eh).gauges.ordered).toBeGreaterThan(0); expect(views(t, c, pr).gauges.ordered).toBeGreaterThan(0)
    t = run(t, c, A.deletePurchaseOrder(t.orders![0].id))
    allPending(views(t, c, eh)); allPending(views(t, c, pr))
  })
})

describe('cancelled orders keep legitimate deliveries, separately from deleted ones', () => {
  it('a cancelled order\'s delivered quantities keep counting everywhere; its undelivered quantities go back to Pending', () => {
    const { c, eh, pr } = world()
    const base = tracked(c)
    const all = procurementRows(base, c).filter((r) => r.required > 0)
    let t = orderAll(base, c, all, { name: 'Everything' })
    const id = t.orders![0].id
    const bolts = all.filter((r) => r.category === 'bolt')
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, lines: bolts.map((r) => ({ key: r.key, qty: r.required })) }, TODAY)) // bolts delivered in full, nothing else
    t = run(t, c, A.cancelPurchaseOrder(id))
    for (const a of [eh, pr]) {
      const v = views(t, c, a)
      agree(v)
      for (const r of v.rows) {
        if (r.category === 'bolt') expect(r).toMatchObject({ ordered: r.required, received: r.required, stage: 'delivered', toOrder: 0 }) // retained
        else expect(r).toMatchObject({ ordered: 0, received: 0, stage: 'pending', toOrder: r.required }) // restored
      }
      expect(v.gauges.delivered).toBe(v.rows.filter((r) => r.category === 'bolt').length)
      expect(v.indicator.percent).toBe(Math.round((v.gauges.delivered / v.gauges.total) * 100))
      expect(v.gauges.ordered).toBe(v.gauges.delivered) // only what was delivered stays ordered
    }
    // it cannot be deleted while those deliveries stand; reversing them and then deleting returns everything to Pending
    expect(fails(t, c, A.deletePurchaseOrder(id))).toMatch(/cannot be deleted/)
    for (const d of t.deliveries!.map((x) => x.id)) t = run(t, c, A.voidDelivery(d))
    for (const a of [eh, pr]) { const v = views(t, c, a); allPending(v); agree(v) }
    t = run(t, c, A.deletePurchaseOrder(id))
    expect(t.orders).toHaveLength(0)
    for (const a of [eh, pr]) allPending(views(t, c, a))
  })

  it('cancelling an order with no deliveries returns all of it to Pending', () => {
    const { c, eh, pr } = world()
    const base = tracked(c)
    let t = orderAll(base, c, procurementRows(base, c).filter((r) => r.required > 0), { name: 'All' })
    t = run(t, c, A.cancelPurchaseOrder(t.orders![0].id))
    for (const a of [eh, pr]) allPending(views(t, c, a))
  })
})

describe('deliveries recorded without an order (the case found on staging)', () => {
  function stagingLike() {
    const { c, eh, pr } = world()
    const base = tracked(c)
    const all = procurementRows(base, c).filter((r) => r.required > 0)
    // an order is placed, then the delivery is recorded WITHOUT choosing the order
    let t = orderAll(base, c, all, { name: 'Placed first' })
    t = run(t, c, A.historicalUnlinkedDelivery({ date: TODAY, lines: receiveLines(all.filter((r) => ['bolt', 'nut', 'washer'].includes(r.category)), 1) }, TODAY))
    return { c, eh, pr, t, all, orderId: t.orders![0].id }
  }

  it('they are real receipts: deleting the order leaves them counted, consistently in every view, and they are reported as unlinked', () => {
    const { c, eh, pr, t: t0, orderId } = stagingLike()
    const t = run(t0, c, A.deletePurchaseOrder(orderId)) // allowed: nothing is linked to the order
    expect(t.orders).toHaveLength(0)
    const delivered = [eh, pr].map((a) => views(t, c, a))
    for (const v of delivered) {
      agree(v) // Materials gauges, Procurement and the Area Overview all agree with each other
      expect(v.gauges.ordered).toBe(0) // nothing is on order
      expect(v.gauges.delivered).toBeGreaterThan(0) // yet what was received is received
      expect(v.rows.filter((r) => r.stage === 'delivered').every((r) => ['bolt', 'nut', 'washer'].includes(r.category) && r.ordered === 0 && r.received === r.required)).toBe(true)
      expect(v.rows.filter((r) => !['bolt', 'nut', 'washer'].includes(r.category)).every((r) => r.stage === 'pending')).toBe(true)
    }
    const u = unlinkedDeliveries(t)
    expect(u.count).toBe(1)
    expect(u.items).toBeGreaterThan(0)
    expect(unlinkedDeliveries(t, new Set([eh])).count).toBe(1)
    expect(unlinkedDeliveries(t, new Set(['no-such-area'])).count).toBe(0)
  })

  it('voiding the unlinked deliveries (audited) returns every area to Pending / 0 / 0%', () => {
    const { c, eh, pr, t: t0, orderId } = stagingLike()
    let t = run(t0, c, A.deletePurchaseOrder(orderId))
    t = run(t, c, A.voidDelivery(t.deliveries![0].id))
    for (const a of [eh, pr]) { const v = views(t, c, a); allPending(v); agree(v) }
    expect(unlinkedDeliveries(t).count).toBe(0)
    expect(t.history.some((h) => h.action === 'delivery' && /voided/.test(h.summary))).toBe(true)
  })

  it('an unlinked delivery can be attached to the order it belonged to; the order then owns it, so it cannot be deleted from under it', () => {
    const { c, eh, t: t0, orderId } = stagingLike()
    let t = t0
    const did = t.deliveries![0].id
    expect(unlinkedDeliveries(t).count).toBe(1)
    t = run(t, c, A.correctDelivery(did, { orderId }, TODAY))
    expect(unlinkedDeliveries(t).count).toBe(0)
    expect(t.deliveries![0].orderId).toBe(orderId)
    expect(t.deliveryLines!.every((l) => !!l.orderLineId)).toBe(true)
    expect(orderProgress(t, orderId).received).toBeGreaterThan(0)
    agree(views(t, c, eh))
    expect(fails(t, c, A.deletePurchaseOrder(orderId))).toMatch(/cannot be deleted/)
    expect(t.history.at(-1)!.summary).toMatch(/Order No order → Placed first/)
    // detaching returns it to "no order"
    t = run(t, c, A.correctDelivery(did, { orderId: null }, TODAY))
    expect(unlinkedDeliveries(t).count).toBe(1)
    expect(t.deliveryLines!.every((l) => l.orderLineId === null)).toBe(true)
  })

  it('refuses to attach a delivery to an order that does not contain all its materials, or to a cancelled or unknown order', () => {
    const { c, t: t0, all } = stagingLike()
    let t = t0
    const did = t.deliveries![0].id
    // every requirement is already fully ordered here, so the one-line order is built directly (new orders cannot exceed what is still to order)
    const washerLine = t.orderLines!.find((l) => l.key === all.find((r) => r.category === 'washer')!.key)!
    const smallId = 'po-only-washers'
    const small = { ...t, orders: [...t.orders!, { ...t.orders![0], id: smallId, name: 'Only washers', number: '' }], orderLines: [...t.orderLines!, { ...washerLine, id: 'pol-only-washers', orderId: smallId, qty: 1 }] }
    expect(fails(small, c, A.correctDelivery(did, { orderId: smallId }, TODAY))).toMatch(/is not on Only washers/)
    expect(fails(t, c, A.correctDelivery(did, { orderId: 'nope' }, TODAY))).toMatch(/not available/)
    t = run(t, c, A.cancelPurchaseOrder(t.orders![0].id))
    expect(fails(t, c, A.correctDelivery(did, { orderId: t.orders![0].id }, TODAY))).toMatch(/cancelled, so deliveries cannot be attached/)
  })

  it('a delivery recorded against an order is linked to it, so deleting that order is blocked until the delivery is reversed', () => {
    const { c, eh } = world()
    const base = tracked(c)
    const all = procurementRows(base, c).filter((r) => r.required > 0)
    let t = orderAll(base, c, all, { name: 'Linked' })
    const id = t.orders![0].id
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, lines: receiveLines(all.slice(0, 3), 1) }, TODAY))
    expect(unlinkedDeliveries(t).count).toBe(0)
    expect(fails(t, c, A.deletePurchaseOrder(id))).toMatch(/cannot be deleted/)
    agree(views(t, c, eh))
  })
})

describe('statuses come from quantities, never from stored text', () => {
  it('a manually entered line carrying a stored "Delivered" status, or any other claim, does not change what is shown', () => {
    const { c, eh } = world()
    let t = tracked(c)
    t = run(t, c, A.addMaterials([{ areaId: eh, foundationId: '', category: 'other', name: 'Grout', specification: 'Type 10', size: '', unit: 'bag', requiredQty: 6, basis: 'fixed', claimedStatus: 'Delivered' } as never], true))
    const grout = procurementRows(t, c).find((r) => r.name === 'Grout')!
    expect(t.manual.find((l) => l.component === 'Grout')!.sourceStatus).toBe('Delivered') // stored as typed...
    expect(grout).toMatchObject({ received: 0, ordered: 0, stage: 'pending', status: 'pending' }) // ...but ignored: quantities decide
    expect(views(t, c, eh).gauges.delivered).toBe(0)
  })

  it('every status changes the moment the records change, with nothing cached: rebuilding from the same records gives the same answer', () => {
    const { c, eh } = world()
    const base = tracked(c)
    const all = procurementRows(base, c).filter((r) => r.required > 0)
    let t = orderAll(base, c, all, { name: 'X' })
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receiveLines(all, 1) }, TODAY))
    const once = views(t, c, eh)
    const rebuilt = views(JSON.parse(JSON.stringify(t)), JSON.parse(JSON.stringify(c)), eh)
    expect(rebuilt.gauges).toEqual(once.gauges)
    expect(rebuilt.indicator.percent).toBe(once.indicator.percent)
    t = run(t, c, A.voidDelivery(t.deliveries![0].id))
    t = run(t, c, A.deletePurchaseOrder(t.orders![0].id))
    expect(views(JSON.parse(JSON.stringify(t)), c, eh).gauges.delivered).toBe(0)
  })
})
