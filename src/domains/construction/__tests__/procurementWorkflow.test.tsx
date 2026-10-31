import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as A from '../tracker/actions'
import { materialsModel } from '../tracker/model'
import { areaMaterialsSummary, orderProgress, procurementRows, receivableOrders, unlinkedDeliveries } from '../tracker/procurement'
import { getIndex, foundationMaterial } from '../selectors'
import { materialsIndicator } from '../packageProgress'
import type { TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'
import { fails, liveRows, run, tracked, TODAY, world } from './materialsFixtures'

/** The workflow: Requirement → Purchase order → Receive against the order → status updates by itself. */
const setup = () => {
  const w = world()
  const t0 = tracked(w.c)
  const rows = liveRows(t0, w.c)
  const [r1, r2, r3] = rows
  const order = (t: TrackerState, name: string, lines: { key: string; qty: number }[], number = '') =>
    run(t, w.c, A.createPurchaseOrder({ name, number, supplier: 'Acme', date: TODAY, lines }, TODAY))
  const lastOrderId = (t: TrackerState) => (t.orders ?? []).at(-1)!.id
  return { ...w, t0, rows, r1, r2, r3, order, lastOrderId }
}
const recv = (id: string, lines: { key: string; qty: number }[], extra: { reference?: string; date?: string } = {}) => A.recordDelivery({ orderId: id, date: extra.date ?? TODAY, reference: extra.reference, lines }, TODAY)
const row = (t: TrackerState, c: ConstructionState, key: string) => procurementRows(t, c).find((r) => r.key === key)!

/* ── The page: tabs, selection, actions ─────────────────────────────────── */

const base = setup()
const withOrders = base.order(base.order(base.t0, 'Bolts order', [{ key: base.r1.key, qty: base.r1.required }], 'PO-1'), 'More', [{ key: base.r2.key, qty: base.r2.required }])
vi.mock('../tracker/store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useTracker: () => ({ state: withOrders, today: TODAY }) }))
vi.mock('../store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useConstruction: () => ({ state: base.c, idx: getIndex(base.c), today: TODAY }) }))
vi.mock('@/lib/access', () => ({ useAccess: () => ({ can: () => true, role: 'admin', ready: true }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => () => {} }))
vi.mock('../tracker/manage/AccessBar', () => ({ AccessBar: () => null }))

const { ProcurementPage, PROCUREMENT_TABS, ProcurementActions } = await import('../procurement/ProcurementPage')
const { RequirementsView } = await import('../procurement/RequirementsView')
const { ReceiveForm } = await import('../procurement/Dialogs')

const page = (query = '') => renderToStaticMarkup(
  <MemoryRouter initialEntries={[`/projects/${base.c.projects[0].id}/manage/materials${query}`]}>
    <Routes><Route path="/projects/:projectId/manage/materials" element={<ProcurementPage />} /></Routes>
  </MemoryRouter>,
)

describe('Procurement tabs and the removal of manual status changes', () => {
  it('the tabs are Materials and Orders (Requirements is renamed)', () => {
    expect(PROCUREMENT_TABS.map((t) => t.label)).toEqual(['Materials', 'Orders'])
    const out = page()
    expect(out).toMatch(/role="tab"[^>]*>Materials/)
    expect(out).toMatch(/role="tab"[^>]*>Orders/)
    expect(out).not.toContain('>Requirements<')
  })

  it('has no selection checkboxes and no Mark ordered/received, Order selected or Receive selected actions, in either layout', () => {
    const out = page()
    expect(out).not.toContain('type="checkbox"')
    for (const gone of ['Order selected', 'Receive selected', 'Mark ordered', 'Mark received', 'Mark delivered', ' selected<']) expect(out, gone).not.toContain(gone)
    const view = (layout: 'list' | 'blocks') => renderToStaticMarkup(<RequirementsView rows={base.rows} layout={layout} onOpen={() => {}} showArea expandAll />)
    for (const layout of ['list', 'blocks'] as const) {
      const html = view(layout)
      expect(html, layout).not.toContain('type="checkbox"')
      expect(html, layout).not.toContain('Select ')
      expect(html, layout).toContain(base.rows[0].name) // the materials are still listed, with their details
    }
  })

  it('New order and Receive delivery are on both tabs, in the same toolbar, opening the same panels', () => {
    for (const q of ['', '?tab=orders']) {
      const out = page(q)
      expect(out, q).toContain('data-testid="procurement-actions"')
      expect(out, q).toContain('>New order<')
      expect(out, q).toContain('>Receive delivery<')
      expect((out.match(/>New order</g) ?? []).length, q).toBe(1)
    }
    // one component serves both tabs, and its buttons call the one order handler and the one receive handler
    const calls: string[] = []
    const el = ProcurementActions({ canOrder: true, canReceive: true, onNewOrder: () => calls.push('order'), onReceive: () => calls.push('receive') }) as ReactElement
    const buttons: ReactElement<{ onClick: () => void; children: ReactNode }>[] = []
    const walk = (n: ReactNode) => { if (isValidElement(n)) { const e = n as ReactElement<{ onClick?: () => void; children?: ReactNode }>; if (e.props.onClick) buttons.push(e as ReactElement<{ onClick: () => void; children: ReactNode }>); [e.props.children].flat().forEach(walk) } }
    walk(el)
    buttons.forEach((b) => b.props.onClick())
    expect(calls).toEqual(['order', 'receive'])
  })

  it('role permissions still decide which actions appear', () => {
    const none = renderToStaticMarkup(<>{ProcurementActions({ canOrder: false, canReceive: false, onNewOrder: () => {}, onReceive: () => {} })}</>)
    expect(none).not.toContain('New order')
    expect(none).not.toContain('Receive delivery')
  })
})

/* ── The delivery panel ─────────────────────────────────────────────────── */

describe('Receive delivery panel', () => {
  const panel = (state: TrackerState, props: { orderId?: string; focusKeys?: string[] } = {}) =>
    renderToStaticMarkup(<ReceiveForm state={state} today={TODAY} onClose={() => {}} {...props} />)

  it('first asks for a purchase order, offering only orders with something outstanding (not cancelled, deleted or fully received)', () => {
    const s = setup()
    let t = s.order(s.t0, 'Open order', [{ key: s.r1.key, qty: 10 }], 'PO-OPEN')
    const open = s.lastOrderId(t)
    t = s.order(t, 'Complete order', [{ key: s.r2.key, qty: 4 }], 'PO-DONE')
    const done = s.lastOrderId(t)
    t = run(t, s.c, recv(done, [{ key: s.r2.key, qty: 4 }]))
    t = s.order(t, 'Cancelled order', [{ key: s.r3.key, qty: 5 }], 'PO-CANCEL')
    const cancelled = s.lastOrderId(t)
    t = run(t, s.c, A.cancelPurchaseOrder(cancelled))
    t = s.order(t, 'Deleted order', [{ key: s.rows[3].key, qty: 5 }], 'PO-DELETED')
    t = run(t, s.c, A.deletePurchaseOrder(s.lastOrderId(t)))
    expect(receivableOrders(t).map((x) => x.order.id)).toEqual([open])
    const out = panel(t)
    expect(out).toContain('aria-label="Purchase order"')
    expect(out).toContain('PO-OPEN')
    for (const hidden of ['PO-DONE', 'PO-CANCEL', 'PO-DELETED']) expect(out).not.toContain(hidden)
    expect(out).toContain('Acme') // the supplier, beside the order name and PO number
    // with a single eligible order it is chosen, and its items appear
    expect(out).toContain('Items on this order')
  })

  it('shows each item with ordered, received, remaining and the quantity being received, and only that order\'s items', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 10 }, { key: s.r2.key, qty: 6 }], 'PO-A')
    const a = s.lastOrderId(t)
    t = s.order(t, 'B', [{ key: s.r3.key, qty: 3 }], 'PO-B')
    t = run(t, s.c, recv(a, [{ key: s.r1.key, qty: 4 }]))
    const out = panel(t, { orderId: a })
    for (const head of ['Ordered', 'Received', 'Remaining', 'Receiving now']) expect(out).toContain(head)
    expect(out).toContain(s.r1.name)
    expect(out).toContain(s.r2.name)
    expect(out).not.toContain(s.r3.name) // B's material cannot be received against A
    expect(out).toContain('Receive all outstanding')
    expect(out).toContain('Quantity received')
    expect(out).toContain('value="6"') // the remaining 6 of the 10 ordered, not the 10
    expect(out).not.toContain('aria-label="Purchase order"') // opened from an order: that order is fixed
  })

  it('opened on a fully received or cancelled order, it offers nothing to receive; with no open orders it points to New order', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 5 }])
    const a = s.lastOrderId(t)
    t = run(t, s.c, recv(a, [{ key: s.r1.key, qty: 5 }]))
    expect(panel(t, { orderId: a })).toContain('nothing left to receive')
    expect(panel(t)).toContain('no purchase order with materials still to receive')
    expect(panel(s.t0)).toContain('create one first')
  })

  it('opened from a material, offers only the orders still owing that material', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 5 }], 'PO-A')
    t = s.order(t, 'B', [{ key: s.r2.key, qty: 5 }], 'PO-B')
    expect(receivableOrders(t, [s.r2.key]).map((x) => x.order.number)).toEqual(['PO-B'])
    const out = panel(t, { focusKeys: [s.r2.key] })
    expect(out).toContain(s.r2.name)
    expect(out).not.toContain('PO-A')
  })
})

