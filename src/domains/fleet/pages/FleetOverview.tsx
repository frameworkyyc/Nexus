import { Link, useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { conditionOf, currentAssignment, fleetCounts } from '../selectors'
import { useFleet, useProjectRegistry } from '../store'
import { ConditionBadge, FleetFooter } from '../ui'
import type { Vehicle } from '../types'

export function FleetOverview() {
  const { state } = useFleet()
  const registry = useProjectRegistry()
  const navigate = useNavigate()
  const counts = fleetCounts(state)

  const columns: Column<Vehicle>[] = [
    { key: 'unit', header: 'Unit', render: (v) => (
      <>
        <Link to={`/fleet/${v.id}`} onClick={(e) => e.stopPropagation()} className="font-medium underline-offset-4 hover:underline">{v.unitNumber}</Link>
        <span className="block text-xs text-muted md:hidden">{v.year} {v.make} {v.model}</span>
      </>
    ) },
    { key: 'year', header: 'Year', hideOnMobile: true, render: (v) => <span className="tabular-nums">{v.year}</span> },
    { key: 'make', header: 'Make', hideOnMobile: true, render: (v) => v.make },
    { key: 'model', header: 'Model', hideOnMobile: true, render: (v) => v.model },
    { key: 'project', header: 'Project', render: (v) => { const a = currentAssignment(state, v.id); return a ? registry.name(a.projectId) : <span className="text-muted">Unassigned</span> } },
    { key: 'condition', header: 'Condition', render: (v) => <ConditionBadge condition={conditionOf(state, v.id)} /> },
  ]

  return (
    <>
      <PageHeader title="Fleet" description="Vehicles owned by the organization and where they are assigned." />
      <dl className="grid grid-cols-3 border-y border-line divide-x divide-line [&>div]:py-6 [&>div]:px-4 sm:[&>div]:px-8 [&>div:first-child]:pl-0">
        <Stat label="Vehicles" value={counts.vehicles} />
        <Stat label="Assigned" value={counts.assigned} sub={counts.unassigned ? `${counts.unassigned} unassigned` : undefined} />
        <Stat label="Projects" value={counts.projects} sub="With vehicles" />
      </dl>
      <div className="mt-10">
        <DataTable columns={columns} rows={state.vehicles} getKey={(v) => v.id} onRowClick={(v) => navigate(`/fleet/${v.id}`)} />
      </div>
      <FleetFooter />
    </>
  )
}
