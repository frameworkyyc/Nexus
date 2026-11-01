import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as A from '../tracker/actions'
import { procurementRows } from '../tracker/procurement'
import type { TrackerState } from '../tracker/types'
import { getIndex } from '../selectors'
import { dueOf, hasLineIn, isOverdue, orderedIn, procurementSummary } from '../procurement/summary'
import { Donut } from '@/components/ui/Donut'
import { GaugeFigure } from '@/components/ui/ProgressGauge'
import { pct } from '@/lib/format'
import { percent } from '../selectors'
import { fails, liveRows, run, tracked, TODAY, world } from './materialsFixtures'

const s = (() => { const w = world(); const t0 = tracked(w.c); return { ...w, t0, rows: liveRows(t0, w.c) } })()
const [r1, r2] = s.rows
const order = (t: TrackerState, lines: { key: string; qty: number }[], expectedDate: string | null = null, number = '') =>
  run(t, s.c, A.createPurchaseOrder({ name: '', number, supplier: 'Acme', date: TODAY, expectedDate, lines }, TODAY))
const summary = (t: TrackerState) => procurementSummary(procurementRows(t, s.c), t, t.orders ?? [], TODAY)

describe('Procurement summary (the four gauges)', () => {
  it('starts with everything pending, as a share of what is required', () => {
    const m = summary(s.t0)
    const R = s.rows.reduce((a, r) => a + r.required, 0)
    expect(m).toMatchObject({ required: R, pending: R, ordered: 0, delivered: 0, overdue: 0 })
    expect(m.percent).toEqual({ pending: 100, ordered: 0, delivered: 0, overdue: 0 })
  })

  it('moves quantities from pending to ordered to delivered as orders and deliveries are recorded, and the three always add up', () => {
    let t = order(s.t0, [{ key: r1.key, qty: r1.required }])
    let m = summary(t)
    expect(m).toMatchObject({ pending: m.required - r1.required, ordered: r1.required, delivered: 0 })
    const id = t.orders![0].id
    t = run(t, s.c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: r1.key, qty: 2 }] }, TODAY))
    m = summary(t)
    expect(m).toMatchObject({ ordered: r1.required, delivered: 2 }) // receiving never lowers Ordered
    expect(m.pending + m.ordered).toBe(m.required)
    expect(m.percent.delivered).toBe(Math.round((2 / m.required) * 100))
  })

  it('Ordered is cumulative: 100% once everything is ordered, and still 100% after everything is delivered', () => {
    const every = s.rows.map((r) => ({ key: r.key, qty: r.required }))
    let t = order(s.t0, every)
    let m = summary(t)
    expect(m).toMatchObject({ ordered: m.required, pending: 0, delivered: 0 })
    expect(m.percent).toMatchObject({ ordered: 100, pending: 0, delivered: 0 })
    t = run(t, s.c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: every }, TODAY))
    m = summary(t)
    expect(m).toMatchObject({ ordered: m.required, delivered: m.required, pending: 0 })
    expect(m.percent).toMatchObject({ ordered: 100, delivered: 100 })
  })

  it('order changes: lowering a quantity or cancelling moves it back to Pending; raising it adds, never double-counts', () => {
    let t = order(s.t0, [{ key: r1.key, qty: 10 }])
    const id = t.orders![0].id, line = t.orderLines![0].id
    const before = summary(t)
    t = run(t, s.c, A.editPurchaseOrder(id, { quantities: [{ lineId: line, qty: 4 }] }))
    expect(summary(t).ordered).toBe(4)
    expect(summary(t).pending).toBe(before.pending + 6)
    t = run(t, s.c, A.editPurchaseOrder(id, { quantities: [{ lineId: line, qty: 7 }] }))
    expect(summary(t).ordered).toBe(7)
    t = run(t, s.c, A.cancelPurchaseOrder(id))
    expect(summary(t)).toMatchObject({ ordered: 0, pending: before.required })
  })

  it('a cancelled order goes back to pending (keeping what arrived as delivered)', () => {
    let t = order(s.t0, [{ key: r1.key, qty: r1.required }])
    t = run(t, s.c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: r1.key, qty: 1 }] }, TODAY))
    t = run(t, s.c, A.cancelPurchaseOrder(t.orders![0].id))
    const m = summary(t)
    expect(m).toMatchObject({ ordered: 1, delivered: 1 }) // a cancelled order keeps only what arrived: no double counting
    expect(m.pending + m.ordered).toBe(m.required)
  })

  it('overdue counts only what is still owed on live orders whose expected date has passed', () => {
    let t = order(s.t0, [{ key: r1.key, qty: 10 }], '2026-10-01', 'LATE')
    const late = t.orders![0].id
    t = order(t, [{ key: r2.key, qty: 4 }], '2026-12-01', 'FUTURE')
    t = order(t, [{ key: s.rows[2].key, qty: 3 }], null, 'NODATE')
    expect(summary(t)).toMatchObject({ overdue: 10, overdueOrders: 1 })
    t = run(t, s.c, A.recordDelivery({ orderId: late, date: TODAY, lines: [{ key: r1.key, qty: 6 }] }, TODAY))
    expect(summary(t)).toMatchObject({ overdue: 4, overdueOrders: 1 })
    t = run(t, s.c, A.recordDelivery({ orderId: late, date: TODAY, lines: [{ key: r1.key, qty: 4 }] }, TODAY))
    expect(summary(t)).toMatchObject({ overdue: 0, overdueOrders: 0 }) // received in full: no longer overdue
    expect(isOverdue(t, t.orders!.find((o) => o.number === 'FUTURE')!, TODAY)).toBe(false)
    const placed = order(s.t0, [{ key: r1.key, qty: 5 }], '2026-10-01')
    const cancelled = run(placed, s.c, A.cancelPurchaseOrder(placed.orders![0].id))
    expect(summary(cancelled).overdue).toBe(0)
  })

  it('an expected date can be added, changed and cleared on an existing order, and the Overdue figure follows at once', () => {
    let t = order(s.t0, [{ key: r1.key, qty: 10 }])
    const id = t.orders![0].id
    expect(summary(t)).toMatchObject({ overdue: 0, overdueOrders: 0 })
    t = run(t, s.c, A.editPurchaseOrder(id, { expectedDate: '2026-10-01' }))
    expect(t.orders![0].expectedDate).toBe('2026-10-01')
    expect(summary(t)).toMatchObject({ overdue: 10, overdueOrders: 1 })
    t = run(t, s.c, A.editPurchaseOrder(id, { expectedDate: '2026-12-31' }))
    expect(summary(t).overdue).toBe(0)
    t = run(t, s.c, A.editPurchaseOrder(id, { expectedDate: '2026-10-02' }))
    t = run(t, s.c, A.editPurchaseOrder(id, { expectedDate: null }))
    expect(t.orders![0].expectedDate).toBeNull()
    expect(summary(t).overdue).toBe(0)
    expect(t.history!.filter((h) => /Expected delivery/.test(h.summary)).length).toBe(4) // every change is in the history
    expect(fails(t, s.c, A.editPurchaseOrder(id, { expectedDate: 'soon' }))).toMatch(/valid expected delivery date/)
    // editing something else leaves the date alone, and the order's lines and deliveries are untouched
    const kept = run(run(t, s.c, A.editPurchaseOrder(id, { expectedDate: '2026-10-05' })), s.c, A.editPurchaseOrder(id, { name: 'Renamed' }))
    expect(kept.orders![0].expectedDate).toBe('2026-10-05')
    expect(kept.orderLines).toEqual(t.orderLines)
  })

  it('orders placed without an expected date are unaffected (the field stays optional)', () => {
    const t = order(s.t0, [{ key: r1.key, qty: 5 }])
    expect(t.orders![0].expectedDate).toBeNull()
    expect(summary(t).overdue).toBe(0)
  })
})

