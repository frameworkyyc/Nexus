import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { availableToOrder, procurementRows, type ProcRow } from '../tracker/procurement'
import type { TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'
import { areaChoices, areaKey, categoryChoices, materialChoices, mergeLines, orderableRows, quantityProblem } from '../procurement/orderSelection'
import { build, fails, liveRows, run, tracked, TODAY, world } from './materialsFixtures'

vi.mock('../tracker/store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useTracker: () => ({ state: {}, today: TODAY }) }))
const { MaterialPicker } = await import('../procurement/Dialogs')

const place = (lines: { key: string; qty: number }[], over: { number?: string; name?: string } = {}) => A.createPurchaseOrder({ name: over.name ?? '', number: over.number ?? '', supplier: 'Acme', date: TODAY, lines }, TODAY)
const rowOf = (t: TrackerState, c: ConstructionState, key: string) => procurementRows(t, c).find((r) => r.key === key)!
const setup = () => { const w = world(); const t0 = tracked(w.c); const rows = liveRows(t0, w.c); return { ...w, t0, rows, bolt: rows.find((r) => r.category === 'bolt' && r.area === 'E-House')! } }
const lastOrder = (t: TrackerState) => t.orders!.at(-1)!.id

describe('what can still be ordered', () => {
  it('not ordered: the full requirement; partly ordered: only the rest; fully ordered: gone', () => {
    const s = setup()
    const R = s.bolt.required
    expect(availableToOrder(s.bolt)).toBe(R)
    expect(orderableRows(s.rows).some((r) => r.key === s.bolt.key)).toBe(true)
    let t = run(s.t0, s.c, place([{ key: s.bolt.key, qty: Math.floor(R * 0.6) }]))
    let r = rowOf(t, s.c, s.bolt.key)
    expect(availableToOrder(r)).toBe(R - Math.floor(R * 0.6))
    expect(orderableRows(procurementRows(t, s.c)).some((x) => x.key === s.bolt.key)).toBe(true)
    t = run(t, s.c, place([{ key: s.bolt.key, qty: availableToOrder(r) }]))
    r = rowOf(t, s.c, s.bolt.key)
    expect(availableToOrder(r)).toBe(0)
    expect(orderableRows(procurementRows(t, s.c)).some((x) => x.key === s.bolt.key)).toBe(false)
    expect(materialChoices(procurementRows(t, s.c), areaKey(r), 'bolt').some((x) => x.key === s.bolt.key)).toBe(false)
  })

  it('a cancelled order releases only what had not been delivered', () => {
    const s = setup()
    const R = s.bolt.required
    // cancelled before anything arrived: the whole quantity is available again
    let t = run(s.t0, s.c, place([{ key: s.bolt.key, qty: R }]))
    expect(availableToOrder(rowOf(t, s.c, s.bolt.key))).toBe(0)
    t = run(t, s.c, A.cancelPurchaseOrder(lastOrder(t)))
    expect(availableToOrder(rowOf(t, s.c, s.bolt.key))).toBe(R)
    // part delivered, then cancelled: what arrived stays accounted for; only the undelivered part is released
    const got = Math.max(1, Math.floor(R / 3))
    let u = run(s.t0, s.c, place([{ key: s.bolt.key, qty: R }]))
    u = run(u, s.c, A.recordDelivery({ orderId: lastOrder(u), date: TODAY, lines: [{ key: s.bolt.key, qty: got }] }, TODAY))
    u = run(u, s.c, A.cancelPurchaseOrder(lastOrder(u)))
    expect(availableToOrder(rowOf(u, s.c, s.bolt.key))).toBe(R - got)
    expect(rowOf(u, s.c, s.bolt.key).received).toBe(got)
  })

  it('a deleted order is recalculated from the orders that remain', () => {
    const s = setup()
    const R = s.bolt.required
    let t = run(s.t0, s.c, place([{ key: s.bolt.key, qty: 2 }], { number: 'A' }))
    const a = lastOrder(t)
    t = run(t, s.c, place([{ key: s.bolt.key, qty: 3 }], { number: 'B' }))
    expect(availableToOrder(rowOf(t, s.c, s.bolt.key))).toBe(R - 5)
    t = run(t, s.c, A.deletePurchaseOrder(a))
    expect(availableToOrder(rowOf(t, s.c, s.bolt.key))).toBe(R - 3)
  })

  it('received material is never offered again, whether it came through an order or arrived with no order', () => {
    const s = setup()
    const R = s.bolt.required
    let t = run(s.t0, s.c, place([{ key: s.bolt.key, qty: R }]))
    t = run(t, s.c, A.recordDelivery({ orderId: lastOrder(t), date: TODAY, lines: [{ key: s.bolt.key, qty: R }] }, TODAY))
    expect(availableToOrder(rowOf(t, s.c, s.bolt.key))).toBe(0)
    // a historical delivery recorded with no order (kept and counted) is accounted for too
    const h = run(s.t0, s.c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: s.bolt.key, qty: 7 }] }, TODAY))
    expect(rowOf(h, s.c, s.bolt.key).toOrder).toBe(R) // the older figure does not know about it
    expect(availableToOrder(rowOf(h, s.c, s.bolt.key))).toBe(R - 7) // the order form does
    const h2 = run(h, s.c, place([{ key: s.bolt.key, qty: R - 7 }]))
    expect(availableToOrder(rowOf(h2, s.c, s.bolt.key))).toBe(0)
    expect(fails(h, s.c, place([{ key: s.bolt.key, qty: R }]))).toMatch(/only .* still available to order/)
  })
})

