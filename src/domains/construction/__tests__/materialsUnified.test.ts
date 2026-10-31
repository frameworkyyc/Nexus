import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { materialsIndicator } from '../packageProgress'
import { effectiveStatus, getIndex, plinthActivities, foundationMaterial, boltStageLabel } from '../selectors'
import { lineProgress, materialsModel } from '../tracker/model'
import { areaMaterialsSummary, orderProgress, procurementRows, progressCounts, unlinkedDeliveries } from '../tracker/procurement'
import { areaBreakdown, dashboardCounts, deliveryState, toCsv, allLines } from '../tracker/selectors'
import type { TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'
import { allocateFully, build, CATEGORIES, fails, liveRows, orderAll, receipt, run, tracked, TODAY, world } from './materialsFixtures'

const DERIVED: [string, string][] = [['anchorBolts', 'bolt'], ['nuts', 'nut'], ['washers', 'washer'], ['templates', 'template']]

/**
 * An independent oracle for what a foundation's material activity should read, worked out straight from the raw records (not through the model):
 * complete when everything the foundation needs of the category is allocated to it; in progress when some is allocated or any requirement it needs
 * has been ordered or delivered; otherwise not started.
 */
function oracle(t: TrackerState, c: ConstructionState, foundationId: string, category: string) {
  const rows = liveRows(t, c).filter((r) => r.category === category)
  let need = 0, alloc = 0, sourced = false
  for (const r of rows) {
    const n = r.contributions.filter((x) => x.foundationId === foundationId).reduce((a, x) => a + x.qty, 0)
    if (n === 0) continue
    need += n
    alloc += Math.min(n, (t.allocations ?? []).filter((a) => a.key === r.key && a.foundationId === foundationId).reduce((a, x) => a + x.qty, 0))
    if (r.ordered > 0 || r.received > 0) sourced = true
  }
  return { need, alloc, status: need > 0 && alloc >= need ? 'complete' : alloc > 0 || sourced ? 'in-progress' : 'not-started' }
}

/** Everything every page would show must tell the same story. Checked after every step of every scenario. */
function assertAgreement(t: TrackerState, c: ConstructionState) {
  const idx = getIndex(c, t)
  const model = materialsModel(t, c)
  const all = procurementRows(t, c)
  expect(model.rows).toBe(all) // one calculation, shared
  // Materials, Procurement and the Area Overview, per area
  for (const area of c.areas) {
    const rows = all.filter((r) => r.areaId === area.id && r.required > 0)
    const g = progressCounts(rows)
    const summary = areaMaterialsSummary(t, c, area.id)
    expect(summary.counts).toEqual(g)
    const ind = materialsIndicator(idx, area.id, t)
    expect(ind.percent).toBe(g.total === 0 ? null : Math.round((g.delivered / g.total) * 100))
    // a requirement that is fully received reads Delivered, or further along (partly installed, installed); never earlier
    expect(rows.filter((r) => ['delivered', 'partially-installed', 'installed'].includes(r.stage) && r.received >= r.required).length).toBe(g.delivered)
    expect(rows.filter((r) => r.received < r.required).every((r) => !['delivered', 'installed'].includes(r.stage))).toBe(true)
    // Material records: every line carries its requirement's figures; counts and breakdown agree with the gauges
    const lines = allLines(t).filter((l) => !l.archived && l.areaId === area.id)
    for (const l of lines) {
      const row = model.rowOfLine(l.id)
      if (!row) continue
      const p = lineProgress(model, l)
      expect([p.received, p.outstanding, p.required, p.stage]).toEqual([row.received, row.outstanding, row.required, row.stage])
    }
    const bd = areaBreakdown(lines, (l) => lineProgress(model, l)).find((b) => b.area === area.name)
    if (bd) {
      expect(bd.required).toBe(rows.reduce((a, r) => a + r.required, 0)) // a requirement of several lines is counted once
      expect(bd.received).toBe(rows.reduce((a, r) => a + Math.min(r.required, r.received), 0))
    }
    void dashboardCounts
  }
  // Foundation details, per foundation and category
  for (const f of c.foundations) {
    for (const cat of CATEGORIES) {
      const o = oracle(t, c, f.id, cat)
      const fm = foundationMaterial(idx, f.id, cat)
      expect(fm?.required ?? 0, `${f.number} ${cat} needed`).toBe(o.need)
      expect(fm?.allocated ?? 0, `${f.number} ${cat} allocated`).toBe(o.alloc)
      expect(fm?.status ?? 'not-started', `${f.number} ${cat} status`).toBe(o.status)
    }
    for (const p of c.plinths.filter((x) => x.foundationId === f.id)) {
      for (const a of plinthActivities(idx, p)) {
        const d = DERIVED.find(([k]) => k === a.key)
        if (d) expect(effectiveStatus(idx, a), `${f.number} ${a.key}`).toBe(oracle(t, c, f.id, d[1]).status)
      }
    }
  }
  // Nothing is counted twice: what the rows hold is what the records hold
  const orderedRecords = (t.orderLines ?? []).reduce((s, l) => {
    const o = (t.orders ?? []).find((x) => x.id === l.orderId)!
    const got = (t.deliveryLines ?? []).filter((d) => d.orderLineId === l.id).reduce((a, d) => a + d.qty, 0)
    return s + (o.cancelled ? Math.min(l.qty, got) : l.qty)
  }, 0)
  expect(all.reduce((s, r) => s + r.ordered, 0)).toBe(orderedRecords)
  expect(all.reduce((s, r) => s + r.received, 0)).toBe((t.deliveryLines ?? []).reduce((s, l) => s + l.qty, 0))
  expect(all.reduce((s, r) => s + r.allocated, 0)).toBe((t.allocations ?? []).reduce((s, l) => s + l.qty, 0))
  for (const r of all) for (const v of [r.ordered, r.received, r.allocated, r.installed, r.outstanding, r.toOrder, r.unallocated]) expect(v).toBeGreaterThanOrEqual(0)
}

const derivedStatuses = (t: TrackerState, c: ConstructionState, foundationId: string) => {
  const idx = getIndex(c, t)
  return Object.fromEntries(DERIVED.map(([key]) => [key, [...new Set(c.plinths.filter((p) => p.foundationId === foundationId).flatMap((p) => plinthActivities(idx, p)).filter((a) => a.key === key).map((a) => effectiveStatus(idx, a)))]]))
}

describe('the audit contradictions, reproduced and fixed', () => {
  it('H1: with every material delivered, foundation material activities no longer read "not started"', () => {
    const { c, f1, f2, f3 } = world()
    let t = tracked(c)
    const rows = liveRows(t, c)
    t = orderAll(t, c, rows)
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receipt(rows) }, TODAY))
    expect(rows.every((r) => procurementRows(t, c).find((x) => x.key === r.key)!.stage === 'delivered')).toBe(true)
    for (const f of [f1, f2, f3]) {
      const d = derivedStatuses(t, c, f)
      for (const [key, cat] of DERIVED) {
        const needs = oracle(t, c, f, cat).need > 0
        expect(d[key], `${f} ${key}`).toEqual([needs ? 'in-progress' : 'not-started']) // delivered, not yet allocated
      }
    }
    // the same records through the old, record-blind index reproduce the contradiction the audit found
    const blind = getIndex(c)
    const act = plinthActivities(blind, c.plinths.find((p) => p.foundationId === f1)!).find((a) => a.key === 'anchorBolts')!
    expect(effectiveStatus(blind, act)).toBe('not-started')
    expect(effectiveStatus(getIndex(c, t), act)).toBe('in-progress')
    assertAgreement(t, c)
  })

  it('H1: allocating what a foundation needs completes its material activities; the bolt stage label follows', () => {
    const { c, f1, f3 } = world()
    let t = tracked(c)
    const rows = liveRows(t, c)
    t = orderAll(t, c, rows)
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receipt(rows) }, TODAY))
    for (const r of procurementRows(t, c).filter((x) => x.category === 'bolt' && x.area === 'E-House')) t = allocateFully(t, c, r)
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['complete'])
    expect(derivedStatuses(t, c, f1).nuts).toEqual(['in-progress']) // nuts are delivered but not allocated
    expect(derivedStatuses(t, c, f3).anchorBolts).toEqual(['in-progress']) // Pipe Rack bolts not allocated
    const idx = getIndex(c, t)
    expect(boltStageLabel(idx, c.plinths.find((p) => p.foundationId === f1)!)).toBe('Allocated')
    expect(boltStageLabel(idx, c.plinths.find((p) => p.foundationId === f3)!)).toBe('Not allocated')
    assertAgreement(t, c)
  })

  it('H2: Material records show what Procurement received (a delivery recorded in Procurement used to read "not delivered" there)', () => {
    const { c, eh } = world()
    let t = tracked(c)
    const rows = liveRows(t, c)
    t = orderAll(t, c, rows)
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receipt(rows) }, TODAY))
    const model = materialsModel(t, c)
    const lines = allLines(t).filter((l) => l.areaId === eh && !l.archived)
    expect(lines.length).toBeGreaterThan(3)
    for (const l of lines) {
      expect(deliveryState(l), 'the old per-line view of the same records').toBe('none-received')
      const p = lineProgress(model, l)
      expect(p.state).toBe('received')
      expect(p.stage).toBe('delivered')
      expect(p.outstanding).toBe(0)
    }
    expect(dashboardCounts(lines, (l) => lineProgress(model, l).state)).toMatchObject({ total: lines.length, delivered: lines.length, partial: 0, pending: 0 })
    expect(dashboardCounts(lines)).toMatchObject({ delivered: 0, pending: lines.length }) // what the page showed before
    expect(toCsv(lines, (l) => { const p = lineProgress(model, l); return { received: p.received, outstanding: p.outstanding, state: p.state, label: 'Delivered' } })).toContain(',Delivered,')
    assertAgreement(t, c)
  })

  it('H2: a requirement made of several lines is counted once in the Material records summary', () => {
    const { c, eh, f1, D2 } = world()
    let t = tracked(c)
    const calc = liveRows(t, c).find((r) => r.category === 'bolt' && r.areaId === eh && r.designation === 'OP1-D2')!
    t = run(t, c, A.addMaterials([{ areaId: eh, foundationId: f1, anchorageTypeId: D2, category: 'bolt', name: 'Anchor bolt', specification: calc.specification, size: '', unit: 'ea', requiredQty: 10, basis: 'fixed' } as never]))
    const row = procurementRows(t, c).find((r) => r.key === calc.key)!
    expect(row.lines.length).toBe(2)
    const model = materialsModel(t, c)
    const mine = row.lines.map((l) => lineProgress(model, l))
    expect(mine.every((p) => p.shared && p.required === row.required)).toBe(true)
    const bd = areaBreakdown(allLines(t).filter((l) => l.areaId === eh && !l.archived), (l) => lineProgress(model, l)).find((b) => b.area === 'E-House')!
    expect(bd.required).toBe(model.areaRows(eh).reduce((a, r) => a + r.required, 0)) // not inflated by the shared requirement
    assertAgreement(t, c)
  })
})

