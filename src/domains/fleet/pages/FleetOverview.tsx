import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Input, Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { visibleVehicles } from '../access'
import { FleetTable } from '../FleetTable'
import { fleetCounts, fleetRow, vehicleTitle } from '../selectors'
import { useFleet, useFleetActor, useProjectRegistry } from '../store'
import { AccessNotice, FleetFooter } from '../ui'

/** The office view: every vehicle across every project, from the same records the project views use. */
export function FleetOverview() {
  const { state, today } = useFleet()
  const registry = useProjectRegistry()
  const actor = useFleetActor()
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('')
  const counts = fleetCounts(state)
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visibleVehicles(state, actor).map((v) => fleetRow(state, v, today)).filter((r) =>
      (!project || (project === '__none' ? !r.assignment : r.assignment?.projectId === project)) &&
      (!q || `${r.vehicle.unitNumber} ${vehicleTitle(r.vehicle)}`.toLowerCase().includes(q)))
  }, [state, actor, today, search, project])
  const defects = rows.reduce((s, r) => s + r.defects, 0)
  const held = rows.reduce((s, r) => s + r.flaggedReadings, 0)

  return (
    <>
      <PageHeader title="Fleet" description="Vehicles owned by the organization and where they are assigned." />
      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-5">
        <Stat label="Vehicles" value={counts.vehicles} />
        <Stat label="Assigned" value={counts.assigned} sub={counts.unassigned ? `${counts.unassigned} unassigned` : undefined} />
        <Stat label="Projects" value={counts.projects} sub="With vehicles" />
        <Stat label="Outstanding defects" value={defects} />
        <Stat label="Readings held" value={held} sub="Awaiting review" />
      </dl>
      <div className="mt-8 grid grid-cols-2 gap-3 md:max-w-xl">
        <Input type="search" aria-label="Search vehicles" placeholder="Search unit or vehicle" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option><option value="__none">Unassigned</option>
          {registry.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="mt-6">
        <FleetTable rows={rows} projectName={registry.name} unit={(r) => <Link to={`/fleet/${r.vehicle.id}`} className="font-medium underline-offset-4 hover:underline">{r.vehicle.unitNumber}</Link>} />
      </div>
      <AccessNotice />
      <FleetFooter />
    </>
  )
}