describe('Area → category → material', () => {
  it('lists every area, with how many requirements in it can still be ordered, and only categories that still have something', () => {
    const s = setup()
    const areas = areaChoices(s.rows, s.c.areas.map((a) => ({ id: a.id, name: a.name })))
    expect(areas.map((a) => a.name)).toEqual(['E-House', 'Pipe Rack'])
    expect(areas.every((a) => a.count > 0)).toBe(true)
    const cats = categoryChoices(s.rows, s.eh).map((c) => c.category)
    expect(cats).toEqual(expect.arrayContaining(['bolt', 'nut', 'washer']))
    expect(cats).not.toContain('top-plate') // none configured yet
    // order every sole plate in E-House: that category is no longer offered there, but still is in Pipe Rack
    const soles = s.rows.filter((r) => r.category === 'sole-plate')
    const eh = soles.filter((r) => r.areaId === s.eh)
    const t = run(s.t0, s.c, place(eh.map((r) => ({ key: r.key, qty: r.required }))))
    const rows = procurementRows(t, s.c)
    expect(categoryChoices(rows, s.eh).map((c) => c.category)).not.toContain('sole-plate')
    expect(categoryChoices(rows, s.pr).map((c) => c.category)).toContain('sole-plate')
    expect(materialChoices(rows, s.pr, 'sole-plate').map((r) => r.areaId)).toEqual([s.pr])
  })

  it('fully ordered areas say so, and category counts follow the order lines already on the form', () => {
    const s = setup()
    const all = orderableRows(s.rows).filter((r) => r.areaId === s.pr)
    const t = run(s.t0, s.c, place(all.map((r) => ({ key: r.key, qty: r.required }))))
    const areas = areaChoices(procurementRows(t, s.c), s.c.areas.map((a) => ({ id: a.id, name: a.name })))
    expect(areas.find((a) => a.id === s.pr)!.count).toBe(0)
    expect(categoryChoices(procurementRows(t, s.c), s.pr)).toEqual([])
    // lines already on the form are left out of the lists
    const onForm = new Set([s.bolt.key])
    expect(materialChoices(s.rows, s.eh, 'bolt', '', onForm).some((r) => r.key === s.bolt.key)).toBe(false)
    expect(categoryChoices(s.rows, s.eh, new Set(s.rows.filter((r) => r.areaId === s.eh && r.category === 'bolt').map((r) => r.key))).map((c) => c.category)).not.toContain('bolt')
  })

  it('searches within the selected category by designation and specification', () => {
    const s = setup()
    const bolts = materialChoices(s.rows, s.eh, 'bolt')
    expect(bolts.length).toBeGreaterThan(0)
    expect(materialChoices(s.rows, s.eh, 'bolt', 'M25').every((r) => /M25/.test(`${r.designation} ${r.specification} ${r.size}`))).toBe(true)
    expect(materialChoices(s.rows, s.eh, 'bolt', 'no-such-thing')).toEqual([])
    expect(materialChoices(s.rows, s.eh, 'bolt', 'OP1-D2').every((r) => r.designation === 'OP1-D2')).toBe(true)
  })

  it('Top plates appear in their own category, after Sole plates, until fully ordered', () => {
    const w = world()
    const comps = w.c.anchorageComponents!.filter((x) => x.anchorageTypeId === w.D2).map((x) => ({ ...x }))
    const c = build(w.c, K.setAnchorageComponents(w.D2, [...comps, { kind: 'top-plate', qty: 2, thickness: 12, width: 300, length: 400, lengthUnit: 'mm' }]))
    const t = tracked(c)
    const rows = procurementRows(t, c)
    const cats = categoryChoices(rows, w.eh).map((x) => x.category)
    expect(cats.indexOf('top-plate')).toBe(cats.indexOf('sole-plate') + 1)
    expect(categoryChoices(rows, w.eh).find((x) => x.category === 'top-plate')!.label).toBe('Top plates')
    const tp = materialChoices(rows, w.eh, 'top-plate')
    expect(tp.map((r) => r.size)).toEqual(['12 × 300 × 400 mm'])
    const done = run(t, c, place([{ key: tp[0].key, qty: tp[0].required }]))
    expect(categoryChoices(procurementRows(done, c), w.eh).map((x) => x.category)).not.toContain('top-plate')
  })

  it('the panel offers Area and Material category selectors, not one long list of materials', () => {
    const s = setup()
    const html = renderToStaticMarkup(<MaterialPicker rows={s.rows} areas={s.c.areas.map((a) => ({ id: a.id, name: a.name }))} taken={new Set()} onAdd={() => {}} />)
    expect(html).toContain('aria-label="Area"')
    expect(html).toContain('aria-label="Material category"')
    expect(html).toContain('Choose an area first')
    expect(html).not.toContain('Materials to order') // materials are listed only after an area and category are chosen
    expect((html.match(/<option/g) ?? []).length).toBeLessThan(8)
    expect(html).toMatch(/E-House \(\d+ to order\)/)
  })
})

