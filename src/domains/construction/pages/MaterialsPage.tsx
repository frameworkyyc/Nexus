import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { Tabs } from '@/components/ui/Tabs'
import { boltRows } from '../selectors'
import { useConstruction } from '../store'
import { BoltTable, BulkTable } from './materials/Tables'
import { Deliveries, PurchaseOrders } from './materials/Purchasing'

type Tab = 'bolts' | 'bulk' | 'orders' | 'deliveries'

export function MaterialsPage() {
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
      <PageHeader title="Materials & procurement" description="Anchor bolts are ordered by specification; nuts and washers are bought in bulk per area. Receiving and allocation are separate steps." />
      <dl className="mb-8 grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-5">
        {stages.map((s) => <Stat key={s.label} label={s.label} value={s.value} />)}
      </dl>
      <p className="-mt-4 mb-8 text-xs text-muted">Anchor bolt pipeline, all specifications. Quantities are demonstration figures.</p>
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
