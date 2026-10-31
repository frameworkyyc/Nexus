import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
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
import { UnlinkedNotice } from './UnlinkedNotice'
import { RequirementsView, type RequirementsLayout } from './RequirementsView'
import { ViewToggle } from '@/components/ui/Toolbar'
import { usePersistentChoice } from '@/lib/usePersistentChoice'

type Tab = 'materials' | 'orders'

/** The two Procurement tabs, in order. */
export const PROCUREMENT_TABS: { id: Tab; label: string }[] = [{ id: 'materials', label: 'Materials' }, { id: 'orders', label: 'Orders' }]

/**
 * New order and Receive delivery, identical and in the same place on both tabs. New order opens the one order panel; Receive delivery opens the one
 * delivery panel (which asks for the purchase order first). There is no other way to order or receive from this page.
 */
export function ProcurementActions({ canOrder, canReceive, onNewOrder, onReceive }: { canOrder: boolean; canReceive: boolean; onNewOrder: () => void; onReceive: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="procurement-actions">
      {canOrder && <Button onClick={onNewOrder}>New order</Button>}
      {canReceive && <Button onClick={onReceive}>Receive delivery</Button>}
    </span>
  )
}

/**
 * Procurement: the central place to order and receive the materials that Materials says are required. It reads the same consolidated
 * requirements (so required quantities follow the foundations and the Anchorage Library) and records purchase orders and deliveries against
 * an area's total of each specification, not against every foundation.
 */
const HEAD_LINK = 'inline-flex h-9 items-center rounded-nx border border-line bg-surface px-4 text-[13px] font-medium transition-colors hover:border-ink phone:h-11 phone:text-[15px]'

export function ProcurementPage() {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { state, today } = useTracker()
  const { state: construction } = useConstruction()
  const access = useAccess()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'orders' ? 'orders' : 'materials')
  const [layout, setLayout] = usePersistentChoice<RequirementsLayout>('nexus.procurement.view', ['list', 'blocks'], 'list')
  const [status, setStatus] = useState<ProcStatus | ''>('')
  const [search, setSearch] = useState('')
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
  const actions = <ProcurementActions canOrder={canOrder} canReceive={canReceive} onNewOrder={() => setDialog({ kind: 'order', keys: [] })} onReceive={() => setDialog({ kind: 'receive', keys: [] })} />

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
      <PageHeader title="Procurement" description="Order and receive the materials each area requires. Requirements come from Materials and follow the foundations and the Anchorage Library; orders and deliveries are recorded once per area and specification." actions={<><Link to={paths.materials(projectId)} className={HEAD_LINK}>Materials by area</Link><Link to={paths.materialRecords(projectId)} className={HEAD_LINK}>Material records</Link></>} />
      <AccessBar />
      <dl className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        {(['pending', 'ordered', 'partial', 'received'] as ProcStatus[]).map((s) => <Stat key={s} label={PROC_LABEL[s]} value={counts(s)} sub={s === 'pending' ? 'Required, not yet ordered' : s === 'ordered' ? 'Ordered, nothing arrived' : s === 'partial' ? 'Some has arrived' : 'Received and confirmed'} />)}
      </dl>
      <Tabs<Tab> value={tab} onChange={setTab} items={[{ ...PROCUREMENT_TABS[0], count: rows.length }, { ...PROCUREMENT_TABS[1], count: orders.filter(projectOrder).length }]} />

      {tab === 'materials' && (
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
            {actions}
          </div>
          {shown.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">No materials match.</p> : (
            <RequirementsView rows={shown} layout={layout}
              onOpen={(key) => setDialog({ kind: 'row', key })} showArea={!areaFilter && areas.length > 1} expandAll={!!status || !!search.trim()} />
          )}
        </div>
      )}

      {areas.length > 0 && <div className="pt-5"><UnlinkedNotice state={state} areaIds={new Set(areas.map(([id]) => id))} action={tab !== 'orders' ? <button type="button" className="text-[13px] underline underline-offset-4" onClick={() => setTab('orders')}>Review in Orders</button> : undefined} /></div>}

      {tab === 'orders' && (
        <>
        <div className="flex flex-wrap items-center gap-3 pt-6" data-compact><span className="text-xs text-muted">{orders.filter(projectOrder).length} order{orders.filter(projectOrder).length === 1 ? '' : 's'}</span><span className="grow" />{actions}</div>
        <OrdersTab state={state} orders={orders.filter(projectOrder)} deliveries={deliveries.filter(projectDelivery)} perms={{ order: canOrder, receive: canReceive, void: canVoid }} act={act}
          onReceive={(id) => setDialog({ kind: 'receive', keys: [], order: id })} onAddMaterials={(id) => setDialog({ kind: 'order', keys: [], order: id })} onEdit={(id) => setDialog({ kind: 'po', order: id })} onCorrect={(id) => setDialog({ kind: 'correct', delivery: id })} />
        </>
      )}

      {dialog?.kind === 'order' && <OrderModal rows={rows.filter((r) => r.required > 0 || r.orphan)} initialKeys={dialog.keys} state={state} today={today} order={dialog.order ? (state.orders ?? []).find((o) => o.id === dialog.order) : undefined} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'po' && (state.orders ?? []).some((o) => o.id === dialog.order) && <OrderDetailsModal order={(state.orders ?? []).find((o) => o.id === dialog.order)!} state={state} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'correct' && (state.deliveries ?? []).some((d) => d.id === dialog.delivery) && <CorrectDeliveryModal delivery={(state.deliveries ?? []).find((d) => d.id === dialog.delivery)!} state={state} today={today} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'receive' && <ReceiveModal state={state} today={today} orderId={dialog.order} focusKeys={dialog.keys} inProject={(id) => projectOrder({ id })} onNewOrder={canOrder ? () => setDialog({ kind: 'order', keys: [] }) : undefined} onClose={() => setDialog(null)} />}
      {dlg && <RowModal row={dlg as ProcRow} state={state} foundationName={foundationName} onClose={() => setDialog(null)} onOrder={() => setDialog({ kind: 'order', keys: [dlg.key] })} onReceive={() => setDialog({ kind: 'receive', keys: [dlg.key] })} />}
    </>
  )
}