describe('one order can span areas and categories', () => {
  it('multi-area, multi-category orders are accepted as one purchase order', () => {
    const s = setup()
    const pick = [s.rows.find((r) => r.category === 'bolt' && r.areaId === s.eh)!, s.rows.find((r) => r.category === 'sole-plate' && r.areaId === s.pr)!, s.rows.find((r) => r.category === 'washer' && r.areaId === s.eh)!]
    const t = run(s.t0, s.c, place(pick.map((r) => ({ key: r.key, qty: 1 }))))
    expect(t.orders).toHaveLength(1)
    expect(t.orderLines!.map((l) => l.area).sort()).toEqual(['E-House', 'E-House', 'Pipe Rack'])
    expect(new Set(t.orderLines!.map((l) => l.category)).size).toBe(3)
    // and more can be added to it afterwards, still across areas
    const more = s.rows.find((r) => r.category === 'nut' && r.areaId === s.pr)!
    const t2 = run(t, s.c, A.addOrderLines(t.orders![0].id, [{ key: more.key, qty: 2 }]))
    expect(t2.orderLines).toHaveLength(4)
  })

  it('duplicate selections of one requirement are combined, and refused when they add up to too much', () => {
    expect(mergeLines([{ key: 'a', qty: 2 }, { key: 'b', qty: 1 }, { key: 'a', qty: 3 }])).toEqual([{ key: 'a', qty: 5 }, { key: 'b', qty: 1 }])
    const s = setup()
    const R = s.bolt.required
    const merged = mergeLines([{ key: s.bolt.key, qty: 1 }, { key: s.bolt.key, qty: 1 }])
    expect(run(s.t0, s.c, place(merged)).orderLines![0].qty).toBe(2)
    const tooMuch = mergeLines([{ key: s.bolt.key, qty: R }, { key: s.bolt.key, qty: 1 }])
    expect(fails(s.t0, s.c, place(tooMuch))).toMatch(/only .* still available to order/)
    // sent un-merged, the server still refuses a requirement listed twice
    expect(fails(s.t0, s.c, place([{ key: s.bolt.key, qty: 1 }, { key: s.bolt.key, qty: 1 }]))).toMatch(/already on this order/)
  })
})

