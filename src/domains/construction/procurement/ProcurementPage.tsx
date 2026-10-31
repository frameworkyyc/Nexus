import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { Tabs } from '@/components/ui/Tabs'
import { useAccess } from '@/lib/access'
import { AccessBar } from '../tracker/manage/AccessBar'
import { Chips } from '../tracker/manage/MaterialsByArea'
import { specText } from '../tracker/consolidate'
import { procurementRows, PROC_LABEL, type ProcRow, type ProcStatus } from '../tracker/procurement'
import { useTracker } from '../tracker/store'
import { useToast } from '@/components/ui/Toast'
import { paths } from '../paths'
import { useConstruction } from '../store'
import { CorrectDeliveryModal, OrderModal, OrderDetailsModal, ReceiveModal, RowModal } from './Dialogs'
import { OrdersTab } from './OrdersTab'
import { RequirementsView, type RequirementsLayout } from './RequirementsView'
import { ViewToggle } from '@/components/ui/Toolbar'
import { usePersistentChoice } from '@/lib/usePersistentChoice'

type Tab = 'requirements' | 'orders'

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
  const [layout, setLayout] = usePersistentChoice<RequirementsLayout>('nexus.procurement.view', ['list', 'blocks'], 'list')
  const [status, setStatus] = useState<ProcStatus | ''>('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<null | { kind: 'order' | 'receive'; keys: string[]; order?: string } | { kind: 'row'; key: string } | { kind: 'po'; order: string } | { kind: 'correct'; delivery: string }>(null)
  const areaFilter = params.get('area') ?? ''

  const rows = useMemo(() => {
    const mine = new Set(construction.areas.filter((a) => a.projectId === projectId).map((a) => a.id))
    return procurementRows(state, construction).filter((r) => (r.areaId ? mine.has(r.areaId) : true))
  }, [state, construction, projectId])
  const areas = useMemo(() => { const m = new Map<string, string>(); for (const r of rows) m.set(r.areaId ?? `t:${r.area}`, r.area); return [...m] }, [rows])
  const shown = rows.filter((r) => (!areaFilter || (r.areaId ?? `t:${r.area}`) === areaFilter) && (!status || r.status === status) && (!search.trim() || `${r.name} ${specText(r)} ${r.area}`.toLowerCase().includes(search.trim().toLowerCase())))
  const counts = (s: ProcStatus) => rows.filter((r) => r.status === s && r.required > 0).length
  const foundationName = (id: string) => construction.foundations.find((f) => f.id === id)?.number ?? id
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
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ id: 'requirements', label: 'Requirements', count: rows.length }, { id: 'orders', label: 'Orders', count: orders.filter(projectOrder).length }]} />

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
            <ViewToggle label="Requirements view" value={layout} onChange={setLayout} items={[{ id: 'list', label: 'List' }, { id: 'blocks', label: 'Blocks' }]} />
            {canOrder && <Button onClick={() => setDialog({ kind: 'order', keys: [] })}>New order</Button>}
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
            <RequirementsView rows={shown} layout={layout} picked={picked} onPick={(keys, on) => setPicked((p) => { const n = new Set(p); for (const k of keys) { if (on) n.add(k); else n.delete(k) } return n })}
              onOpen={(key) => setDialog({ kind: 'row', key })} showArea={!areaFilter && areas.length > 1} expandAll={!!status || !!search.trim()} />
          )}
        </div>
      )}

      {tab === 'orders' && (
        <OrdersTab state={state} orders={orders.filter(projectOrder)} deliveries={deliveries.filter(projectDelivery)} perms={{ order: canOrder, receive: canReceive, void: canVoid }} act={act}
          onReceive={(id) => setDialog({ kind: 'receive', keys: [], order: id })} onAddMaterials={(id) => setDialog({ kind: 'order', keys: [], order: id })} onEdit={(id) => setDialog({ kind: 'po', order: id })} onCorrect={(id) => setDialog({ kind: 'correct', delivery: id })} />
      )}

      {dialog?.kind === 'order' && <OrderModal rows={rows.filter((r) => r.required > 0 || r.orphan)} initialKeys={dialog.keys} state={state} today={today} order={dialog.order ? (state.orders ?? []).find((o) => o.id === dialog.order) : undefined} onClose={() => { setDialog(null); setPicked(new Set()) }} />}
      {dialog?.kind === 'po' && (state.orders ?? []).some((o) => o.id === dialog.order) && <OrderDetailsModal order={(state.orders ?? []).find((o) => o.id === dialog.order)!} state={state} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'correct' && (state.deliveries ?? []).some((d) => d.id === dialog.delivery) && <CorrectDeliveryModal delivery={(state.deliveries ?? []).find((d) => d.id === dialog.delivery)!} state={state} today={today} onClose={() => setDialog(null)} />}
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
