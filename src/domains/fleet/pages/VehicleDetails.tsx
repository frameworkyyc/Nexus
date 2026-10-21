import { ArrowLeft } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { canReassign, canReview, canUpdate } from '../access'
import { addDefect, reassignVehicle, reopenDefect, resolveDefect, reviewOdometer } from '../actions'
import { InspectionModal, OdometerModal, ReviewModal, ServiceModal } from '../forms'
import { currentAssignment, fleetRow, historyOf, inspectionsOf, odometerHistory, vehicleTitle } from '../selectors'
import { useFleet, useFleetActor, useFleetRun, useProjectRegistry } from '../store'
import { AccessNotice, ConditionBadge, FleetFooter, NOT_RECORDED } from '../ui'
import { InspectionCell, ServiceCell } from '../FleetTable'

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-line py-3 text-[13px] sm:grid-cols-[12rem_minmax(0,1fr)]">
    <dt className="text-muted">{label}</dt>
    <dd>{children}</dd>
  </div>
)

const Empty = ({ children }: { children: ReactNode }) => <p className="border-t border-line py-5 text-[13px] text-muted">{children}</p>
const link = 'text-xs text-muted underline-offset-4 hover:text-ink hover:underline'
const km = (n: number) => `${n.toLocaleString('en-CA')} km`

type Modal = { kind: 'odometer' } | { kind: 'inspection' } | { kind: 'service' } | { kind: 'review'; id: string } | null

/**
 * One vehicle, in the organization Fleet (/fleet/:id) or inside a project (/projects/:p/fleet/:id). Both routes render
 * this component against the same records; only the navigation differs.
 */
