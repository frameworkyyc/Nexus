import { ArrowLeft } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Sparkline } from '@/components/viz'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { canReassign, canReview, canUpdate } from '../access'
import { addDefect, reassignVehicle, removeDemoInspections, reopenDefect, resolveDefect, reviewOdometer } from '../commands'
import { ServiceCell } from '../FleetTable'
import {
  AccessoryModal, AccessoryMoveModal, InspectionModal, MaintenanceModal, OdometerModal, PlanningModal, RemoveTireModal, ReviewModal, ServiceModal, TireModal, TreadModal, VehicleEditModal,
  type MoveMode, type TireMode,
} from '../forms'
import { fleetPaths } from '../paths'
import { oilIndicator, pct1 } from '../indicators'
import { VehicleGauges } from '../VehicleGauges'
import {
  accessoriesOf, ACCESSORY_CATEGORY_LABEL, currentAssignment, fleetRow, historyOf, inspectionsOf, lastService, latestTread, maintenanceOf, odometerHistory, tireKm, tireSetsOf, TIRE_CLASS_LABEL,
  TIRE_CONDITION_LABEL, vehicleTitle,
} from '../selectors'
import { useFleet, useFleetActor, useFleetCommand, useProjectRegistry } from '../store'
import { AccessNotice, ConditionBadge, FleetFooter, NOT_RECORDED } from '../ui'
import type { Accessory, InspectionRecord, TireSet } from '../types'

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-line py-3 text-[13px] sm:grid-cols-[12rem_minmax(0,1fr)]">
    <dt className="text-muted">{label}</dt>
    <dd>{children}</dd>
  </div>
)
const Empty = ({ children }: { children: ReactNode }) => <p className="border-t border-line py-5 text-[13px] text-muted">{children}</p>
const link = 'text-xs text-muted underline-offset-4 hover:text-ink hover:underline'
const km = (n: number) => `${n.toLocaleString('en-CA')} km`
const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })

type Modal =
  | { kind: 'edit' | 'odometer' | 'inspection' | 'service' | 'oil-target' | 'oil-record' | 'planning' | 'maintenance' | 'accessory-add' }
  | { kind: 'review'; inspection: InspectionRecord }
  | { kind: 'tire'; mode: TireMode }
  | { kind: 'tread' | 'tire-remove'; tire: TireSet }
  | { kind: 'accessory-edit'; accessory: Accessory }
  | { kind: 'move'; accessory: Accessory; mode: MoveMode }
  | null

/** Scrolls to a detail section; used by the gauges and the section links. */
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const SECTIONS = [
  ['overview', 'Overview'], ['odometer', 'Odometer'], ['maintenance', 'Maintenance'], ['tires', 'Tires'], ['accessories', 'Accessories'], ['inspections', 'Inspections'], ['history', 'History'],
] as const

/**
 * The vehicle dashboard. Reached from the organization Fleet (/fleet/:id) or from a project's Fleet (/projects/:p/fleet/:id):
 * both routes render this component against the same vehicle record, so there is one source of truth. Only the back link and
 * breadcrumbs follow the route the user came through.
 */
