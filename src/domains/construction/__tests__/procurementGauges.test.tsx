import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as A from '../tracker/actions'
import { procurementRows } from '../tracker/procurement'
import type { TrackerState } from '../tracker/types'
import { getIndex } from '../selectors'
import { isOverdue, procurementSummary } from '../procurement/summary'
import { liveRows, run, tracked, TODAY, world } from './materialsFixtures'

const s = (() => { const w = world(); const t0 = tracked(w.c); return { ...w, t0, rows: liveRows(t0, w.c) } })()
const [r1, r2] = s.rows
const order = (t: TrackerState, lines: { key: string; qty: number }[], expectedDate: string | null = null, number = '') =>
  run(t, s.c, A.createPurchaseOrder({ name: '', number, supplier: 'Acme', date: TODAY, expectedDate, lines }, TODAY))
const summary = (t: TrackerState) => procurementSummary(procurementRows(t, s.c), t, t.orders ?? [], TODAY)

describe('Procurement summary (the four gauges)', () => {
  it('starts with everything pending, as a share of what is required', () => {
    const m = summary(s.t0)
    const R = s.rows.reduce((a, r) => a + r.required, 0)
    expect(m).toMatchObject({ required: R, pending: R, awaiting: 0, delivered: 0, overdue: 0 })
    expect(m.percent).toEqual({ pending: 100, awaiting: 0, delivered: 0, overdue: 0 })
  })

  it('moves quantities from pending to ordered to delivered as orders and deliveries are recorded, and the three always add up', () => {
    let t = order(s.t0, [{ key: r1.key, qty: r1.required }])
    let m = summary(t)
    expect(m).toMatchObject({ pending: m.required - r1.required, awaiting: r1.required, delivered: 0 })
    const id = t.orders![0].id
    t = run(t, s.c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: r1.key, qty: 2 }] }, TODAY))
    m = summary(t)
    expect(m).toMatchObject({ awaiting: r1.required - 2, delivered: 2 })
    expect(m.pending + m.awaiting + m.delivered).toBe(m.required)
    expect(m.percent.delivered).toBe(Math.round((2 / m.required) * 100))
  })

  it('a cancelled order goes back to pending (keeping what arrived as delivered)', () => {
    let t = order(s.t0, [{ key: r1.key, qty: r1.required }])
    t = run(t, s.c, A.recordDelivery({ orderId: t.orders![0].id, date: TODAY, lines: [{ key: r1.key, qty: 1 }] }, TODAY))
    t = run(t, s.c, A.cancelPurchaseOrder(t.orders![0].id))
    const m = summary(t)
    expect(m).toMatchObject({ awaiting: 0, delivered: 1 })
    expect(m.pending + m.delivered).toBe(m.required)
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
    expect(html).toContain('1 order')
    expect(html).toMatch(/Filters Materials to those still to order/)
    expect(html).toMatch(/Shows orders past their expected delivery date/)
    expect(m.overdue).toBe(10)
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