export function VehicleDetails() {
  const { vehicleId = '', projectId } = useParams()
  const { state, today } = useFleet()
  const registry = useProjectRegistry()
  const actor = useFleetActor()
  const run = useFleetRun()
  const [target, setTarget] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const vehicle = state.vehicles.find((v) => v.id === vehicleId)
  const back = projectId ? `/projects/${projectId}/fleet` : '/fleet'
  const backLabel = projectId ? `${registry.name(projectId)} fleet` : 'Fleet'

  if (!vehicle) return <EmptyState title="Vehicle not found" action={<Link to={back} className="text-[13px] underline underline-offset-4">Back to fleet</Link>} />

  const current = currentAssignment(state, vehicle.id)
  if (projectId && current?.projectId !== projectId) {
    return <EmptyState title="Not assigned to this project" description={`${vehicle.unitNumber} is ${current ? `assigned to ${registry.name(current.projectId)}` : 'not assigned to a project'}.`} action={<Link to={`/fleet/${vehicle.id}`} className="text-[13px] underline underline-offset-4">Open in organization fleet</Link>} />
  }
  const editable = canUpdate(state, actor, vehicle.id)
  const reviewer = canReview(state, actor, vehicle.id)
  const row = fleetRow(state, vehicle, today)
  const selected = target ?? current?.projectId ?? ''
  const unchanged = selected === (current?.projectId ?? '')
  const readings = odometerHistory(state, vehicle.id).slice().reverse()
  const inspections = inspectionsOf(state, vehicle.id)
  const maintenance = state.maintenance.filter((m) => m.vehicleId === vehicle.id)
  const targets = state.serviceTargets.filter((t) => t.vehicleId === vehicle.id).slice().reverse()
  const history = historyOf(state, vehicle.id, registry.name)
  const project = current ? registry.get(current.projectId) : undefined
  const reviewing = modal?.kind === 'review' ? inspections.find((i) => i.id === modal.id) : undefined

  return (
    <>
      <Link to={back} className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.5} />{backLabel}
      </Link>
      <PageHeader title={vehicle.unitNumber} description={vehicleTitle(vehicle)} actions={<ConditionBadge condition={row.condition} />} />

      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        <div><dt className="t-label">Odometer</dt><dd className="mt-1 text-[15px]">{row.odometer ? km(row.odometer.reading) : NOT_RECORDED}{row.odometer && <span className="block text-xs text-muted">{formatDate(row.odometer.date)}</span>}</dd></div>
        <div><dt className="t-label">KM to next service</dt><dd className="mt-1 text-[15px]"><ServiceCell row={row} /></dd></div>
        <div><dt className="t-label">Last inspection</dt><dd className="mt-1 text-[15px]"><InspectionCell row={row} /></dd></div>
        <div><dt className="t-label">Outstanding defects</dt><dd className="mt-1 text-[15px] tabular-nums">{row.defects}</dd></div>
      </dl>
      {!editable && <p className="mt-3 text-xs text-muted">View only.</p>}

      <Section title="Odometer" description="Readings are kept as entered. A reading that contradicts the history is held for review and does not change the current mileage until accepted." actions={editable && <Button onClick={() => setModal({ kind: 'odometer' })}>Record reading</Button>}>
        {readings.length ? (
          <ul className="border-t border-line">
            {readings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 text-[13px]">
                <span><span className="tabular-nums">{km(r.reading)}</span><span className="ml-3 text-muted">{formatDate(r.date)}{r.note && ` · ${r.note}`}</span>
                  {r.flag && <span className="block text-xs text-muted">{r.flag}{r.reviewNote && ` Decision note: ${r.reviewNote}`}</span>}</span>
                <span className="flex items-center gap-3">
                  <StatusBadge tone={r.review === 'valid' || r.review === 'accepted' ? 'ok' : r.review === 'rejected' ? 'muted' : 'warn'} label={r.review === 'valid' ? 'Valid' : r.review === 'accepted' ? 'Accepted' : r.review === 'rejected' ? 'Rejected' : 'Held for review'} />
                  {r.review === 'needs-review' && reviewer && (<>
                    <button className={link} onClick={() => run(reviewOdometer(r.id, 'accepted', '', today))}>Accept</button>
                    <button className={link} onClick={() => run(reviewOdometer(r.id, 'rejected', '', today))}>Reject</button>
                  </>)}
                </span>
              </li>
            ))}
          </ul>
        ) : <Empty>No odometer readings recorded.</Empty>}
      </Section>

      <Section title="Service" actions={editable && <Button onClick={() => setModal({ kind: 'service' })}>{row.service.target ? 'Update next service' : 'Set next service'}</Button>}>
        <dl className="border-t border-line">
          <Row label="Next service at">{row.service.target ? km(row.service.target.odometer) : <span className="text-muted">Not set</span>}</Row>
          <Row label="Current odometer">{row.odometer ? km(row.odometer.reading) : NOT_RECORDED}</Row>
          <Row label="KM remaining"><ServiceCell row={row} /></Row>
        </dl>
        {targets.length > 1 && <p className="mt-2 text-xs text-muted">Earlier targets: {targets.slice(1).map((t) => `${km(t.odometer)} (set ${formatDate(t.setDate)})`).join(', ')}</p>}
      </Section>

      <Section title="Weekly inspections" description="A submission records that the inspection happened. It does not say the vehicle is sound: that is a reviewer's call, and defects stay outstanding until resolved." actions={editable && <Button onClick={() => setModal({ kind: 'inspection' })}>Submit inspection</Button>}>
        {inspections.length ? (
          <ul className="border-t border-line">
            {inspections.map((i) => (
              <li key={i.id} className="border-b border-line py-3 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>{formatDate(i.date)}{i.submittedBy && <span className="text-muted"> · {i.submittedBy}</span>}{i.notes && <span className="text-muted"> · {i.notes}</span>}</span>
                  <span className="flex items-center gap-3">
                    <StatusBadge tone={i.review === 'reviewed' ? 'ok' : 'info'} label={i.review === 'reviewed' ? `Reviewed${i.reviewedBy ? ` by ${i.reviewedBy}` : ''}` : 'Submitted, not reviewed'} />
                    {i.review === 'submitted' && reviewer && <button className={link} onClick={() => setModal({ kind: 'review', id: i.id })}>Review</button>}
                  </span>
                </div>
                {i.review === 'reviewed' && (i.reviewNote || i.condition) && <p className="mt-1 text-xs text-muted">{i.condition ? `Reviewer stated condition: ${i.condition}. ` : ''}{i.reviewNote}</p>}
                {i.defects.length > 0 && (
                  <ul className="mt-2 space-y-1 pl-4">
                    {i.defects.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={d.status === 'resolved' ? 'text-muted line-through' : ''}>{d.description}{d.status === 'resolved' && <span className="no-underline"> — resolved {formatDate(d.resolvedDate)}{d.resolutionNote && `: ${d.resolutionNote}`}</span>}</span>
                        {reviewer && (d.status === 'outstanding'
                          ? <button className={link} onClick={() => run(resolveDefect(i.id, d.id, '', today))}>Mark resolved</button>
                          : <button className={link} onClick={() => run(reopenDefect(i.id, d.id))}>Reopen</button>)}
                      </li>
                    ))}
                  </ul>
                )}
                {editable && <button className={`${link} mt-2`} onClick={() => { const text = window.prompt('Describe the defect'); if (text) run(addDefect(i.id, text)) }}>Add defect</button>}
              </li>
            ))}
          </ul>
        ) : <Empty>No inspections recorded. Condition stays “Not assessed” until a reviewed inspection states one.</Empty>}
      </Section>

      <Section title="General information">
        <dl className="border-t border-line">
          <Row label="Unit number">{vehicle.unitNumber}</Row>
          <Row label="Year / make / model">{vehicleTitle(vehicle)}</Row>
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
        {!projectId && canReassign(actor) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Select className="w-64" aria-label="Assign to project" value={selected} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Unassigned</option>
              {registry.projects.map((p) => <option key={p.id} value={p.id}>{p.name} · Job {p.jobNumber}</option>)}
            </Select>
            <Button disabled={unchanged} onClick={() => run(reassignVehicle(vehicle.id, selected || null, registry.projects.map((p) => p.id), today)) === null && setTarget(null)}>Save assignment</Button>
          </div>
        )}
        {projectId && <p className="mt-3 text-xs text-muted">Moving a vehicle to another project is done from the organization fleet.</p>}
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

      <AccessNotice />
      {!projectId && <FleetFooter />}
      {modal?.kind === 'odometer' && <OdometerModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'inspection' && <InspectionModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'service' && <ServiceModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {reviewing && <ReviewModal inspection={reviewing} onClose={() => setModal(null)} />}
    </>
  )
}