/* ── The enforced rules (backend reducers, the same ones the server runs) ─── */

describe('deliveries need an existing eligible purchase order', () => {
  it('a delivery with no order is refused, and so is an unknown order', () => {
    const s = setup()
    expect(fails(s.t0, s.c, A.recordDelivery({ date: TODAY, lines: [{ key: s.r1.key, qty: 1 }] }, TODAY))).toMatch(/purchase order/i)
    expect(fails(s.t0, s.c, A.recordDelivery({ orderId: null, date: TODAY, lines: [{ key: s.r1.key, qty: 1 }] }, TODAY))).toMatch(/purchase order/i)
    expect(fails(s.t0, s.c, recv('po-nope', [{ key: s.r1.key, qty: 1 }]))).toMatch(/not available/)
    expect(row(s.t0, s.c, s.r1.key)).toMatchObject({ received: 0, ordered: 0, status: 'pending' }) // nothing changed
  })

  it('only materials on the selected order can be received', () => {
    const s = setup()
    const t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 5 }])
    expect(fails(t, s.c, recv(s.lastOrderId(t), [{ key: s.r2.key, qty: 1 }]))).toMatch(/not on the purchase order/)
    expect(fails(t, s.c, recv(s.lastOrderId(t), [{ key: s.r1.key, qty: 1 }, { key: s.r2.key, qty: 1 }]))).toMatch(/not on the purchase order/)
  })

  it('ordering is what makes a material Ordered; receiving against the order is what makes it Delivered, automatically', () => {
    const s = setup()
    expect(row(s.t0, s.c, s.r1.key).status).toBe('pending')
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: s.r1.required }])
    expect(row(t, s.c, s.r1.key)).toMatchObject({ ordered: s.r1.required, received: 0, status: 'ordered' })
    t = run(t, s.c, recv(s.lastOrderId(t), [{ key: s.r1.key, qty: s.r1.required }]))
    expect(row(t, s.c, s.r1.key)).toMatchObject({ received: s.r1.required, outstanding: 0, status: 'received' })
    expect(materialsModel(t, s.c).rowOfLine(row(t, s.c, s.r1.key).lines[0].id)?.stage).toBe('delivered')
  })

  it('partial deliveries and several deliveries against one order work, and never exceed what was ordered', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 10 }, { key: s.r2.key, qty: 8 }])
    const id = s.lastOrderId(t)
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 4 }], { reference: 'DN-1' }))
    expect(row(t, s.c, s.r1.key)).toMatchObject({ received: 4, status: 'partial' })
    expect(row(t, s.c, s.r2.key)).toMatchObject({ received: 0, status: 'ordered' }) // not every item has to arrive together
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 3 }, { key: s.r2.key, qty: 8 }], { reference: 'DN-2' }))
    expect(orderProgress(t, id)).toMatchObject({ received: 15, due: 3 })
    expect(row(t, s.c, s.r1.key).received).toBe(7)
    expect(row(t, s.c, s.r2.key).received).toBe(8)
    expect(fails(t, s.c, recv(id, [{ key: s.r1.key, qty: 4 }], { reference: 'DN-3' }))).toMatch(/only 3 is still outstanding/)
    expect(fails(t, s.c, recv(id, [{ key: s.r1.key, qty: 0 }]))).toMatch(/whole number/)
    expect(fails(t, s.c, recv(id, [{ key: s.r1.key, qty: 1.5 }]))).toMatch(/whole number/)
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 3 }], { reference: 'DN-3' }))
    expect(orderProgress(t, id)).toMatchObject({ received: 18, due: 0 })
    expect((t.deliveries ?? []).filter((d) => d.orderId === id)).toHaveLength(3)
  })

  it('a fully received order cannot receive more, and an identical repeat of a recorded delivery is refused', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 10 }])
    const id = s.lastOrderId(t)
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 4 }], { reference: 'DN-7' }))
    expect(fails(t, s.c, recv(id, [{ key: s.r1.key, qty: 4 }], { reference: 'DN-7' }))).toMatch(/already recorded/)
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 6 }], { reference: 'DN-8' }))
    expect(fails(t, s.c, recv(id, [{ key: s.r1.key, qty: 1 }]))).toMatch(/received in full/)
    expect(receivableOrders(t)).toHaveLength(0)
  })

  it('a cancelled order cannot receive new deliveries', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 10 }])
    const id = s.lastOrderId(t)
    t = run(t, s.c, A.cancelPurchaseOrder(id))
    expect(fails(t, s.c, recv(id, [{ key: s.r1.key, qty: 1 }]))).toMatch(/cancelled/)
    expect(receivableOrders(t)).toHaveLength(0)
  })
})