describe('the server checks again when the order is saved', () => {
  it('refuses more than is available, and a requirement that is already fully ordered, with a clear message', () => {
    const s = setup()
    const R = s.bolt.required
    const e = fails(s.t0, s.c, place([{ key: s.bolt.key, qty: R + 1 }]))
    expect(e).toMatch(new RegExp(`only ${R.toLocaleString('en-CA')} is still available to order \\(required ${R.toLocaleString('en-CA')}, already ordered or received 0\\)`))
    const t = run(s.t0, s.c, place([{ key: s.bolt.key, qty: R }]))
    expect(fails(t, s.c, place([{ key: s.bolt.key, qty: 1 }]))).toMatch(/already fully ordered/)
    expect(fails(s.t0, s.c, place([{ key: s.bolt.key, qty: 0 }]))).toMatch(/whole number/)
  })

  it('an order placed by someone else while the form was open is accounted for', () => {
    const s = setup()
    const R = s.bolt.required
    const mine = place([{ key: s.bolt.key, qty: R }]) // built from a form that showed the full quantity
    const theirs = run(s.t0, s.c, place([{ key: s.bolt.key, qty: R - 1 }])) // someone else orders almost all of it first
    expect(fails(theirs, s.c, mine)).toMatch(/only 1 is still available to order/)
    const same = run(s.t0, s.c, place([{ key: s.bolt.key, qty: R }]))
    expect(fails(same, s.c, mine)).toMatch(/already fully ordered/)
  })

  it('adding lines to an existing order and raising a quantity are limited the same way', () => {
    const s = setup()
    const R = s.bolt.required
    let t = run(s.t0, s.c, place([{ key: s.rows.find((r) => r.category === 'nut')!.key, qty: 1 }]))
    const id = lastOrder(t)
    expect(fails(t, s.c, A.addOrderLines(id, [{ key: s.bolt.key, qty: R + 5 }]))).toMatch(/only .* still available to order/)
    t = run(t, s.c, A.addOrderLines(id, [{ key: s.bolt.key, qty: R - 1 }]))
    const line = t.orderLines!.find((l) => l.key === s.bolt.key)!
    expect(fails(t, s.c, A.editPurchaseOrder(id, { quantities: [{ lineId: line.id, qty: line.qty + 2 }] }))).toMatch(/only 1 more is available to order/)
    expect(fails(t, s.c, A.editPurchaseOrder(id, { quantities: [{ lineId: line.id, qty: line.qty + 1 }] }))).toBeUndefined()
    expect(fails(t, s.c, A.editPurchaseOrder(id, { quantities: [{ lineId: line.id, qty: 1 }] }))).toBeUndefined() // reducing is always allowed
  })

  it('a requirement that no longer applies cannot be ordered, but its existing orders are kept', () => {
    const s = setup()
    let t = run(s.t0, s.c, place([{ key: s.bolt.key, qty: 1 }]))
    const c2 = build(s.c, K.setAnchorageComponents(s.D2, []))
    t = tracked(c2, t)
    const gone = procurementRows(t, c2).find((r) => r.key === s.bolt.key)!
    expect(gone).toMatchObject({ required: 0, orphan: true, ordered: 1 })
    expect(quantityProblem(gone, 1)).toBeTruthy()
    expect(fails(t, c2, place([{ key: s.bolt.key, qty: 1 }]))).toMatch(/no longer required|already fully ordered/)
    expect(t.orderLines).toHaveLength(1)
  })
})

describe('nothing else changes', () => {
  it('placing a valid order leaves every other requirement, order, delivery and allocation as it was', () => {
    const s = setup()
    let t = run(s.t0, s.c, place([{ key: s.rows[0].key, qty: 2 }]))
    t = run(t, s.c, A.recordDelivery({ orderId: lastOrder(t), date: TODAY, lines: [{ key: s.rows[0].key, qty: 1 }] }, TODAY))
    const before = procurementRows(t, s.c)
    const orders = JSON.stringify([t.orders, t.orderLines, t.deliveries, t.deliveryLines, t.allocations])
    const t2 = run(t, s.c, place([{ key: s.rows[3].key, qty: 1 }], { number: 'NEW' }))
    const after = procurementRows(t2, s.c)
    const changed = after.filter((r, i) => JSON.stringify([r.ordered, r.received, r.allocated, r.installed]) !== JSON.stringify([before[i].ordered, before[i].received, before[i].allocated, before[i].installed]))
    expect(changed.map((r: ProcRow) => r.key)).toEqual([s.rows[3].key])
    expect(JSON.stringify([t2.orders!.slice(0, 1), t2.orderLines!.slice(0, 1), t2.deliveries, t2.deliveryLines, t2.allocations])).toBe(JSON.stringify([JSON.parse(orders)[0], JSON.parse(orders)[1], JSON.parse(orders)[2], JSON.parse(orders)[3], JSON.parse(orders)[4]]))
    // the figure the panel uses equals the existing "still to order" wherever nothing arrived without an order
    for (const r of after) expect(availableToOrder(r)).toBe(r.toOrder)
  })
})
