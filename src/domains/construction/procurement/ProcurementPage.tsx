import { ChevronRight } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { formatDate } from '@/lib/format'
import { useAccess } from '@/lib/access'
import { AccessBar } from '../tracker/manage/AccessBar'
import { Chips } from '../tracker/manage/MaterialsByArea'
import { cancelPurchaseOrder, voidDelivery } from '../tracker/commands'
import { specText } from '../tracker/consolidate'
import { orderProgress, procurementRows, PROC_LABEL, type ProcRow, type ProcStatus } from '../tracker/procurement'
import { trackerStore, useTracker } from '../tracker/store'
import { useToast } from '@/components/ui/Toast'
import { paths } from '../paths'
import { useConstruction } from '../store'
import { fmt, OrderModal, ReceiveModal, RowModal, when, who } from './Dialogs'

type Tab = 'requirements' | 'orders' | 'deliveries'
const TONE: Record<ProcStatus, Tone> = { pending: 'muted', ordered: 'info', partial: 'warn', received: 'ok' }

/**
 * Procurement: the central place to order and receive the materials that Materials says are required. It reads the same consolidated
 * requirements (so required quantities follow the foundations and the Anchorage Library) and records purchase orders and deliveries against
 * an area's total of each specification, not against every foundation.
 */
export function ProcurementPage() {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { state, today } = useTracker()
  const { state: construction } = useConstruction()
  const access = useAccess()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('requirements')
  const [status, setStatus] = useState<ProcStatus | ''>('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<null | { kind: 'order' | 'receive'; keys: string[]; order?: string } | { kind: 'row'; key: string }>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const areaFilter = params.get('area') ?? ''

  const rows = useMemo(() => {
    const mine = new Set(construction.areas.filter((a) => a.projectId === projectId).map((a) => a.id))
    return procurementRows(state, construction).filter((r) => (r.areaId ? mine.has(r.areaId) : true))
  }, [state, construction, projectId])
  const areas = useMemo(() => { const m = new Map<string, string>(); for (const r of rows) m.set(r.areaId ?? `t:${r.area}`, r.area); return [...m] }, [rows])
  const shown = rows.filter((r) => (!areaFilter || (r.areaId ?? `t:${r.area}`) === areaFilter) && (!status || r.status === status) && (!search.trim() || `${r.name} ${specText(r)} ${r.area}`.toLowerCase().includes(search.trim().toLowerCase())))
  const byArea = [...new Set(shown.map((r) => r.area))].map((a) => ({ area: a, rows: shown.filter((r) => r.area === a) }))
  const counts = (s: ProcStatus) => rows.filter((r) => r.status === s && r.required > 0).length
  const foundationName = (id: string) => construction.foundations.find((f) => f.id === id)?.number ?? id
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }
  const canOrder = access.can('materials.edit'), canReceive = access.can('materials.receive'), canVoid = access.can('materials.void-receipt')
  const orders = (state.orders ?? []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
  const projectOrder = (o: { id: string }) => (state.orderLines ?? []).some((l) => l.orderId === o.id && (!l.areaId || rows.some((r) => r.key === l.key) || areas.some(([id]) => id === l.areaId)))
  const deliveries = (state.deliveries ?? []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
  const projectDelivery = (d: { id: string }) => (state.deliveryLines ?? []).some((l) => l.deliveryId === d.id && (!l.areaId || areas.some(([id]) => id === l.areaId)))
  const dlg = dialog?.kind === 'row' ? rows.find((r) => r.key === dialog.key) : undefined

  const act = async (run: () => Promise<string | null>) => { const e = await run(); if (e) toast(e) }

  if (rows.length === 0 && (state.orders ?? []).length === 0) {
    return (
      <>
        <PageHeader title="Procurement" description="Order and receive the materials each area requires." />
        <AccessBar />
        <EmptyState title="Nothing to procure yet" description="Requirements appear here automatically once an anchorage type is configured in the Anchorage Library and assigned to foundations, or materials are added in Materials." action={<Link to={paths.materials(projectId)} className="text-[13px] underline underline-offset-4">Go to Materials</Link>} />
      </>
    )
  }
  return (
    <>
      <PageHeader title="Procurement" description="Order and receive the materials each area requires. Requirements come from Materials and follow the foundations and the Anchorage Library; orders and deliveries are recorded once per area and specification." />
      <AccessBar />
      <dl className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        {(['pending', 'ordered', 'partial', 'received'] as ProcStatus[]).map((s) => <Stat key={s} label={PROC_LABEL[s]} value={counts(s)} sub={s === 'pending' ? 'Required, not yet ordered' : s === 'ordered' ? 'Ordered, nothing arrived' : s === 'partial' ? 'Some has arrived' : 'Received and confirmed'} />)}
      </dl>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'requirements', label: 'Requirements', count: rows.length }, { id: 'orders', label: 'Purchase orders', count: orders.filter(projectOrder).length }, { id: 'deliveries', label: 'Deliveries', count: deliveries.filter(projectDelivery).length }]} />

      {tab === 'requirements' && (
        <div className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            {areas.length > 1 && <Chips label="Area" value={areaFilter} onChange={(v) => setParams(v ? { area: v } : {})} items={[{ id: '', label: 'All areas' }, ...areas.map(([id, name]) => ({ id, label: name }))]} />}
          </div>
          <div className="flex flex-wrap items-center gap-3" data-compact>
            <Input aria-label="Search materials" className="!w-64" placeholder="Search material, specification, area" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value as ProcStatus | '')}>
              <option value="">Any status</option>{(Object.keys(PROC_LABEL) as ProcStatus[]).map((s) => <option key={s} value={s}>{PROC_LABEL[s]}</option>)}
            </Select>
            <span className="text-xs text-muted">{shown.length} of {rows.length} materials</span>
            <span className="grow" />
            {canOrder && <Button onClick={() => setDialog({ kind: 'order', keys: [] })}>New purchase order</Button>}
            {canReceive && <Button onClick={() => setDialog({ kind: 'receive', keys: [] })}>Receive delivery</Button>}
          </div>
          {picked.size > 0 && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-nx border border-line bg-hover px-3 py-2 text-[13px]" data-compact>
              <span className="font-medium">{picked.size} selected</span>
              {canOrder && <Button onClick={() => setDialog({ kind: 'order', keys: [...picked] })}>Order selected</Button>}
              {canReceive && <Button onClick={() => setDialog({ kind: 'receive', keys: [...picked] })}>Receive selected</Button>}
              <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
          )}
          {shown.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">No materials match.</p> : (
            <table className="card-table w-full text-left text-[13px]">
              <thead><tr className="border-b border-line">
                <th scope="col" className="w-8"><span className="sr-only">Select</span></th><th scope="col" className="t-label font-medium">Material</th>
                <th scope="col" className="t-label text-right font-medium">Required</th><th scope="col" className="t-label text-right font-medium">Ordered</th><th scope="col" className="t-label text-right font-medium">Received</th>
                <th scope="col" className="t-label text-right font-medium">Outstanding</th><th scope="col" className="t-label text-right font-medium">Allocated</th><th scope="col" className="t-label font-medium">Status</th>
              </tr></thead>
              <tbody>
                {byArea.map((g) => (
                  <Fragment key={g.area}>
                    <tr data-wide><td colSpan={8} className="border-b border-line bg-hover px-2 py-2 text-xs font-medium">
                      <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Select all in ${g.area}`} checked={g.rows.every((r) => picked.has(r.key))} onChange={(e) => setPicked((p) => { const n = new Set(p); for (const r of g.rows) { if (e.target.checked) n.add(r.key); else n.delete(r.key) } return n })} />{g.area} <span className="font-normal text-muted">· {g.rows.length} material{g.rows.length === 1 ? '' : 's'}</span></label>
                    </td></tr>
                    {g.rows.map((r) => (
                      <tr key={r.key} className={`border-b border-line transition-colors hover:bg-hover ${r.orphan ? 'opacity-70' : ''}`}>
                        <td><input type="checkbox" aria-label={`Select ${r.name} ${specText(r)}`} checked={picked.has(r.key)} onChange={() => setPicked(toggle(picked, r.key))} /></td>
                        <td><button type="button" onClick={() => setDialog({ kind: 'row', key: r.key })} className="block text-left"><span className="font-medium underline-offset-4 hover:underline">{r.name}</span>{r.orphan && <span className="ml-2 text-xs text-warn">No longer required</span>}<span className="block text-xs text-muted" title={specText(r)}>{specText(r) || r.unit}</span></button></td>
                        <td className="text-right font-medium">{fmt(r.required)}</td><td className="text-right">{fmt(r.ordered)}</td><td className="text-right">{fmt(r.received)}</td>
                        <td className="text-right">{fmt(r.outstanding)}</td><td className="text-right" title={`${fmt(r.unallocated)} received and not yet allocated`}>{fmt(r.allocated)}</td>
                        <td><StatusBadge tone={TONE[r.status]} label={PROC_LABEL[r.status]} /></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="pt-6">
          {orders.filter(projectOrder).length === 0 ? <EmptyState title="No purchase orders yet" description="Select materials in Requirements and choose Order selected, or use New purchase order." /> : (
            <table className="card-table w-full text-left text-[13px]">
              <thead><tr className="border-b border-line">
                <th scope="col" className="w-8"><span className="sr-only">Expand</span></th><th scope="col" className="t-label font-medium">PO</th><th scope="col" className="t-label font-medium">Supplier</th><th scope="col" className="t-label font-medium">Date</th>
                <th scope="col" className="t-label text-right font-medium">Ordered</th><th scope="col" className="t-label text-right font-medium">Received</th><th scope="col" className="t-label text-right font-medium">Due</th><th scope="col" className="t-label font-medium">Status</th><th scope="col" className="t-label font-medium"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {orders.filter(projectOrder).map((o) => {
                  const p = orderProgress(state, o.id)
                  const st = o.cancelled ? 'Cancelled' : p.due === 0 && p.ordered > 0 ? 'Complete' : p.received > 0 ? 'Partially received' : 'Open'
                  const isOpen = open.has(o.id)
                  return (
                    <Fragment key={o.id}>
                      <tr className={`border-b border-line transition-colors hover:bg-hover ${o.cancelled ? 'opacity-60' : ''}`}>
                        <td><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} lines of ${o.number}`} onClick={() => setOpen(toggle(open, o.id))} className="grid h-8 w-8 place-items-center text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                        <td className="font-medium">{o.number}</td><td>{o.supplier}</td><td>{formatDate(o.date)}</td>
                        <td className="text-right">{fmt(p.ordered)}</td><td className="text-right">{fmt(p.received)}</td><td className="text-right">{fmt(o.cancelled ? 0 : p.due)}</td>
                        <td><StatusBadge tone={st === 'Complete' ? 'ok' : st === 'Partially received' ? 'warn' : st === 'Cancelled' ? 'muted' : 'info'} label={st} /></td>
                        <td className="whitespace-nowrap text-right">
                          {!o.cancelled && p.due > 0 && canReceive && <Button className="!h-8" onClick={() => setDialog({ kind: 'receive', keys: [], order: o.id })}>Receive</Button>}
                          {!o.cancelled && canVoid && p.deliveries.length === 0 && <Button variant="ghost" className="!h-8" onClick={() => { if (window.confirm(`Cancel purchase order ${o.number}? It stays on record.`)) void act(() => trackerStore.run(cancelPurchaseOrder(o.id))) }}>Cancel</Button>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr data-wide><td colSpan={9} className="border-b border-line bg-hover px-3 py-3">
                          <table className="w-full max-w-4xl text-left" aria-label={`Lines of ${o.number}`}>
                            <thead><tr className="border-b border-line"><th scope="col" className="t-label font-medium">Area</th><th scope="col" className="t-label font-medium">Material</th><th scope="col" className="t-label text-right font-medium">Ordered</th><th scope="col" className="t-label text-right font-medium">Received</th><th scope="col" className="t-label text-right font-medium">Due</th></tr></thead>
                            <tbody>{p.lines.map(({ line, received, due }) => <tr key={line.id} className="border-b border-line"><td>{line.area}</td><td title={`${line.name} ${specText(line)}`}>{line.name}{specText(line) ? ` · ${specText(line)}` : ''}</td><td className="text-right">{fmt(line.qty)}</td><td className="text-right">{fmt(received)}</td><td className="text-right">{fmt(due)}</td></tr>)}</tbody>
                          </table>
                          {o.notes && <p className="mt-2 text-xs text-muted">{o.notes}</p>}
                          {canOrder && !o.cancelled && <div className="mt-2"><Button variant="ghost" className="!h-8 px-2" onClick={() => setDialog({ kind: 'order', keys: [], order: o.id })}>Add materials to this order</Button></div>}
                        </td></tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'deliveries' && (
        <div className="pt-6">
          {deliveries.filter(projectDelivery).length === 0 ? <EmptyState title="No deliveries recorded" description="Choose Receive delivery on Requirements or on a purchase order. One delivery can cover several materials and areas." /> : (
            <table className="card-table w-full text-left text-[13px]">
              <thead><tr className="border-b border-line">
                <th scope="col" className="w-8"><span className="sr-only">Expand</span></th><th scope="col" className="t-label font-medium">Received</th><th scope="col" className="t-label font-medium">Reference</th><th scope="col" className="t-label font-medium">Order</th><th scope="col" className="t-label text-right font-medium">Items</th>
                <th scope="col" className="t-label font-medium">Confirmed by</th><th scope="col" className="t-label font-medium">Recorded</th><th scope="col" className="t-label font-medium"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {deliveries.filter(projectDelivery).map((d) => {
                  const lines = (state.deliveryLines ?? []).filter((l) => l.deliveryId === d.id)
                  const isOpen = open.has(d.id)
                  return (
                    <Fragment key={d.id}>
                      <tr className="border-b border-line transition-colors hover:bg-hover">
                        <td><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} lines of the delivery on ${d.date}`} onClick={() => setOpen(toggle(open, d.id))} className="grid h-8 w-8 place-items-center text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                        <td>{formatDate(d.date)}</td><td>{d.reference || <span className="text-muted">—</span>}</td><td>{(state.orders ?? []).find((o) => o.id === d.orderId)?.number ?? <span className="text-muted">—</span>}</td>
                        <td className="text-right">{fmt(lines.reduce((a, l) => a + l.qty, 0))}</td><td>{who(d.by)}</td><td>{when(d.at) || '—'}</td>
                        <td className="text-right">{canVoid && <Button variant="ghost" className="!h-8" onClick={() => { if (window.confirm('Void this delivery? It is removed from the received totals and stays in the history.')) void act(() => trackerStore.run(voidDelivery(d.id))) }}>Void</Button>}</td>
                      </tr>
                      {isOpen && <tr data-wide><td colSpan={8} className="border-b border-line bg-hover px-3 py-3"><ul className="max-w-3xl divide-y divide-line text-[13px]">{lines.map((l) => <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{l.area} · {l.name}{specText(l) ? ` · ${specText(l)}` : ''}</span><span className="tabular-nums">{fmt(l.qty)} {l.unit}</span></li>)}</ul>{d.note && <p className="mt-2 text-xs text-muted">{d.note}</p>}</td></tr>}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {dialog?.kind === 'order' && <OrderModal rows={rows.filter((r) => r.required > 0 || r.orphan)} initialKeys={dialog.keys} state={state} today={today} order={dialog.order ? (state.orders ?? []).find((o) => o.id === dialog.order) : undefined} onClose={() => { setDialog(null); setPicked(new Set()) }} />}
      {dialog?.kind === 'receive' && <ReceiveModal rows={rows} initialKeys={dialog.keys} state={state} today={today} order={dialog.order ? (state.orders ?? []).find((o) => o.id === dialog.order) : undefined} onClose={() => { setDialog(null); setPicked(new Set()) }} />}
      {dlg && <RowModal row={dlg as ProcRow} state={state} foundationName={foundationName} onClose={() => setDialog(null)} onOrder={() => setDialog({ kind: 'order', keys: [dlg.key] })} onReceive={() => setDialog({ kind: 'receive', keys: [dlg.key] })} />}
    </>
  )
}

/** The sidebar's Procurement: straight to the project's procurement when there is one project, otherwise a choice. */
export function ProcurementIndex() {
  const { state } = useConstruction()
  const projects = state.projects
  if (projects.length === 1) return <Navigate to={paths.procurement(projects[0].id)} replace />
  return (
    <>
      <PageHeader title="Procurement" description="Choose a project to order and receive its materials." />
      {projects.length === 0 ? <EmptyState title="No projects yet" description="Procurement is organised by project and area. Create a project first." /> : (
        <ul className="divide-y divide-line border-y border-line">{projects.map((p) => <li key={p.id}><Link to={paths.procurement(p.id)} className="flex items-center justify-between py-3 text-[15px]"><span>{p.name}</span><ChevronRight size={14} strokeWidth={1.5} className="text-muted" /></Link></li>)}</ul>
      )}
    </>
  )
}