export function VehicleDashboard() {
  const { vehicleId = '', projectId } = useParams()
  const { state, today } = useFleet()
  const registry = useProjectRegistry()
  const actor = useFleetActor()
  const { run } = useFleetCommand()
  const [target, setTarget] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const vehicle = state.vehicles.find((v) => v.id === vehicleId)
  const back = projectId ? fleetPaths.project(projectId) : fleetPaths.org()
  const backLabel = projectId ? `${registry.name(projectId)} fleet` : 'Fleet'

  if (!vehicle) return <EmptyState title="Vehicle not found" action={<Link to={back} className="text-[13px] underline underline-offset-4">Back to fleet</Link>} />

  const current = currentAssignment(state, vehicle.id)
  if (projectId && current?.projectId !== projectId) {
    return <EmptyState title="Not assigned to this project" description={`${vehicle.unitNumber} is ${current ? `assigned to ${registry.name(current.projectId)}` : 'not assigned to a project'}.`} action={<Link to={fleetPaths.orgVehicle(vehicle.id)} className="text-[13px] underline underline-offset-4">Open in organization fleet</Link>} />
  }
  const editable = canUpdate(state, actor, vehicle.id)
  const reviewer = canReview(state, actor, vehicle.id)
  const row = fleetRow(state, vehicle, today)
  const selected = target ?? current?.projectId ?? ''
  const unchanged = selected === (current?.projectId ?? '')
  const readings = odometerHistory(state, vehicle.id).slice().reverse()
  const inspections = inspectionsOf(state, vehicle.id)
  const demoCount = inspections.filter((i) => i.demo).length
  const maintenance = maintenanceOf(state, vehicle.id)
  const targets = state.serviceTargets.filter((t) => t.vehicleId === vehicle.id).slice().reverse()
  const tires = tireSetsOf(state, vehicle.id)
  const accessories = accessoriesOf(state, vehicle.id)
  const history = historyOf(state, vehicle.id, registry.name)
  const project = current ? registry.get(current.projectId) : undefined
  const s = row.service
  const oil = lastService(state, vehicle.id, 'Oil change')
  const lastAny = lastService(state, vehicle.id)
  const oilInd = oilIndicator(state, vehicle.id)
  // Green only when a recorded warning window says the vehicle is outside it; with none recorded, not-yet-due is neutral blue.
  const serviceTone: Tone = s.state === 'overdue' ? 'bad' : s.state === 'due-soon' ? 'warn' : s.target?.warnWithinKm ? 'ok' : 'info'
  const Btn = ({ onClick, children, variant }: { onClick: () => void; children: ReactNode; variant?: 'primary' | 'secondary' }) => <Button variant={variant} className="h-8 px-3" onClick={onClick}>{children}</Button>

  return (
    <>
      <Link to={back} className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.5} />{backLabel}
      </Link>
      <PageHeader title={vehicle.unitNumber} description={`${vehicleTitle(vehicle)}${project ? ` · ${project.name}` : ' · Unassigned'}`} actions={<><ConditionBadge condition={row.condition} />{editable && <Btn onClick={() => setModal({ kind: 'edit' })}>Edit vehicle</Btn>}</>} />

      <VehicleGauges state={state} vehicle={vehicle} today={today} projectName={project?.name} handlers={{
        jump,
        edit: editable ? { lifespan: () => setModal({ kind: 'planning' }), service: () => setModal({ kind: 'service' }), oilTarget: () => setModal({ kind: 'oil-target' }), oilRecord: () => setModal({ kind: 'oil-record' }), tire: () => setModal({ kind: 'tire', mode: { kind: 'edit', tire: row.tires! } }), tread: () => setModal({ kind: 'tread', tire: row.tires! }), inspection: () => setModal({ kind: 'inspection' }) } : undefined,
      }} />
      {!editable && <p className="mt-3 text-xs text-muted">View only.</p>}
      <nav aria-label="Dashboard sections" className="mt-4 flex gap-5 overflow-x-auto pb-1 text-[13px]">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); jump(id) }} className="shrink-0 text-muted transition-colors hover:text-ink">{label}</a>)}
      </nav>

      {/* 1 · Overview and specifications */}
      <Section title="Vehicle overview" className="mt-8 scroll-mt-4" actions={editable && <Btn onClick={() => setModal({ kind: 'edit' })}>Edit</Btn>}>
        <span id="overview" className="relative -top-4 block" />
        <dl className="border-t border-line">
          <Row label="Unit number">{vehicle.unitNumber}</Row>
          <Row label="Year / make / model">{vehicleTitle(vehicle)}</Row>
          <Row label="VIN">{vehicle.vin ?? NOT_RECORDED}</Row>
          <Row label="Licence plate">{vehicle.licencePlate ?? NOT_RECORDED}</Row>
          <Row label="Assigned project">{project ? <Link to={`/projects/${project.id}`} className="underline-offset-4 hover:underline">{project.name} · Job {project.jobNumber}</Link> : current ? registry.name(current.projectId) : <span className="text-muted">Unassigned</span>}</Row>
          <Row label="Assigned since">{current?.startDate ? formatDate(current.startDate) : NOT_RECORDED}</Row>
          <Row label="Estimated lifespan">{vehicle.expectedLifeKm !== null ? <>{km(vehicle.expectedLifeKm)}<span className="text-muted"> · planning estimate, not a condition rating</span></> : <span className="text-muted">Not set</span>}</Row>
          <Row label="Inspection interval">{vehicle.inspectionIntervalDays !== null ? `Every ${vehicle.inspectionIntervalDays} days` : <span className="text-muted">Weekly (default)</span>}</Row>
          <Row label="Notes">{vehicle.notes || NOT_RECORDED}</Row>
        </dl>
        {!projectId && canReassign(actor) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Select className="w-64" aria-label="Assign to project" value={selected} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Unassigned</option>
              {registry.projects.map((p) => <option key={p.id} value={p.id}>{p.name} · Job {p.jobNumber}</option>)}
            </Select>
            <Button disabled={unchanged} onClick={() => run(reassignVehicle(vehicle.id, selected || null, registry.projects.map((p) => p.id), today), () => setTarget(null))}>Save assignment</Button>
          </div>
        )}
        {projectId && <p className="mt-3 text-xs text-muted">Moving a vehicle to another project is done from the organization fleet.</p>}
      </Section>

      {/* 2 · Odometer */}
      <Section title="Odometer" description="Readings are kept as entered. A reading that contradicts the history is held for review and does not change the current mileage until accepted." actions={editable && <Btn onClick={() => setModal({ kind: 'odometer' })}>Record reading</Btn>}>
        <span id="odometer" className="relative -top-4 block" />
        {readings.length ? (
          <ul className="border-t border-line">
            {readings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 text-[13px]">
                <span><span className="tabular-nums">{km(r.reading)}</span><span className="ml-3 text-muted">{r.date ? formatDate(r.date) : 'Date not recorded'}{r.note && ` · ${r.note}`}</span>
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

      {/* 3 · Maintenance */}
      <Section title="Maintenance" description="A service threshold says when work is due; it is not a record that work was done. Only completed work appears under service history." actions={editable && <><Btn onClick={() => setModal({ kind: 'service' })}>{s.target ? 'Update next service' : 'Set next service'}</Btn><Btn onClick={() => setModal({ kind: 'oil-target' })}>{oilInd.schedule ? 'Update next oil change' : 'Set next oil change'}</Btn><Btn onClick={() => setModal({ kind: 'maintenance' })}>Record maintenance</Btn></>}>
        <span id="maintenance" className="relative -top-4 block" />
        <dl className="border-t border-line">
          <Row label="Next service at">{s.target ? <>{km(s.target.odometer)}{s.target.serviceType ? <span className="text-muted"> · {s.target.serviceType}</span> : <span className="text-muted"> · service type not specified</span>}</> : <span className="text-muted">Not set</span>}</Row>
          <Row label="Current odometer">{row.odometer ? km(row.odometer.reading) : NOT_RECORDED}</Row>
          <Row label="KM remaining">{s.kmRemaining === null ? <ServiceCell row={row} /> : <StatusBadge tone={serviceTone} label={s.overdue ? `Overdue by ${km(-s.kmRemaining)}` : s.state === 'due-soon' ? `${km(s.kmRemaining)} · due soon` : km(s.kmRemaining)} />}</Row>
          <Row label="Warning window">{s.target?.warnWithinKm ? `Due soon within ${km(s.target.warnWithinKm)}` : <span className="text-muted">Not recorded — only overdue is highlighted</span>}</Row>
          <Row label="Last completed service">{lastAny ? <>{lastAny.serviceType}{lastAny.odometer !== null && ` at ${km(lastAny.odometer)}`}<span className="text-muted"> · {formatDate(lastAny.date)}</span></> : NOT_RECORDED}</Row>
          <Row label="Next oil change at">{oilInd.schedule ? <>{km(oilInd.schedule.odometer)}{oilInd.remaining !== null && <span className="text-muted"> · {oilInd.remaining < 0 ? `overdue by ${km(-oilInd.remaining)}` : `${km(oilInd.remaining)} remaining`}</span>}{oilInd.consumedPercent !== null && <span className="text-muted"> · {pct1(oilInd.consumedPercent)}% of interval used{oilInd.intervalKm ? ` (${km(oilInd.intervalKm)} interval${oilInd.baselineCalculated ? `, start ${km(oilInd.intervalStart!)} calculated` : ''})` : ''}</span>}</> : <span className="text-muted">Unknown — no oil-change schedule recorded</span>}</Row>
          <Row label="Last oil change">{oil ? <>{oil.odometer !== null ? km(oil.odometer) : 'Odometer not recorded'}<span className="text-muted"> · {formatDate(oil.date)}</span></> : NOT_RECORDED}</Row>
        </dl>
        {targets.length > 1 && <p className="mt-2 text-xs text-muted">Earlier targets: {targets.slice(1).map((t) => `${km(t.odometer)}${t.setDate ? ` (set ${formatDate(t.setDate)})` : ''}`).join(', ')}</p>}
        <h3 className="t-label mb-2 mt-6">Service history</h3>
        {maintenance.length ? (
          <ul className="border-t border-line">
            {maintenance.map((m) => (
              <li key={m.id} className="border-b border-line py-3 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{m.serviceType}</span><span className="text-muted">{formatDate(m.date)}{m.odometer !== null && ` · ${km(m.odometer)}`}</span></div>
                {(m.description || m.notes) && <p className="mt-0.5 text-xs text-muted">{[m.description, m.notes].filter(Boolean).join(' · ')}</p>}
              </li>
            ))}
          </ul>
        ) : <Empty>No completed maintenance recorded.</Empty>}
      </Section>

      {/* 4 · Tires */}
      <Section title="Tires" description="Each vehicle keeps every tire set it has had, with one active set. Kilometres on the active set are the current odometer minus its installation odometer." actions={editable && (row.tires ? <Btn onClick={() => setModal({ kind: 'tire', mode: { kind: 'replace' } })}>Replace tires</Btn> : <Btn onClick={() => setModal({ kind: 'tire', mode: { kind: 'add' } })}>Add tire set</Btn>)}>
        <span id="tires" className="relative -top-4 block" />
        {tires.length ? tires.map((t) => {
          const run_ = tireKm(state, t)
          const tread = latestTread(t)
          return (
            <article key={t.id} className="border-t border-line py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-medium">{t.manufacturer} {t.model}</h3>
                <span className="flex items-center gap-3"><StatusBadge tone={t.active ? 'info' : 'muted'} label={t.active ? 'Active set' : 'Removed'} />
                  {editable && <button className={link} onClick={() => setModal({ kind: 'tire', mode: { kind: 'edit', tire: t } })}>Edit</button>}
                  {editable && t.active && <button className={link} onClick={() => setModal({ kind: 'tire-remove', tire: t })}>Remove</button>}</span>
              </div>
              <dl className="mt-2">
                <Row label="Installed as">{t.origin || NOT_RECORDED}</Row>
                <Row label="Tire size">{t.size ?? NOT_RECORDED}</Row>
                <Row label="Classification">{t.classes.length ? t.classes.map((c) => TIRE_CLASS_LABEL[c]).join(', ') : NOT_RECORDED}</Row>
                <Row label="Studded">{t.studded === 'yes' ? 'Yes' : t.studded === 'no' ? 'No' : <span className="text-muted">Unknown</span>}</Row>
                <Row label="Installed">{t.installDate ? formatDate(t.installDate) : 'Date not recorded'}{t.installOdometer !== null && <span className="text-muted"> · at {km(t.installOdometer)}</span>}</Row>
                {!t.active && <Row label="Removed">{t.removalDate ? formatDate(t.removalDate) : 'Date not recorded'}{t.removalOdometer !== null && <span className="text-muted"> · at {km(t.removalOdometer)}</span>}</Row>}
                <Row label={t.active ? 'Distance on set' : 'Distance run'}>{run_ === null ? NOT_RECORDED : km(run_)}</Row>
                <Row label="Condition">{t.condition === 'unknown' ? <span className="text-muted">{TIRE_CONDITION_LABEL.unknown}</span> : TIRE_CONDITION_LABEL[t.condition]}</Row>
                <Row label="Expected lifespan">{t.expectedLifeKm !== null ? km(t.expectedLifeKm) : <span className="text-muted">Not set — no remaining-life estimate is shown</span>}</Row>
                <Row label="Replace at tread">{t.replaceAtMm !== null ? `${t.replaceAtMm} mm` : <span className="text-muted">Not set</span>}</Row>
                <Row label="Tread depth">{tread ? <>{tread.depthMm} mm<span className="text-muted"> · {tread.date ? formatDate(tread.date) : 'date not recorded'}{tread.odometer !== null && ` · ${km(tread.odometer)}`}{tread.note && ` · ${tread.note}`}</span></> : NOT_RECORDED}</Row>
                {t.notes && <Row label="Notes">{t.notes}</Row>}
              </dl>
              {t.treads.length > 0 && (
                <div className="mt-3">
                  <h4 className="t-label mb-1">Tread measurements</h4>
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                    <ul className="text-[13px]">{t.treads.slice().reverse().map((m) => <li key={m.id} className="tabular-nums">{m.depthMm} mm<span className="text-muted"> · {m.date ? formatDate(m.date) : 'date not recorded'}{m.odometer !== null && ` · ${km(m.odometer)}`}{m.note && ` · ${m.note}`}</span></li>)}</ul>
                    <Sparkline label={`Tread depth over ${t.treads.length} measurements`} points={t.treads.filter((m) => m.odometer !== null).map((m) => ({ x: m.odometer!, y: m.depthMm }))} />
                  </div>
                </div>
              )}
              {editable && <button className={`${link} mt-2`} onClick={() => setModal({ kind: 'tread', tire: t })}>Record tread depth</button>}
            </article>
          )
        }) : <Empty>No tire sets recorded.</Empty>}
      </Section>

      {/* 5 · Modifications and accessories */}
      <Section title="Modifications and accessories" description="An accessory is one record for its whole life. Removing or transferring it adds to its history; nothing is deleted." actions={editable && <Btn onClick={() => setModal({ kind: 'accessory-add' })}>Add accessory</Btn>}>
        <span id="accessories" className="relative -top-4 block" />
        {accessories.length ? accessories.map(({ accessory: a, placement: p, status }) => (
          <article key={a.id} className="border-t border-line py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-medium">{a.name}<span className="ml-2 text-xs font-normal text-muted">{ACCESSORY_CATEGORY_LABEL[a.category]}</span></h3>
              <span className="flex items-center gap-3"><StatusBadge tone={status === 'installed' ? 'info' : 'muted'} label={status === 'installed' ? 'Installed' : status === 'removed' ? 'Removed' : 'Transferred'} />
                {editable && <button className={link} onClick={() => setModal({ kind: 'accessory-edit', accessory: a })}>Edit</button>}</span>
            </div>
            <dl className="mt-2">
              {a.description && <Row label="Description">{a.description}</Row>}
              <Row label="Specification">{a.specification || NOT_RECORDED}</Row>
              <Row label="Installed">{p.installDate ? formatDate(p.installDate) : 'Date not recorded'}{p.installOdometer !== null ? <span className="text-muted"> · at {km(p.installOdometer)}</span> : <span className="text-muted"> · mileage not recorded</span>}</Row>
              {p.endReason && <Row label={p.endReason === 'removed' ? 'Removed' : 'Transferred'}>{p.endDate ? formatDate(p.endDate) : 'Date not recorded'}{p.endOdometer !== null && <span className="text-muted"> · at {km(p.endOdometer)}</span>}{p.toVehicleId && <span className="text-muted"> · to {state.vehicles.find((v) => v.id === p.toVehicleId)?.unitNumber ?? 'another vehicle'}</span>}</Row>}
              <Row label="Cost">{a.cost === null ? NOT_RECORDED : money(a.cost)}</Row>
              <Row label="Warranty">{a.warranty || NOT_RECORDED}</Row>
              {(a.notes || p.note) && <Row label="Notes">{[a.notes, p.note].filter(Boolean).join(' · ')}</Row>}
            </dl>
            {editable && (
              <p className="mt-2 flex flex-wrap gap-4">
                <button className={link} onClick={() => setModal({ kind: 'move', accessory: a, mode: 'install-details' })}>Installation details</button>
                {status === 'installed' && <button className={link} onClick={() => setModal({ kind: 'move', accessory: a, mode: 'remove' })}>Remove</button>}
                {status === 'installed' && state.vehicles.length > 1 && <button className={link} onClick={() => setModal({ kind: 'move', accessory: a, mode: 'transfer' })}>Transfer to another vehicle</button>}
                {status !== 'installed' && !a.placements.some((x) => x.endReason === null) && <button className={link} onClick={() => setModal({ kind: 'move', accessory: a, mode: 'reinstall' })}>Install again</button>}
              </p>
            )}
          </article>
        )) : <Empty>No accessories recorded.</Empty>}
      </Section>

      {/* 6 · Inspections and defects */}
      <Section title="Weekly inspections and defects" description="A submission records that the inspection happened. It does not say the vehicle is sound: that is a reviewer's call, and defects stay outstanding until resolved." actions={editable && <Btn onClick={() => setModal({ kind: 'inspection' })}>Submit inspection</Btn>}>
        <span id="inspections" className="relative -top-4 block" />
        <dl className="mb-4 border-t border-line">
          <Row label="Condition">{row.condition === 'not-assessed' ? <span className="text-muted">Not assessed — no reviewed inspection has stated a condition</span> : <ConditionBadge condition={row.condition} />}</Row>
          <Row label="Outstanding defects">{row.defects}{row.unreviewedDefects > 0 && <span className="text-muted"> · {row.unreviewedDefects} on unreviewed inspections</span>}</Row>
        </dl>
        {demoCount > 0 && (
          <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {demoCount} demonstration record{demoCount === 1 ? '' : 's'} (Demo / Unverified) are listed for testing. They do not count toward inspection status, condition or defects.
            {editable && <button className={link} onClick={() => run(removeDemoInspections(vehicle.id))}>Remove demonstration records</button>}
          </p>
        )}
        {inspections.length ? (
          <ul className="border-t border-line">
            {inspections.map((i) => (
              <li key={i.id} className="border-b border-line py-3 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>{formatDate(i.date)}{i.submittedBy && <span className="text-muted"> · {i.submittedBy}</span>}{i.notes && <span className="text-muted"> · {i.notes}</span>}</span>
                  <span className="flex items-center gap-3">
                    {i.demo
                      ? <span className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs font-medium text-muted">Demo / Unverified</span>
                      : <StatusBadge tone={i.review === 'reviewed' ? 'ok' : 'info'} label={i.review === 'reviewed' ? `Reviewed${i.reviewedBy ? ` by ${i.reviewedBy}` : ''}` : 'Submitted, not reviewed'} />}
                    {!i.demo && i.review === 'submitted' && reviewer && <button className={link} onClick={() => setModal({ kind: 'review', inspection: i })}>Review</button>}
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
                {editable && !i.demo && <button className={`${link} mt-2`} onClick={() => { const text = window.prompt('Describe the defect'); if (text) run(addDefect(i.id, text)) }}>Add defect</button>}
              </li>
            ))}
          </ul>
        ) : <Empty>No inspections recorded. Condition stays “Not assessed” until a reviewed inspection states one.</Empty>}
      </Section>

      {/* 7 · History */}
      <Section title="Vehicle history and activity" description="Everything recorded for this vehicle, newest first. Events with no recorded date are listed last.">
        <span id="history" className="relative -top-4 block" />
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
      {modal?.kind === 'edit' && <VehicleEditModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'odometer' && <OdometerModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'inspection' && <InspectionModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'planning' && <PlanningModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'service' && <ServiceModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'oil-target' && <ServiceModal vehicle={vehicle} oil onClose={() => setModal(null)} />}
      {modal?.kind === 'oil-record' && <MaintenanceModal vehicle={vehicle} presetType="Oil change" onSaved={() => setModal({ kind: 'oil-target' })} onClose={() => setModal(null)} />}
      {modal?.kind === 'maintenance' && <MaintenanceModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'review' && <ReviewModal inspection={modal.inspection} onClose={() => setModal(null)} />}
      {modal?.kind === 'tire' && <TireModal vehicle={vehicle} mode={modal.mode} onClose={() => setModal(null)} />}
      {modal?.kind === 'tread' && <TreadModal tire={modal.tire} onClose={() => setModal(null)} />}
      {modal?.kind === 'tire-remove' && <RemoveTireModal tire={modal.tire} onClose={() => setModal(null)} />}
      {modal?.kind === 'accessory-add' && <AccessoryModal vehicle={vehicle} onClose={() => setModal(null)} />}
      {modal?.kind === 'accessory-edit' && <AccessoryModal vehicle={vehicle} accessory={modal.accessory} onClose={() => setModal(null)} />}
      {modal?.kind === 'move' && <AccessoryMoveModal vehicle={vehicle} accessory={modal.accessory} mode={modal.mode} onClose={() => setModal(null)} />}
    </>
  )
}
