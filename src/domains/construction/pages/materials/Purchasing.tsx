import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CompactInput } from '@/components/ui/Field'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { cancelPurchaseOrder, issuePurchaseOrder, resolveDeliveryLine, setPOExpected } from '../../actions'
import { lineLabel, poFulfilment, poLineReceived, type Fulfilment } from '../../selectors'
import { useConstruction, useRun } from '../../store'
import { ReceiveModal } from './Modals'

const th = 't-label py-3 pr-4 font-medium'
const FULFIL: Record<Fulfilment, { tone: Tone; label: string }> = {
  'not-received': { tone: 'muted', label: 'Not received' },
  partial: { tone: 'warn', label: 'Partially received' },
  complete: { tone: 'ok', label: 'Fully received' },
  'over-received': { tone: 'warn', label: 'Over-received' },
}

export function PurchaseOrders({ areaId }: { areaId?: string }) {
  const { state, idx, today } = useConstruction()
  const orders = areaId
    ? state.purchaseOrders.filter((po) => po.lines.some((l) => (l.kind === 'bulk' ? idx.bulk.get(l.itemId)?.areaId === areaId : state.plinths.some((p) => idx.foundation.get(p.foundationId)!.areaId === areaId && idx.anchorage.get(p.anchorageTypeId ?? '')?.bolts.some((b) => b.specId === l.itemId)))))
    : state.purchaseOrders
  const run = useRun()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [receiving, setReceiving] = useState<string | null>(null)
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setReceiving('')}>Receive delivery</Button></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead><tr className="border-b border-line"><th className="w-6" />{['PO', 'Supplier', 'Status', 'Issued', 'Expected', 'Ordered', 'Received', 'Receipt'].map((h) => <th key={h} className={th}>{h}</th>)}<th /></tr></thead>
          <tbody>
            {orders.map((po) => {
              const f = poFulfilment(idx, po)
              const isOpen = open.has(po.id)
              const late = po.status === 'issued' && po.expectedDate && po.expectedDate < today && f.state !== 'complete'
              return (
                <Fragment key={po.id}>
                  <tr className="border-b border-line">
                    <td className="py-3.5"><button aria-expanded={isOpen} aria-label={`Toggle ${po.number}`} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(po.id)) n.delete(po.id); else n.add(po.id); return n })} className="text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                    <td className="py-3.5 pr-4 text-[13px] font-medium">{po.number}</td>
                    <td className="py-3.5 pr-4 text-[13px] text-muted">{idx.supplier.get(po.supplierId)?.name}</td>
                    <td className="py-3.5 pr-4"><StatusBadge tone={po.status === 'issued' ? 'info' : po.status === 'draft' ? 'muted' : 'neutral'} label={po.status[0].toUpperCase() + po.status.slice(1)} /></td>
                    <td className="py-3.5 pr-4 text-[13px] text-muted">{formatDate(po.issuedDate)}</td>
                    <td className="py-1.5 pr-4 text-[13px]"><CompactInput type="date" aria-label={`${po.number} expected date`} disabled={po.status === 'cancelled'} value={po.expectedDate ?? ''} onChange={(e) => run(setPOExpected(po.id, e.target.value || null))} className={late ? 'text-bad' : ''} /></td>
                    <td className="py-3.5 pr-4 text-[13px] tabular-nums">{f.ordered}</td>
                    <td className="py-3.5 pr-4 text-[13px] tabular-nums">{f.received}</td>
                    <td className="py-3.5 pr-4">{po.status === 'issued' ? <StatusBadge {...FULFIL[f.state]} /> : <span className="text-[13px] text-muted">—</span>}</td>
                    <td className="py-3.5 text-right"><div className="flex justify-end gap-1">
                      {po.status === 'draft' && <Button className="h-8 px-3" onClick={() => run(issuePurchaseOrder(po.id, today))}>Issue</Button>}
                      {po.status === 'issued' && <Button className="h-8 px-3" onClick={() => setReceiving(po.id)}>Receive</Button>}
                      {po.status !== 'cancelled' && <Button variant="ghost" className="h-8 px-3" onClick={() => window.confirm(`Cancel ${po.number}?`) && run(cancelPurchaseOrder(po.id))}>Cancel</Button>}
                    </div></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-canvas"><td /><td colSpan={9} className="py-3 pr-4">
                      {po.notes && <p className="mb-2 text-xs text-muted">{po.notes}</p>}
                      <table className="w-full text-left text-[13px]">
                        <thead><tr>{['Line', 'Ordered', 'Received', 'Outstanding'].map((h) => <th key={h} className="t-label py-1 pr-4 font-medium">{h}</th>)}</tr></thead>
                        <tbody>{po.lines.map((l) => { const got = poLineReceived(idx, l.id); return <tr key={l.id}><td className="py-1 pr-4">{lineLabel(idx, l)}</td><td className="pr-4">{l.qtyOrdered}</td><td className="pr-4">{got}</td><td>{Math.max(0, l.qtyOrdered - got)}</td></tr> })}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {receiving !== null && <ReceiveModal poId={receiving || undefined} onClose={() => setReceiving(null)} />}
    </>
  )
}