vi.mock('../tracker/store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useTracker: () => ({ state: lateState, today: TODAY }) }))
vi.mock('../store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useConstruction: () => ({ state: s.c, idx: getIndex(s.c), today: TODAY }) }))
vi.mock('@/lib/access', () => ({ useAccess: () => ({ can: () => true, role: 'admin', ready: true }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => () => {} }))
vi.mock('../tracker/manage/AccessBar', () => ({ AccessBar: () => null }))
const lateState = order(order(s.t0, [{ key: r1.key, qty: 10 }], '2026-10-01', 'LATE'), [{ key: r2.key, qty: 2 }])
const { ProcurementPage } = await import('../procurement/ProcurementPage')
const { ProcurementGauges } = await import('../procurement/ProcurementGauges')

describe('gauges follow the selected Area', () => {
  const eh = s.rows.filter((r) => r.areaId === s.eh), pr = s.rows.filter((r) => r.areaId === s.pr)
  // one late order spanning both areas, partly delivered in E-House only
  const mixed = (() => {
    let t = order(s.t0, [{ key: eh[0].key, qty: 6 }, { key: pr[0].key, qty: 5 }], '2026-10-01', 'MIX')
    t = run(t, s.c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: eh[0].key, qty: 2 }] }, TODAY))
    return t
  })()
  const at = (area = '') => procurementSummary(procurementRows(mixed, s.c), mixed, mixed.orders!, TODAY, area)

  it('all areas gives the project totals; each area counts only its own requirements, orders and deliveries; the areas add up', () => {
    const all = at(), a = at(s.eh), b = at(s.pr)
    expect(a.required + b.required).toBe(all.required)
    for (const k of ['pending', 'ordered', 'delivered', 'overdue'] as const) expect(a[k] + b[k]).toBe(all[k])
    expect(a).toMatchObject({ ordered: 6, delivered: 2, overdue: 4 }) // 6 ordered (2 of them received), 4 still due in E-House
    expect(b).toMatchObject({ ordered: 5, delivered: 0, overdue: 5 })
    expect(all.overdue).toBe(9)
    expect(a.percent.delivered).toBe(Math.round((2 / a.required) * 100))
  })

  it('the Orders list and its Ordered / Overdue filters look only at the chosen area', () => {
    const o = mixed.orders![0]
    expect(hasLineIn(mixed, o.id, s.eh) && hasLineIn(mixed, o.id, s.pr)).toBe(true)
    // an order that is complete in E-House but still owed in Pipe Rack is overdue only there
    let t = run(mixed, s.c, A.recordDelivery({ orderId: o.id, date: TODAY, lines: [{ key: eh[0].key, qty: 4 }] }, TODAY))
    expect(isOverdue(t, t.orders![0], TODAY, s.eh)).toBe(false)
    expect(isOverdue(t, t.orders![0], TODAY, s.pr)).toBe(true)
    expect(dueOf(t, o.id, s.eh)).toBe(0)
    expect(dueOf(t, o.id)).toBe(5)
    // an order with no line in an area is not listed for it
    t = order(s.t0, [{ key: eh[1].key, qty: 1 }])
    expect(hasLineIn(t, t.orders![0].id, s.pr)).toBe(false)
  })

  it('the page shows the selected area\'s figures, and the Area selector sits above the gauges so it drives both tabs', () => {
    const html = (q: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[`/projects/${s.c.projects[0].id}/manage/materials${q}`]}><Routes><Route path="/projects/:projectId/manage/materials" element={<ProcurementPage />} /></Routes></MemoryRouter>)
    const figures = (h: string) => [...h.matchAll(/aria-label="(Pending|Ordered|Delivered|Overdue): \d+%, ([\d,]+) of ([\d,]+)\./g)].map((m) => `${m[1]}:${m[2]}/${m[3]}`)
    const whole = figures(html('')), scoped = figures(html(`?area=${s.eh}`)), other = figures(html(`?area=${s.pr}`))
    expect(whole).toHaveLength(4)
    expect(scoped).not.toEqual(whole)
    expect(scoped).not.toEqual(other)
    const h = html(`?area=${s.eh}&tab=orders`)
    expect(h.indexOf('aria-label="Area"')).toBeGreaterThan(0)
    expect(h.indexOf('aria-label="Area"')).toBeLessThan(h.indexOf('aria-label="Procurement progress"'))
  })
})