/* ── Existing management and history are intact ────────────────────────── */

describe('corrections, voids, cancellation and historical records still work', () => {
  it('a delivery can be corrected and voided, and the order owes what is left', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 10 }])
    const id = s.lastOrderId(t)
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 6 }], { reference: 'DN-1' }))
    const dl = (t.deliveries ?? [])[0].id
    t = run(t, s.c, A.correctDelivery(dl, { reference: 'DN-1A' }, TODAY))
    expect((t.deliveries ?? [])[0].reference).toBe('DN-1A')
    t = run(t, s.c, A.voidDelivery(dl))
    expect(orderProgress(t, id)).toMatchObject({ received: 0, due: 10 })
    expect(receivableOrders(t).map((x) => x.order.id)).toEqual([id]) // eligible again
    expect((t.history ?? []).some((h) => /voided/.test(h.summary))).toBe(true) // audit kept
  })

  it('cancelling an order with deliveries keeps what arrived and counts it', () => {
    const s = setup()
    let t = s.order(s.t0, 'A', [{ key: s.r1.key, qty: 10 }])
    const id = s.lastOrderId(t)
    t = run(t, s.c, recv(id, [{ key: s.r1.key, qty: 6 }]))
    t = run(t, s.c, A.cancelPurchaseOrder(id))
    expect(row(t, s.c, s.r1.key)).toMatchObject({ ordered: 6, received: 6 })
  })

  it('retired entry points refuse: per-line receipts and per-line ordered quantities', () => {
    const s = setup()
    const line = s.rows[0].lines[0]
    expect(fails(s.t0, s.c, A.addReceipt(line.id, { date: TODAY, qty: 1, reference: '', note: '' }, TODAY))).toMatch(/purchase order/i)
    expect(fails(s.t0, s.c, A.setOrdered(line.id, 5))).toMatch(/purchase orders/i)
  })

  it('deliveries recorded without an order before this rule stay, keep counting, and can still be voided or attached by correction', () => {
    const s = setup()
    let t = run(s.t0, s.c, A.historicalUnlinkedDelivery({ date: TODAY, lines: [{ key: s.r1.key, qty: 7 }] }, TODAY))
    expect(unlinkedDeliveries(t).count).toBe(1)
    expect(row(t, s.c, s.r1.key)).toMatchObject({ received: 7, ordered: 0 }) // counted as delivered under the existing rule
    // new work does not disturb it: an order for the same material, and a delivery against that order
    t = s.order(t, 'A', [{ key: s.r1.key, qty: 10 }])
    t = run(t, s.c, recv(s.lastOrderId(t), [{ key: s.r1.key, qty: 10 }]))
    expect(row(t, s.c, s.r1.key)).toMatchObject({ received: 17, ordered: 10 })
    expect(unlinkedDeliveries(t).count).toBe(1)
    const loose = (t.deliveries ?? []).find((d) => !d.orderId)!
    t = run(t, s.c, A.voidDelivery(loose.id))
    expect(row(t, s.c, s.r1.key).received).toBe(10)
    // legacy per-line receipts keep counting too
    const t2 = run(s.t0, s.c, A.legacyAddReceipt(s.rows[0].lines[0].id, { date: TODAY, qty: 3, reference: '', note: '' }, TODAY))
    expect(row(t2, s.c, s.r1.key).received).toBe(3)
  })
})

