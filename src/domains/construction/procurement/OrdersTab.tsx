import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { cancelPurchaseOrder, deletePurchaseOrder, voidDelivery } from '../tracker/commands'
import { specText } from '../tracker/consolidate'
import { orderProgress, orderTitle } from '../tracker/procurement'
import { trackerStore } from '../tracker/store'
import type { Delivery, PurchaseOrder, TrackerState } from '../tracker/types'
import { fmt, when, who } from './Dialogs'

export type OrderStatus = 'Open' | 'Partially received' | 'Complete' | 'Cancelled'
/** An order's status, from what has been ordered and received against it. A missing PO number or supplier never changes it. */
export function orderStatus(o: PurchaseOrder, p: { ordered: number; received: number; due: number }): OrderStatus {
  return o.cancelled ? 'Cancelled' : p.due === 0 && p.ordered > 0 ? 'Complete' : p.received > 0 ? 'Partially received' : 'Open'
}
const TONE = { Complete: 'ok', 'Partially received': 'warn', Cancelled: 'muted', Open: 'info' } as const

export interface OrdersTabProps {
  state: TrackerState
  orders: PurchaseOrder[]
  deliveries: Delivery[]
  perms: { order: boolean; receive: boolean; void: boolean }
  onReceive: (orderId?: string) => void
  onAddMaterials: (orderId: string) => void
  onEdit: (orderId: string) => void
  onCorrect: (deliveryId: string) => void
  act: (run: () => Promise<string | null>) => Promise<void>
}