describe('the gauges on the page', () => {
  const page = (q = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/projects/${s.c.projects[0].id}/manage/materials${q}`]}><Routes><Route path="/projects/:projectId/manage/materials" element={<ProcurementPage />} /></Routes></MemoryRouter>)

  it('four circular gauges (Pending, Ordered, Delivered, Overdue) sit above the Materials and Orders tabs, on both tabs', () => {
    for (const q of ['', '?tab=orders']) {
      const html = page(q)
      const g = html.indexOf('aria-label="Procurement progress"'), tabs = html.indexOf('role="tablist"')
      expect(g, q).toBeGreaterThan(0)
      expect(g).toBeLessThan(tabs)
      const labels = [...html.matchAll(/aria-label="(Pending|Ordered|Delivered|Overdue): (\d+)%, ([\d,]+) of ([\d,]+)\./g)].map((m) => m[1])
      expect(labels).toEqual(['Pending', 'Ordered', 'Delivered', 'Overdue'])
      expect(html.match(/role="img"/g)?.length ?? 0).toBeGreaterThanOrEqual(4) // the same ring component as the Area Overview
    }
  })

  it('shows percentages and quantities, and each gauge is a button naming what it filters', () => {
    const m = procurementSummary(procurementRows(lateState, s.c), lateState, lateState.orders!, TODAY)
    const html = renderToStaticMarkup(<ProcurementGauges summary={m} onPick={() => {}} />)
    expect((html.match(/<button/g) ?? []).length).toBe(4)
    expect(html).toContain(`${m.overdue.toLocaleString('en-CA')} of ${m.required.toLocaleString('en-CA')}`)
    expect(html).toContain('Undelivered, past expected date')
    expect(html).toContain('Ordered (delivered or not)')
    expect(html).toContain('1 order')
    expect(html).toMatch(/Filters Materials to those still to order/)
    expect(html).toMatch(/Shows orders past their expected delivery date/)
    expect(m.overdue).toBe(10)
  })

  it('the Ordered gauge lists the orders placed (delivered or not), per area, and leaves out cancelled ones with nothing received', () => {
    const src = readFileSync('src/domains/construction/procurement/ProcurementPage.tsx', 'utf8')
    expect(src).toContain('orderedIn(state, o.id, areaFilter) > 0')
    let t = order(s.t0, [{ key: r1.key, qty: 3 }, { key: s.rows.find((r) => r.areaId === s.pr)!.key, qty: 2 }], null, 'A')
    t = run(t, s.c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: r1.key, qty: 3 }] }, TODAY))
    expect(orderedIn(t, t.orders![0].id)).toBe(5) // fully delivered in E-House, yet still counted as ordered
    expect(orderedIn(t, t.orders![0].id, s.eh)).toBe(3)
    expect(orderedIn(t, t.orders![0].id, s.pr)).toBe(2)
    const placed = order(s.t0, [{ key: r2.key, qty: 2 }])
    const gone = run(placed, s.c, A.cancelPurchaseOrder(placed.orders![0].id))
    expect(orderedIn(gone, gone.orders![0].id)).toBe(0) // cancelled with nothing received: not listed
  })

  it('the Delivered gauge filters Materials by any received quantity, partial deliveries included', () => {
    const src = readFileSync('src/domains/construction/procurement/ProcurementPage.tsx', 'utf8')
    expect(src).toContain("status === 'any-received' ? r.received > 0 : r.status === status")
    expect(src).toContain("setStatus(k === 'pending' ? 'pending' : 'any-received')")
    expect(src).toContain('Any quantity received')
    // the rule itself, on real rows: a partly delivered requirement counts, a fully delivered one counts, an undelivered one does not
    let t = order(s.t0, [{ key: r1.key, qty: r1.required }, { key: r2.key, qty: r2.required }])
    const id = t.orders![0].id
    t = run(t, s.c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: r1.key, qty: 1 }, { key: r2.key, qty: r2.required }] }, TODAY))
    const got = procurementRows(t, s.c).filter((r) => r.received > 0).map((r) => ({ key: r.key, status: r.status }))
    expect(got).toEqual(expect.arrayContaining([{ key: r1.key, status: 'partial' }, { key: r2.key, status: 'received' }]))
    expect(got).toHaveLength(2)
  })

  it('the old status counters are gone; the tabs, New order and Receive delivery are unchanged', () => {
    const html = page()
    expect(html).not.toContain('Required, not yet ordered</p>') // the old stat captions
    expect(html).toContain('>New order<')
    expect(html).toContain('>Receive delivery<')
    expect(html).toMatch(/role="tab"[^>]*>Materials/)
    expect(html).toMatch(/role="tab"[^>]*>Orders/)
  })
})

describe('Ordered gauge never shows 100% while anything is still to order (regression)', () => {
  const row = (required: number, ordered: number) => ({ required, ordered, orderedOnLines: 0, received: 0, receivedOnLines: 0, deliveryLines: [], orphan: false, areaId: 'a1', area: 'Area 1', key: `k${required}-${ordered}` }) as never
  const gauge = (rows: unknown[], area = '') => procurementSummary(rows as never, { orders: [], orderLines: [] } as never, [], TODAY, area)

  it('5,577 of 5,598 ordered is 99.6%, with the unrounded counts untouched', () => {
    const m = gauge([row(5000, 5000), row(598, 577)])
    expect(m).toMatchObject({ required: 5598, ordered: 5577, pending: 21 })
    expect(m.percent.ordered).toBe(99.6)
    expect(m.percent.pending).toBe(0.4)
    expect(m.pending + m.ordered).toBe(m.required)
  })

  it('shows 99.6 in the ring, its label and the footer, and never 100', () => {
    const m = gauge([row(5000, 5000), row(598, 577)])
    const html = renderToStaticMarkup(<ProcurementGauges summary={m} onPick={() => undefined} />)
    expect(html).toContain('Ordered: 99.6%, 5,577 of 5,598')
    expect(html).toContain('5,577 of 5,598')
    expect(html).not.toContain('Ordered: 100%')
  })

  it('100% only when ordered equals required, and a single missing piece keeps it below 100', () => {
    expect(gauge([row(10, 10)]).percent.ordered).toBe(100)
    expect(gauge([row(1000, 999)]).percent.ordered).toBe(99.9)
    expect(gauge([row(20000, 19999)]).percent.ordered).toBe(99.99)
  })

  it('partial orders, over-ordering and zero requirements', () => {
    expect(gauge([row(100, 40)]).percent.ordered).toBe(40)
    // Over-ordering one requirement cannot hide a shortfall on another: each is capped at its own requirement.
    const m = gauge([row(10, 25), row(10, 9)])
    expect(m).toMatchObject({ required: 20, ordered: 19, pending: 1 })
    expect(m.percent.ordered).toBe(95)
    // Nothing required: no percentage at all (the gauge says so), never 0% or 100%.
    expect(gauge([]).percent).toEqual({ pending: null, ordered: null, delivered: null, overdue: null })
    expect(gauge([row(0, 3)]).required).toBe(0)
  })

  it('individual areas use the same rule', () => {
    const a = { ...(row(500, 499) as object), areaId: 'a1', area: 'A' }
    const b = { ...(row(500, 500) as object), areaId: 'a2', area: 'B', key: 'k2' }
    expect(gauge([a, b], 'a1').percent.ordered).toBe(99.8)
    expect(gauge([a, b], 'a2').percent.ordered).toBe(100)
    expect(gauge([a, b]).percent.ordered).toBe(99.9) // All areas: 999 of 1,000
  })
})

describe('other completion indicators use the same rule (regression)', () => {
  it('a ring shows 99.6 with an arc that is not full, and 100 only for a complete one', () => {
    const near = renderToStaticMarkup(<Donut value={99.6} label="Ordered" />)
    expect(near).toContain('99.6')
    expect(near).toContain('data-fraction="0.996"')
    expect(renderToStaticMarkup(<Donut value={100} label="Ordered" />)).toContain('data-fraction="1"')
    expect(renderToStaticMarkup(<GaugeFigure count={5577} of={5598} label="Ordered" />)).toContain('data-fraction="0.996"')
  })

  it('tallies, package indicators and the register bars never read 100% while something is open', () => {
    expect(percent({ total: 1000, done: 999, blocked: 0, pending: 0 })).toBe(99.9)
    expect(percent({ total: 0, done: 0, blocked: 0, pending: 0 })).toBe(0)
    expect(percent({ total: 4, done: 4, blocked: 0, pending: 0 })).toBe(100)
    expect(pct(2399, 2400)).toBe(99.95) // 99.958%: one decimal would round up to 100.0, so two are shown
  })
})
