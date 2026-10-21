import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatShortDate } from '@/lib/format'
import { paths } from '../../paths'
import { BOLT_STAGE_LABEL, boltRows, bulkRows, plinthBoltStage, plinthHardware, areaOfPlinth, specLabel } from '../../selectors'
import { useConstruction } from '../../store'
import { AllocateModal, OrderModal } from './Modals'

type Dialog = { type: 'allocate' | 'order'; kind: 'bolt' | 'bulk'; itemId: string } | null

const th = 't-label py-3 pr-4 font-medium'
const num = 'py-3.5 pr-4 text-[13px] tabular-nums'

export function BoltTable({ projectId, areaId }: { projectId: string; areaId?: string }) {
  const { idx } = useConstruction()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const rows = boltRows(idx, areaId)
  const scope = areaId ? 'area' : 'project'
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="w-6" />
              <th className={th}>Specification</th>
              <th className={th} title={`Required within the ${scope}`}>Required</th>
              <th className={th} title="Issued purchase orders, project-wide">Ordered</th>
              <th className={th} title="Counted on site, project-wide">Received</th>
              <th className={th} title={`Allocated within the ${scope}`}>Allocated</th>
              <th className={th} title={`Allocated and marked ready within the ${scope}`}>Ready</th>
              <th className={th} title="Received and not yet allocated, project-wide">Available</th>
              <th className={th}>To order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open.has(r.spec.id)
              return (
                <Fragment key={r.spec.id}>
                  <tr className="border-b border-line">
                    <td className="py-3.5"><button aria-expanded={isOpen} aria-label={`Toggle ${r.spec.id} requirements`} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.spec.id)) n.delete(r.spec.id); else n.add(r.spec.id); return n })} className="text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                    <td className="py-3.5 pr-4 text-[13px]"><span className="font-medium">{specLabel(r.spec)}</span> <span className="text-muted">{r.spec.id}</span><span className="block text-xs text-muted">Top thread {r.spec.topThread}" · bottom thread {r.spec.bottomThread}" · {r.spec.grade}</span></td>
                    <td className={num}>{r.required}</td>
                    <td className={num}>{r.ordered}{r.draft > 0 && <span className="block text-xs text-muted">+{r.draft} draft</span>}</td>
                    <td className={num}>{r.received}</td>
                    <td className={num}>{r.allocated}</td>
                    <td className={num}>{r.readyQty}</td>
                    <td className={num}>{r.available}</td>
                    <td className={num}>{r.toOrder > 0 ? <StatusBadge tone="warn" label={String(r.toOrder)} /> : <span className="text-muted">0</span>}</td>
                    <td className="py-3.5 text-right"><div className="flex justify-end gap-1">
                      <Button className="h-8 px-3" onClick={() => setDialog({ type: 'allocate', kind: 'bolt', itemId: r.spec.id })} disabled={r.available === 0} title={r.available === 0 ? 'No received stock available' : undefined}>Allocate</Button>
                      <Button className="h-8 px-3" onClick={() => setDialog({ type: 'order', kind: 'bolt', itemId: r.spec.id })}>Order</Button>
                    </div></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-canvas"><td /><td colSpan={9} className="py-3 pr-4">
                      <p className="mb-2 text-xs text-muted">Foundation requirements consolidated into this purchase line. Ordered, received and available are project-wide; the other figures are for this {scope}.</p>
                      <table className="w-full text-left text-[13px]">
                        <thead><tr>{['Area', 'Foundation', 'Plinth', 'Anchorage', 'Required', 'Allocated', 'Stage'].map((h) => <th key={h} className="t-label py-1 pr-4 font-medium">{h}</th>)}</tr></thead>
                        <tbody>{r.lines.map((l) => (
                          <tr key={l.plinth.id}>
                            <td className="py-1 pr-4 text-muted">{l.area.name}</td>
                            <td className="pr-4"><Link className="underline-offset-4 hover:underline" to={paths.foundation(projectId, l.foundation, l.plinth.id)}>{l.foundation.number}</Link></td>
                            <td className="pr-4">P{l.plinth.index}</td><td className="pr-4">{l.anchorageTypeId}</td><td className="pr-4">{l.qty}</td><td className="pr-4">{l.allocated}</td>
                            <td className="text-muted">{BOLT_STAGE_LABEL[plinthBoltStage(idx, l.plinth)]}</td>
                          </tr>))}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Pipeline: required → ordered → received on site → sorted and allocated → ready for installation. Arrival of a shipment does not make a foundation material-ready.</p>
      {dialog?.type === 'allocate' && <AllocateModal kind="bolt" itemId={dialog.itemId} onClose={() => setDialog(null)} />}
      {dialog?.type === 'order' && <OrderModal kind="bolt" itemId={dialog.itemId} onClose={() => setDialog(null)} />}
    </>
  )
}