describe('Materials, Procurement, Foundation details, Material records and Area Overview agree through the whole lifecycle', () => {
  it('create → partial → complete → allocate → install → correct → void → delete, all six categories, two areas', () => {
    const { c, eh, pr, f1, f2, f3 } = world()
    let t = tracked(c)
    const base = liveRows(t, c)
    expect(new Set(base.map((r) => r.category))).toEqual(new Set(CATEGORIES))
    expect(new Set(base.map((r) => r.areaId))).toEqual(new Set([eh, pr]))
    const required0 = base.map((r) => [r.key, r.required])
    assertAgreement(t, c)
    for (const f of [f1, f2, f3]) for (const k of Object.values(derivedStatuses(t, c, f))) expect(k).toEqual(['not-started'])

    // 1. create orders
    t = orderAll(t, c, base)
    const id = t.orders![0].id
    assertAgreement(t, c)
    expect(procurementRows(t, c).filter((r) => r.required > 0).every((r) => r.stage === 'ordered')).toBe(true)
    expect(materialsIndicator(getIndex(c, t), eh, t).percent).toBe(0)
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['in-progress'])

    // 2. partial delivery
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, reference: 'DN-1', lines: receipt(base, 0.5) }, TODAY))
    assertAgreement(t, c)
    expect(liveRows(t, c).every((r) => r.stage === 'partially-delivered')).toBe(true)
    expect(materialsIndicator(getIndex(c, t), eh, t).percent).toBe(0)

    // 3. complete delivery
    const rest = liveRows(t, c).map((r) => ({ key: r.key, qty: r.required - r.received }))
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, reference: 'DN-2', lines: rest }, TODAY))
    assertAgreement(t, c)
    expect(liveRows(t, c).every((r) => r.stage === 'delivered')).toBe(true)
    for (const a of [eh, pr]) expect(materialsIndicator(getIndex(c, t), a, t).percent).toBe(100)

    // 4. allocate: E-House bolts only
    const ehBolts = procurementRows(t, c).filter((r) => r.category === 'bolt' && r.areaId === eh)
    for (const r of ehBolts) t = allocateFully(t, c, r)
    assertAgreement(t, c)
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['complete'])
    expect(derivedStatuses(t, c, f2).anchorBolts).toEqual(['complete'])
    expect(derivedStatuses(t, c, f3).anchorBolts).toEqual(['in-progress'])
    // allocating everything else completes every foundation's material activities
    for (const r of procurementRows(t, c).filter((x) => x.required > 0 && !ehBolts.some((b) => b.key === x.key))) t = allocateFully(t, c, r)
    assertAgreement(t, c)
    for (const f of [f1, f2, f3]) for (const [key, cat] of DERIVED) expect(derivedStatuses(t, c, f)[key]).toEqual([oracle(t, c, f, cat).need > 0 ? 'complete' : 'not-started'])

    // 5. install some bolts: the requirement's stage moves on; delivered and allocated figures do not
    const bolt = procurementRows(t, c).find((r) => r.category === 'bolt' && r.areaId === eh && r.designation === 'OP1-D2')!
    t = run(t, c, A.recordInstallation({ key: bolt.key, qty: 2, date: TODAY }, TODAY))
    const after = procurementRows(t, c).find((r) => r.key === bolt.key)!
    expect(after).toMatchObject({ installed: 2, stage: 'partially-installed', received: bolt.received, allocated: bolt.allocated })
    assertAgreement(t, c)
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['complete'])
    t = run(t, c, A.voidInstallation(t.installations![0].id))

    // 6. correct a delivery: allocated material cannot be corrected away; unallocated can
    const dn1 = t.deliveries!.find((d) => d.reference === 'DN-1')!
    const allocatedLine = t.deliveryLines!.find((l) => l.deliveryId === dn1.id && l.key === bolt.key)!
    expect(fails(t, c, A.correctDelivery(dn1.id, { quantities: [{ lineId: allocatedLine.id, qty: 1 }] }, TODAY))).toMatch(/allocated/)
    for (const r of procurementRows(t, c).filter((x) => x.required > 0)) t = run(t, c, A.setAllocations(r.key, [...new Set(r.contributions.map((x) => x.foundationId).filter(Boolean))].map((foundationId) => ({ foundationId: foundationId!, qty: 0 }))))
    assertAgreement(t, c)
    for (const f of [f1, f2, f3]) for (const k of Object.values(derivedStatuses(t, c, f))) expect(k.every((s) => s !== 'complete')).toBe(true)
    t = run(t, c, A.correctDelivery(dn1.id, { quantities: [{ lineId: allocatedLine.id, qty: 1 }] }, TODAY))
    assertAgreement(t, c)
    expect(procurementRows(t, c).find((r) => r.key === bolt.key)!.stage).toBe('partially-delivered')

    // 7. void both deliveries: back to ordered everywhere
    for (const d of t.deliveries!.map((x) => x.id)) t = run(t, c, A.voidDelivery(d))
    assertAgreement(t, c)
    expect(liveRows(t, c).every((r) => r.stage === 'ordered')).toBe(true)
    for (const a of [eh, pr]) expect(materialsIndicator(getIndex(c, t), a, t).percent).toBe(0)
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['in-progress']) // ordered, nothing delivered

    // 8. delete the order: everything back to pending / not started; requirements unchanged
    t = run(t, c, A.deletePurchaseOrder(id))
    assertAgreement(t, c)
    expect(liveRows(t, c).every((r) => r.stage === 'pending' && r.ordered === 0 && r.received === 0 && r.allocated === 0)).toBe(true)
    for (const f of [f1, f2, f3]) for (const k of Object.values(derivedStatuses(t, c, f))) expect(k).toEqual(['not-started'])
    expect(liveRows(t, c).map((r) => [r.key, r.required])).toEqual(required0)
  })

  it('a cancelled order keeps the deliveries it received: they still count everywhere and still count as sourced for the foundation', () => {
    const { c, f1, f2, eh } = world()
    let t = tracked(c)
    const rows = liveRows(t, c)
    t = orderAll(t, c, rows)
    const id = t.orders![0].id
    const bolts = rows.filter((r) => r.category === 'bolt')
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, lines: receipt(bolts) }, TODAY))
    t = run(t, c, A.cancelPurchaseOrder(id))
    assertAgreement(t, c)
    for (const r of procurementRows(t, c).filter((x) => x.required > 0)) {
      if (r.category === 'bolt') expect(r).toMatchObject({ ordered: r.required, received: r.required, stage: 'delivered' })
      else expect(r).toMatchObject({ ordered: 0, received: 0, stage: 'pending' })
    }
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['in-progress'])
    expect(derivedStatuses(t, c, f1).nuts).toEqual(['not-started'])
    for (const r of procurementRows(t, c).filter((x) => x.category === 'bolt' && x.areaId === eh)) t = allocateFully(t, c, r)
    assertAgreement(t, c)
    expect(derivedStatuses(t, c, f1).anchorBolts).toEqual(['complete'])
    expect(derivedStatuses(t, c, f2).anchorBolts).toEqual(['complete'])
    expect(orderProgress(t, id)).toMatchObject({ received: bolts.reduce((a, r) => a + r.required, 0) })
  })

  it('legitimate deliveries recorded without an order count as delivered and sourced, and survive deleting every order', () => {
    const { c, f1, eh } = world()
    let t = tracked(c)
    const rows = liveRows(t, c)
    t = orderAll(t, c, rows)
    t = run(t, c, A.recordDelivery({ date: TODAY, lines: receipt(rows.filter((r) => r.category === 'nut')) }, TODAY)) // no order chosen
    t = run(t, c, A.deletePurchaseOrder(t.orders![0].id))
    assertAgreement(t, c)
    expect(unlinkedDeliveries(t).count).toBe(1)
    const nuts = procurementRows(t, c).filter((r) => r.category === 'nut' && r.required > 0)
    expect(nuts.every((r) => r.received === r.required && r.ordered === 0 && r.stage === 'delivered')).toBe(true)
    expect(derivedStatuses(t, c, f1).nuts).toEqual(['in-progress'])
    expect(materialsIndicator(getIndex(c, t), eh, t).percent).toBe(Math.round((nuts.filter((r) => r.areaId === eh).length / liveRows(t, c).filter((r) => r.areaId === eh).length) * 100))
  })

  it('every category in turn: delivering and allocating just that category moves only that category', () => {
    const { c, f1, f2, f3 } = world()
    const t0 = orderAll(tracked(c), c, liveRows(tracked(c), c))
    for (const cat of CATEGORIES) {
      let t = t0
      const rows = procurementRows(t, c).filter((r) => r.category === cat && r.required > 0)
      t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receipt(rows) }, TODAY))
      for (const r of rows) t = allocateFully(t, c, r)
      assertAgreement(t, c)
      for (const r of procurementRows(t, c).filter((x) => x.required > 0)) expect(r.stage, `${cat}: ${r.category}`).toBe(r.category === cat ? 'delivered' : 'ordered')
      for (const f of [f1, f2, f3]) for (const [key, derivedCat] of DERIVED) {
        const needs = oracle(t, c, f, derivedCat).need > 0
        expect(derivedStatuses(t, c, f)[key], `${cat} → ${f} ${key}`).toEqual([!needs ? 'not-started' : derivedCat === cat ? 'complete' : 'in-progress'])
      }
    }
  })

  it('footing bolts belong to their own foundation: its details show them, and another foundation does not', () => {
    const w = world()
    let c = w.c
    const k = { qty: 4, diameter: '3/4"', length: 460, lengthUnit: 'mm' as const, thread: 'all-thread' as const, nutsPerBolt: 2, washersPerBolt: 2 }
    c = build(c, K.configureFoundation(w.f1, { bolts: [k] }))
    let t = tracked(c)
    const footing = liveRows(t, c).filter((r) => r.category === 'bolt' && r.contributions.some((x) => x.anchorage === 'Footing'))
    expect(footing).toHaveLength(1)
    t = orderAll(t, c, footing)
    t = run(t, c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: receipt(footing) }, TODAY))
    const idx = getIndex(c, t)
    const mine = foundationMaterial(idx, w.f1, 'bolt')!
    expect(mine.rows.some(({ row }) => row.key === footing[0].key)).toBe(true)
    expect(mine.rows.find(({ row }) => row.key === footing[0].key)!.needed).toBe(4 * 5) // 4 bolts × 5 footings
    expect(foundationMaterial(idx, w.f2, 'bolt')!.rows.some(({ row }) => row.key === footing[0].key)).toBe(false)
    expect(foundationMaterial(idx, w.f2, 'bolt')!.status).toBe('not-started') // F-2's own bolts are not ordered; the footing bolts are not its
    assertAgreement(t, c)
  })
})