/** One delivery's lines, with who confirmed it and when, and Void for those allowed to. */
function DeliveryList({ state, deliveries, perms, act, onCorrect }: { state: TrackerState; deliveries: Delivery[]; perms: OrdersTabProps['perms']; act: OrdersTabProps['act']; onCorrect: (id: string) => void }) {
  return (
    <ul className="divide-y divide-line border-y border-line text-[13px]" aria-label="Deliveries">
      {deliveries.map((d) => {
        const lines = (state.deliveryLines ?? []).filter((l) => l.deliveryId === d.id)
        return (
          <li key={d.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{formatDate(d.date)}</span>{d.reference && <span className="text-muted"> · {d.reference}</span>}<span className="text-muted"> · {fmt(lines.reduce((a, l) => a + l.qty, 0))} items · {who(d.by)}{d.at ? `, ${when(d.at)}` : ''}</span></span>
              {perms.void && <span className="flex gap-1"><Button variant="ghost" className="!h-8" onClick={() => onCorrect(d.id)}>Correct</Button><Button variant="ghost" className="!h-8" onClick={() => { if (window.confirm('Void this delivery? It is removed from the received totals and stays in the history.')) void act(() => trackerStore.run(voidDelivery(d.id))) }}>Void</Button></span>}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">{lines.map((l) => <li key={l.id} className="flex justify-between gap-3"><span>{l.area} · {l.designation ? `${l.designation} ` : ''}{l.name}{specText(l) ? ` · ${specText(l)}` : ''}</span><span className="tabular-nums">{fmt(l.qty)} {l.unit}</span></li>)}</ul>
            {d.note && <p className="mt-1 text-xs text-muted">{d.note}</p>}
          </li>
        )
      })}
    </ul>
  )
}

/** Orders: each purchase order with its materials, deliveries and details in one place, plus any delivery that arrived with no order. */
export function OrdersTab({ state, orders, deliveries, perms, onReceive, onAddMaterials, onEdit, onCorrect, act }: OrdersTabProps) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const loose = deliveries.filter((d) => !d.orderId)
  if (orders.length === 0 && loose.length === 0) return <div className="pt-6"><EmptyState title="No orders yet" description="Select materials in Requirements and choose Order selected, or use New order." /></div>
  return (
    <div className="space-y-8 pt-6">
      {orders.length > 0 && (
        <table className="card-table w-full text-left text-[13px]">
          <thead><tr className="border-b border-line">
            <th scope="col" className="w-8"><span className="sr-only">Open</span></th><th scope="col" className="t-label font-medium">Order</th><th scope="col" className="t-label text-right font-medium">Items</th>
            <th scope="col" className="t-label text-right font-medium">Ordered</th><th scope="col" className="t-label text-right font-medium">Delivered</th><th scope="col" className="t-label font-medium">Status</th><th scope="col" className="t-label font-medium"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {orders.map((o) => {
              const p = orderProgress(state, o.id)
              const st = orderStatus(o, p)
              const title = orderTitle(state, o)
              const isOpen = open.has(o.id)
              return (
                <Fragment key={o.id}>
                  <tr className={`border-b border-line transition-colors hover:bg-hover ${o.cancelled ? 'opacity-60' : ''}`}>
                    <td><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Close' : 'Open'} ${title}`} onClick={() => toggle(o.id)} className="grid h-8 w-8 place-items-center text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                    <td data-wrap>
                      <button type="button" onClick={() => toggle(o.id)} className="block text-left"><span className="font-medium">{title}</span></button>
                      <span className="block text-xs text-muted">PO {o.number || 'Not Assigned'} · {o.supplier || 'Supplier Not Assigned'} · {formatDate(o.date)}</span>
                    </td>
                    <td className="text-right">{p.lines.length}</td><td className="text-right">{fmt(p.ordered)}</td><td className="text-right">{fmt(p.received)}</td>
                    <td><StatusBadge tone={TONE[st]} label={st} /></td>
                    <td className="whitespace-nowrap text-right">{!o.cancelled && p.due > 0 && perms.receive && <Button className="!h-8" onClick={() => onReceive(o.id)}>Receive</Button>}</td>
                  </tr>
                  {isOpen && (
                    <tr data-wide><td colSpan={7} data-wrap className="border-b border-line bg-hover px-3 py-4">
                      <div className="max-w-4xl space-y-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-4">
                            <div><dt className="t-label">PO number</dt><dd className="mt-0.5">{o.number || <span className="text-muted">Not Assigned</span>}</dd></div>
                            <div><dt className="t-label">Supplier</dt><dd className="mt-0.5">{o.supplier || <span className="text-muted">Not Assigned</span>}</dd></div>
                            <div><dt className="t-label">Ordered</dt><dd className="mt-0.5">{formatDate(o.date)}</dd></div>
                            <div><dt className="t-label">Expected</dt><dd className="mt-0.5">{o.expectedDate ? formatDate(o.expectedDate) : <span className="text-muted">—</span>}</dd></div>
                          </dl>
                          <div className="flex flex-wrap gap-2">
                            {perms.order && !o.cancelled && <Button className="!h-8" onClick={() => onEdit(o.id)}>Edit order</Button>}
                            {perms.order && !o.cancelled && <Button className="!h-8" onClick={() => onAddMaterials(o.id)}>Add materials</Button>}
                            {perms.receive && !o.cancelled && p.due > 0 && <Button variant="primary" className="!h-8" onClick={() => onReceive(o.id)}>Record delivery</Button>}
                            {perms.void && <Button variant="ghost" className="!h-8" onClick={() => { if (window.confirm(`Delete ${title}?\n\nPO ${o.number || 'Not Assigned'} · ${o.supplier || 'Supplier Not Assigned'} · ${formatDate(o.date)}\n${p.lines.length} material${p.lines.length === 1 ? '' : 's'}, ${fmt(p.ordered)} items.\n\nIts quantities are removed from what is ordered, so they show as still to order again. A record of the deleted order stays in the history.`)) void act(() => trackerStore.run(deletePurchaseOrder(o.id))) }}>Delete order</Button>}
                            {perms.void && !o.cancelled && <Button variant="ghost" className="!h-8" onClick={() => { if (window.confirm(p.received > 0 ? `Cancel ${title}?\n\n${fmt(p.received)} items already delivered stay recorded and counted in Materials. The ${fmt(p.original - p.received > 0 ? p.original - p.received : 0)} not yet delivered are removed from what is ordered and show as still to order.\nNo further deliveries can be recorded against it. Deliveries and history are kept.` : `Cancel ${title}?\n\nIts ${fmt(p.original)} items are removed from what is ordered and show as still to order. The order stays on record, marked Cancelled.`)) void act(() => trackerStore.run(cancelPurchaseOrder(o.id))) }}>Cancel order</Button>}
                          </div>
                        </div>
                        {o.cancelled && <p role="status" className="border-l-2 border-line pl-3 text-[13px]">Cancelled. {p.received > 0 ? `${fmt(p.received)} delivered stays recorded and counted; ` : ''}{fmt(p.cancelledQty)} of the {fmt(p.original)} ordered {p.cancelledQty === 1 ? 'was' : 'were'} not delivered and {p.cancelledQty === 1 ? 'is' : 'are'} no longer counted as ordered. No further deliveries can be recorded.</p>}
                        {o.notes && <p className="text-xs text-muted">{o.notes}</p>}
                        <div className="pr-3"><table className="w-full table-fixed text-left text-[13px] [&_td]:pr-2 [&_th]:pr-2" aria-label={`Materials of ${title}`}>
                          <colgroup><col className="w-24" /><col /><col className="w-[4.5rem]" /><col className="w-[5.5rem]" /><col className="w-16" /></colgroup>
                          <thead><tr className="border-b border-line"><th scope="col" className="t-label font-medium">Area</th><th scope="col" className="t-label font-medium">Material</th><th scope="col" className="t-label text-right font-medium">Ordered</th><th scope="col" className="t-label text-right font-medium">Delivered</th><th scope="col" className="t-label text-right font-medium">{o.cancelled ? 'Cancelled' : 'Due'}</th></tr></thead>
                          <tbody>{p.lines.map(({ line, received, due, cancelledQty }) => <tr key={line.id} className="border-b border-line"><td>{line.area}</td><td title={`${line.name} ${specText(line)}`}>{line.designation ? `${line.designation} ` : ''}{line.name}{specText(line) ? ` · ${specText(line)}` : ''}</td><td className="text-right">{fmt(line.qty)}</td><td className="text-right">{fmt(received)}</td><td className="text-right">{fmt(o.cancelled ? cancelledQty : due)}</td></tr>)}</tbody>
                        </table></div>
                        <section aria-label={`Deliveries of ${title}`}>
                          <h3 className="t-label mb-2">Deliveries</h3>
                          {p.deliveries.length === 0 ? <p className="text-muted">Nothing delivered yet.</p> : <DeliveryList state={state} deliveries={p.deliveries.slice().sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))} perms={perms} act={act} onCorrect={onCorrect} />}
                        </section>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {loose.length > 0 && (
        <section aria-label="Deliveries without an order">
          <h3 className="t-label mb-2">Received without an order</h3>
          <div className="max-w-4xl"><DeliveryList state={state} deliveries={loose} perms={perms} act={act} onCorrect={onCorrect} /></div>
        </section>
      )}
    </div>
  )
}