export function BulkTable({ areaId }: { areaId?: string }) {
  const { idx } = useConstruction()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>(null)
  const rows = bulkRows(idx, areaId)
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="w-6" />
              <th className={th}>Material</th>
              {!areaId && <th className={th}>Area</th>}
              {['Required', 'Ordered', 'Received', 'Allocated', 'Available', 'Outstanding'].map((h) => <th key={h} className={th}>{h}</th>)}
              <th className={th}>Supplier · PO · Expected</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open.has(r.item.id)
              return (
                <Fragment key={r.item.id}>
                  <tr className="border-b border-line">
                    <td className="py-3.5"><button aria-expanded={isOpen} aria-label={`Toggle ${r.item.description} detail`} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.item.id)) n.delete(r.item.id); else n.add(r.item.id); return n })} className="text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                    <td className="py-3.5 pr-4 text-[13px]"><span className="font-medium">{r.item.description}</span><span className="block text-xs text-muted">{r.item.grade}</span></td>
                    {!areaId && <td className="py-3.5 pr-4 text-[13px] text-muted">{idx.area.get(r.item.areaId)?.name}</td>}
                    <td className={num}>{r.item.requiredQty}{r.item.sample && <span className="block text-xs text-muted">sample figure</span>}</td>
                    <td className={num}>{r.ordered}{r.toOrder > 0 && <span className="block text-xs text-warn">{r.toOrder} to order</span>}</td>
                    <td className={num}>{r.received}</td>
                    <td className={num}>{r.allocated}</td>
                    <td className={num}>{r.available}</td>
                    <td className={num}>{r.outstanding > 0 ? r.outstanding : <span className="text-muted">0</span>}</td>
                    <td className="py-3.5 pr-4 text-[13px] text-muted">{r.suppliers[0] ?? 'Not ordered'}{r.poNumbers.length > 0 && <span className="block text-xs">{r.poNumbers.join(', ')} · {r.expected ? formatShortDate(r.expected) : 'no date'}</span>}</td>
                    <td className="py-3.5 text-right"><div className="flex justify-end gap-1">
                      <Button className="h-8 px-3" disabled={r.available === 0} onClick={() => setDialog({ type: 'allocate', kind: 'bulk', itemId: r.item.id })}>Allocate</Button>
                      <Button className="h-8 px-3" onClick={() => setDialog({ type: 'order', kind: 'bulk', itemId: r.item.id })}>Order</Button>
                    </div></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-canvas"><td /><td colSpan={areaId ? 9 : 10} className="py-3 pr-4 text-[13px]">
                      <p className="mb-2 text-xs text-muted">The required quantity is the area requirement{r.item.sample ? ' (a sample figure for the demonstration, not verified project data)' : ''}. Plinth-level demand derived from anchorage types is {r.demand}.</p>
                      <ul>{idx.state.plinths.filter((p) => areaOfPlinth(idx, p) === r.item.areaId).flatMap((p) => plinthHardware(idx, p, r.item.areaId).filter((h) => h.item?.id === r.item.id).map((h) => ({ p, h }))).map(({ p, h }) => (
                        <li key={p.id} className="flex gap-6 py-0.5"><span className="w-24">{idx.foundation.get(p.foundationId)!.number} · P{p.index}</span><span className="text-muted">demand {h.demand} · allocated {h.allocated}</span></li>
                      ))}</ul>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Nuts and washers are purchased in bulk per area and allocated to plinths from received stock.</p>
      {dialog?.type === 'allocate' && <AllocateModal kind="bulk" itemId={dialog.itemId} onClose={() => setDialog(null)} />}
      {dialog?.type === 'order' && <OrderModal kind="bulk" itemId={dialog.itemId} onClose={() => setDialog(null)} />}
    </>
  )
}