export function Deliveries() {
  const { state, idx } = useConstruction()
  const run = useRun()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const list = [...state.deliveries].sort((a, b) => b.receivedDate.localeCompare(a.receivedDate))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead><tr className="border-b border-line"><th className="w-6" />{['Delivery', 'PO', 'Supplier', 'Received', 'Reference', 'Lines', 'Discrepancies'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {list.map((d) => {
            const po = idx.po.get(d.poId)!
            const isOpen = open.has(d.id)
            const open_ = d.lines.filter((l) => l.qtyShipped !== l.qtyReceived && !l.resolved).length
            return (
              <Fragment key={d.id}>
                <tr className="border-b border-line">
                  <td className="py-3.5"><button aria-expanded={isOpen} aria-label={`Toggle ${d.number}`} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })} className="text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                  <td className="py-3.5 pr-4 text-[13px] font-medium">{d.number}</td>
                  <td className="py-3.5 pr-4 text-[13px]">{po.number}</td>
                  <td className="py-3.5 pr-4 text-[13px] text-muted">{idx.supplier.get(po.supplierId)?.name}</td>
                  <td className="py-3.5 pr-4 text-[13px] text-muted">{formatDate(d.receivedDate)}</td>
                  <td className="py-3.5 pr-4 text-[13px] text-muted">{d.reference}</td>
                  <td className="py-3.5 pr-4 text-[13px]">{d.lines.length}</td>
                  <td className="py-3.5 pr-4">{open_ ? <StatusBadge tone="warn" label={`${open_} open`} /> : <span className="text-[13px] text-muted">None</span>}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-canvas"><td /><td colSpan={7} className="py-3 pr-4">
                    <table className="w-full text-left text-[13px]">
                      <thead><tr>{['Line', 'Per slip', 'Counted', 'Variance', 'Note', ''].map((h) => <th key={h} className="t-label py-1 pr-4 font-medium">{h}</th>)}</tr></thead>
                      <tbody>{d.lines.map((l) => {
                        const v = l.qtyReceived - l.qtyShipped
                        const line = idx.poLine.get(l.poLineId)!.line
                        return (
                          <tr key={l.id}>
                            <td className="py-1 pr-4">{lineLabel(idx, line)}</td><td className="pr-4">{l.qtyShipped}</td><td className="pr-4">{l.qtyReceived}</td>
                            <td className={`pr-4 ${v !== 0 && !l.resolved ? 'text-warn' : ''}`}>{v === 0 ? '—' : v}</td><td className="pr-4 text-muted">{l.note}</td>
                            <td>{v !== 0 && <button className="text-xs text-muted hover:text-ink" onClick={() => run(resolveDeliveryLine(l.id, !l.resolved))}>{l.resolved ? 'Reopen' : 'Mark resolved'}</button>}</td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  </td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