/* ── One set of numbers everywhere ─────────────────────────────────────── */

describe('Materials, Project Status and Foundation Overview agree after the new workflow', () => {
  it('order, partial delivery, second delivery, void: every view shows the same quantities', () => {
    const s = setup()
    const key = s.rows.find((r) => r.category === 'bolt')!.key
    const check = (t: TrackerState) => {
      const idx = getIndex(s.c, t)
      const pr = row(t, s.c, key)
      const model = materialsModel(t, s.c).rows.find((r) => r.key === key)!
      expect([model.ordered, model.received, model.outstanding]).toEqual([pr.ordered, pr.received, pr.outstanding])
      const rows = areaMaterialsSummary(t, s.c, pr.areaId!).rows.find((r) => r.key === key)!
      expect([rows.ordered, rows.received]).toEqual([pr.ordered, pr.received])
      const fm = foundationMaterial(idx, pr.contributions.find((x) => x.foundationId)!.foundationId!, 'bolt')!
      const fr = fm.rows.find((x) => x.row.key === key)!.row
      expect([fr.ordered, fr.received]).toEqual([pr.ordered, pr.received])
      expect(materialsIndicator(idx, pr.areaId!, t).percent).toBe(areaMaterialsSummary(t, s.c, pr.areaId!).percent)
      return pr
    }
    let t = s.order(s.t0, 'Bolts', [{ key, qty: row(s.t0, s.c, key).required }])
    expect(check(t)).toMatchObject({ received: 0, status: 'ordered' })
    const id = s.lastOrderId(t)
    t = run(t, s.c, recv(id, [{ key, qty: 5 }], { reference: 'A' }))
    expect(check(t)).toMatchObject({ received: 5, status: 'partial' })
    t = run(t, s.c, recv(id, [{ key, qty: row(s.t0, s.c, key).required - 5 }], { reference: 'B' }))
    expect(check(t)).toMatchObject({ status: 'received' })
    t = run(t, s.c, A.voidDelivery((t.deliveries ?? []).find((d) => d.reference === 'B')!.id))
    expect(check(t)).toMatchObject({ received: 5, status: 'partial' })
  })
})
