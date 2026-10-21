import { ArrowLeft } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { formatDate } from '@/lib/format'
import { reassignVehicle } from '../actions'
import { conditionOf, currentAssignment, historyOf, latestOdometer, vehicleTitle } from '../selectors'
import { useFleet, useFleetRun, useProjectRegistry } from '../store'
import { ConditionBadge, FleetFooter, NOT_RECORDED } from '../ui'

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-line py-3 text-[13px] sm:grid-cols-[12rem_minmax(0,1fr)]">
    <dt className="text-muted">{label}</dt>
    <dd>{children}</dd>
  </div>
)

const Empty = ({ children }: { children: ReactNode }) => <p className="border-t border-line py-5 text-[13px] text-muted">{children}</p>

/** One vehicle. Sections are ready for odometer, inspection and maintenance records; none are invented. */
export function VehicleDetails() {
  const { vehicleId = '' } = useParams()
  const { state, today } = useFleet()
  const registry = useProjectRegistry()
  const run = useFleetRun()
  const vehicle = state.vehicles.find((v) => v.id === vehicleId)
  const current = vehicle ? currentAssignment(state, vehicle.id) : undefined
  const [target, setTarget] = useState<string | null>(null)

  if (!vehicle) return <EmptyState title="Vehicle not found" action={<Link to="/fleet" className="text-[13px] underline underline-offset-4">Back to fleet</Link>} />

  const selected = target ?? current?.projectId ?? ''
  const unchanged = selected === (current?.projectId ?? '')
  const odometer = latestOdometer(state, vehicle.id)
  const inspections = state.inspections.filter((i) => i.vehicleId === vehicle.id)
  const maintenance = state.maintenance.filter((m) => m.vehicleId === vehicle.id)
  const history = historyOf(state, vehicle.id, registry.name)
  const project = current ? registry.get(current.projectId) : undefined

  return (
    <>
      <Link to="/fleet" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.5} />Fleet
      </Link>
      <PageHeader title={vehicle.unitNumber} description={vehicleTitle(vehicle)} actions={<ConditionBadge condition={conditionOf(state, vehicle.id)} />} />

      <Section title="General information" className="mt-2">
        <dl className="border-t border-line">
          <Row label="Unit number">{vehicle.unitNumber}</Row>
          <Row label="Year">{vehicle.year}</Row>
          <Row label="Make">{vehicle.make}</Row>
          <Row label="Model">{vehicle.model}</Row>
          <Row label="VIN">{vehicle.vin ?? NOT_RECORDED}</Row>
          <Row label="Licence plate">{vehicle.licencePlate ?? NOT_RECORDED}</Row>
          <Row label="Notes">{vehicle.notes || NOT_RECORDED}</Row>
        </dl>
      </Section>

      <Section title="Project assignment" description="Vehicles belong to the organization. A project assignment can change without affecting the vehicle's history.">
        <dl className="border-t border-line">
          <Row label="Current project">{project ? <Link to={`/projects/${project.id}`} className="underline-offset-4 hover:underline">{project.name} · Job {project.jobNumber}</Link> : current ? registry.name(current.projectId) : <span className="text-muted">Unassigned</span>}</Row>
          <Row label="Assigned since">{current?.startDate ? formatDate(current.startDate) : NOT_RECORDED}</Row>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select className="w-64" aria-label="Assign to project" value={selected} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Unassigned</option>
            {registry.projects.map((p) => <option key={p.id} value={p.id}>{p.name} · Job {p.jobNumber}</option>)}
          </Select>
          <Button disabled={unchanged} onClick={() => run(reassignVehicle(vehicle.id, selected || null, registry.projects.map((p) => p.id), today)) === null && setTarget(null)}>Save assignment</Button>
        </div>
      </Section>

      <Section title="Odometer">
        {odometer ? (
          <dl className="border-t border-line"><Row label="Latest reading">{odometer.reading.toLocaleString('en-CA')} {odometer.unit}</Row><Row label="Recorded">{formatDate(odometer.date)}</Row></dl>
        ) : <Empty>No odometer readings recorded.</Empty>}
      </Section>

      <Section title="Inspections">
        {inspections.length ? (
          <ul className="border-t border-line">{inspections.map((i) => <li key={i.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[13px]"><span>{formatDate(i.date)}{i.notes && <span className="ml-3 text-muted">{i.notes}</span>}</span><ConditionBadge condition={i.condition} /></li>)}</ul>
        ) : <Empty>No inspections recorded. Condition stays “Not assessed” until one is entered.</Empty>}
      </Section>

      <Section title="Maintenance">
        {maintenance.length ? (
          <ul className="border-t border-line">{maintenance.map((m) => <li key={m.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[13px]"><span>{m.description}</span><span className="text-muted">{formatDate(m.date)}</span></li>)}</ul>
        ) : <Empty>No maintenance recorded.</Empty>}
      </Section>

      <Section title="History">
        <ul className="border-t border-line">
          {history.map((h) => (
            <li key={h.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[13px]">
              <span>{h.text}</span>
              <span className="shrink-0 text-xs text-muted">{h.date ? formatDate(h.date) : 'Date not recorded'}</span>
            </li>
          ))}
          {!history.length && <li className="border-b border-line py-5 text-[13px] text-muted">Nothing recorded yet.</li>}
        </ul>
      </Section>

      <FleetFooter />
    </>
  )
}
