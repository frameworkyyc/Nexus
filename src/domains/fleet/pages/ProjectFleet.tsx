import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Stat } from '@/components/ui/Stat'
import { canUpdate, visibleVehicles } from '../access'
import { FleetTable } from '../FleetTable'
import { InspectionModal, OdometerModal, ServiceModal } from '../forms'
import { fleetRow, vehiclesForProject } from '../selectors'
import { useFleet, useFleetActor, useProjectRegistry } from '../store'
import { AccessNotice } from '../ui'
import type { Vehicle } from '../types'

type Modal = { kind: 'odometer' | 'inspection' | 'service'; vehicle: Vehicle } | null

/**
 * A project's view of the organization's fleet: the vehicles currently assigned to it, with the weekly tasks site
 * supervisors need. It reads and writes the very same fleet records as /fleet; nothing is copied.
 */
export function ProjectFleet() {
  const { projectId = '' } = useParams()
  const { state, today } = useFleet()
  const registry = useProjectRegistry()
  const actor = useFleetActor()
  const [modal, setModal] = useState<Modal>(null)
  const project = registry.get(projectId)
  const allowed = new Set(visibleVehicles(state, actor).map((v) => v.id))
  const rows = vehiclesForProject(state, projectId).filter((v) => allowed.has(v.id)).map((v) => fleetRow(state, v, today))
  const overdue = rows.filter((r) => r.inspection.overdue || r.inspection.state === 'none').length
  const defects = rows.reduce((s, r) => s + r.defects, 0)
  const held = rows.reduce((s, r) => s + r.flaggedReadings, 0)
  const act = 'h-8 px-2 whitespace-nowrap'

  return (
    <>
      <PageHeader title="Fleet" description={`Vehicles currently assigned to ${project?.name ?? 'this project'}. Records are shared with the organization fleet.`} actions={<Link to="/fleet" className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">Organization fleet</Link>} />
      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        <Stat label="Vehicles" value={rows.length} />
        <Stat label="Inspection due" value={overdue} sub="None recorded or over 7 days" />
        <Stat label="Outstanding defects" value={defects} />
        <Stat label="Readings held" value={held} sub="Awaiting review" />
      </dl>
      <div className="mt-8">
        {rows.length ? (
          <FleetTable
            rows={rows}
            unit={(r) => <Link to={`/projects/${projectId}/fleet/${r.vehicle.id}`} className="font-medium underline-offset-4 hover:underline">{r.vehicle.unitNumber}</Link>}
            actions={(r) => canUpdate(state, actor, r.vehicle.id) && (
              <>
                <Button variant="ghost" className={act} onClick={() => setModal({ kind: 'odometer', vehicle: r.vehicle })}>Odometer</Button>
                <Button variant="ghost" className={act} onClick={() => setModal({ kind: 'inspection', vehicle: r.vehicle })}>Inspection</Button>
                <Button variant="ghost" className={act} onClick={() => setModal({ kind: 'service', vehicle: r.vehicle })}>Service</Button>
              </>
            )}
          />
        ) : <EmptyState title="No vehicles assigned" description="Assign vehicles to this project from the organization fleet." />}
      </div>
      <AccessNotice />
      {modal?.kind === 'odometer' && <OdometerModal vehicle={modal.vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'inspection' && <InspectionModal vehicle={modal.vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'service' && <ServiceModal vehicle={modal.vehicle} onClose={() => setModal(null)} />}
    </>
  )
}
