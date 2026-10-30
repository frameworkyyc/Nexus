import { identity } from '@/app/identity'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { Disclosure } from '@/components/ui/Disclosure'
import { Tabs } from '@/components/ui/Tabs'
import { MaterialTracker } from '../tracker/TrackerView'
import { MaterialsByArea } from '../tracker/manage/MaterialsByArea'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { paths } from '../paths'
import { useIsServer } from '@/lib/dataSource'
import { boltRows } from '../selectors'
import { useConstruction } from '../store'
import { BoltTable, BulkTable } from './materials/Tables'
import { Deliveries, PurchaseOrders } from './materials/Purchasing'

type Tab = 'bolts' | 'bulk' | 'orders' | 'deliveries'

export function MaterialsPage() {
  const server = useIsServer()
  const { projectId = '' } = useParams()
  return (
    <>
      <PageHeader title="Materials" actions={!IS_PUBLIC_DEMO ? <Link to={paths.procurement(projectId)} className="inline-flex h-9 items-center rounded-nx border border-line bg-surface px-4 text-[13px] font-medium transition-colors hover:border-ink phone:h-11 phone:text-[15px]">Procurement</Link> : undefined} />
      <MaterialsByArea />
      <p className="mt-10 text-xs text-muted"><Link to={paths.materialRecords(projectId)} className="underline underline-offset-4">Material records, import and export</Link></p>
      {!server && (
        <div className="mt-16 border-t border-line">
          <Disclosure summary={<span className="text-xs text-muted">Demonstration procurement data (fictional) — not part of the {identity.trackerName} tracker or its totals</span>}>
            <DemoMaterials />
          </Disclosure>
        </div>
      )}
    </>
  )
}

/** The detailed material tools, moved off the Materials page: line items and bulk edits, area summary, anchorage sheet, review, history and source. */
export function MaterialRecordsPage() {
  const { projectId = '' } = useParams()
  return (
    <>
      <PageHeader title="Material records" description="Every material line with its orders and deliveries, plus import, export, review and history." actions={<Link to={paths.materials(projectId)} className="text-[13px] underline underline-offset-4">Back to Materials</Link>} />
      <MaterialTracker records />
    </>
  )
}

function DemoMaterials() {
  const { projectId = '' } = useParams()
  const { state, idx } = useConstruction()
  const [tab, setTab] = useState<Tab>('bolts')
  const rows = boltRows(idx)
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0)
  const stages = [
    { label: '1 · Required', value: sum((r) => r.required) },
    { label: '2 · Ordered', value: sum((r) => r.ordered) },
    { label: '3 · Received on site', value: sum((r) => r.received) },
    { label: '4 · Sorted & allocated', value: sum((r) => r.allocatedAll) },
    { label: '5 · Ready for installation', value: sum((r) => r.readyQty) },
  ]
  return (
    <>
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">Anchor bolts are ordered by specification; nuts and washers are bought in bulk per area. Receiving and allocation are separate steps. All quantities here are invented for demonstration.</p>
      <dl className="mb-6 grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-5">
        {stages.map((s) => <Stat key={s.label} label={s.label} value={s.value} />)}
      </dl>
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: 'bolts', label: 'Anchor bolts' }, { id: 'bulk', label: 'Bulk hardware' },
        { id: 'orders', label: 'Purchase orders', count: state.purchaseOrders.length }, { id: 'deliveries', label: 'Deliveries', count: state.deliveries.length },
      ]} />
      <div className="pt-6">
        {tab === 'bolts' && <BoltTable projectId={projectId} />}
        {tab === 'bulk' && <BulkTable />}
        {tab === 'orders' && <PurchaseOrders />}
        {tab === 'deliveries' && <Deliveries />}
      </div>
    </>
  )
}
