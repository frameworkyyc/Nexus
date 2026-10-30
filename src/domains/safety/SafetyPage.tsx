import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { MetricSummary, StatusMark, type Status } from '@/components/viz'
import { canReview } from '@/domains/fleet/access'
import { resolveDefect } from '@/domains/fleet/commands'
import { fleetPaths } from '@/domains/fleet/paths'
import { inspectionIndicator } from '@/domains/fleet/indicators'
import { outstandingDefects, vehicleTitle } from '@/domains/fleet/selectors'
import { useFleet, useFleetActor, useFleetCommand } from '@/domains/fleet/store'
import { foundationPath } from '@/domains/construction/selectors'
import { useConstruction } from '@/domains/construction/store'
import { formatDate } from '@/lib/format'

const SEVERITY: Record<'minor' | 'major', { status: Status; label: string }> = { minor: { status: 'warn', label: 'Minor' }, major: { status: 'bad', label: 'Major' } }

/**
 * Safety: the inspections, defects and deficiencies that already exist in Fleet and Construction, gathered where they can be reached
 * with one thumb. It stores nothing of its own: every action here is the existing command (for example "Mark resolved"), and the
 * status shown for an inspection is the verified one (demonstration records never count).
 */
export function SafetyPage() {
  const { state: fleet, today } = useFleet()
  const actor = useFleetActor()
  const { run } = useFleetCommand()
  const { state: construction, idx } = useConstruction()
  const vehicles = fleet.vehicles.map((v) => ({ v, insp: inspectionIndicator(fleet, v.id, today), defects: outstandingDefects(fleet, v.id) }))
  const defects = vehicles.flatMap((x) => x.defects.map((d) => ({ ...d, vehicle: x.v })))
  const open = construction.deficiencies.filter((d) => d.status === 'open')
  const closed = construction.deficiencies.filter((d) => d.status === 'closed')
  if (fleet.vehicles.length === 0 && construction.deficiencies.length === 0) {
    return (
      <>
        <PageHeader title="Safety" description="Inspections, defects and deficiencies." />
        <EmptyState title="No safety records yet" description="Inspections and defects appear here once vehicles or equipment are added to Fleet and inspections are recorded. Nothing is shown until then." />
      </>
    )
  }
  const needInspection = vehicles.filter((x) => x.insp.cadence === 'overdue' || x.insp.cadence === 'due' || x.insp.cadence === 'unknown').length
  const projectId = construction.projects.find((p) => p.tracking === 'detailed')?.id ?? ''

  if (!fleet.vehicles.length && !construction.deficiencies.length) {
    return (<><PageHeader title="Safety" description="Inspections, defects and corrective actions." /><EmptyState title="Nothing recorded yet" description="Inspections, defects and deficiencies appear here once they are recorded." /></>)
  }
  return (
    <>
      <PageHeader title="Safety" description="Inspections, defects and corrective actions." />
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4" aria-label="Safety summary">
        <MetricSummary label="Open vehicle defects" value={String(defects.length)} status={defects.length ? 'warn' : 'ok'} statusLabel={defects.length ? 'Need corrective action' : 'None open'} />
        <MetricSummary label="Inspections to verify" value={String(needInspection)} status={needInspection ? 'warn' : 'ok'} statusLabel={needInspection ? 'Due, overdue or none recorded' : 'All current'} />
        <MetricSummary label="Open deficiencies" value={String(open.length)} status={open.length ? 'warn' : 'ok'} statusLabel={open.length ? 'Construction QC' : 'None open'} />
        <MetricSummary label="Closed deficiencies" value={String(closed.length)} />
      </div>

      <section className="mt-10" aria-label="Vehicle inspections">
        <h2 className="t-title">Vehicle inspections</h2>
        <p className="mt-0.5 text-[14px] text-muted">Verified inspections only. Demonstration records are ignored.</p>
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {vehicles.map(({ v, insp, defects: d }) => (
            <li key={v.id}>
              <Link to={`${fleetPaths.orgVehicle(v.id)}#inspections`} className="flex min-h-[72px] items-center justify-between gap-3 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_var(--nx-line)]">
                <span className="min-w-0"><span className="block text-[17px] font-medium">{v.unitNumber}</span><span className="block truncate text-[14px] text-muted">{vehicleTitle(v)}</span></span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-right"><StatusMark status={insp.status} label={insp.label.split(' · ')[0]} /><span className="text-[13px] text-muted">{d.length} open defect{d.length === 1 ? '' : 's'}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-label="Outstanding defects">
        <h2 className="t-title">Corrective actions</h2>
        <p className="mt-0.5 text-[14px] text-muted">Outstanding defects from verified inspections.</p>
        {defects.length ? (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {defects.map(({ inspection, defect, vehicle }) => (
              <li key={defect.id} className="py-3">
                <p className="text-[16px]">{defect.description}</p>
                <p className="mt-0.5 text-[13px] text-muted">{vehicle.unitNumber} · inspection {formatDate(inspection.date)} · {inspection.review === 'reviewed' ? 'reviewed' : 'not yet reviewed'}</p>
                {canReview(fleet, actor, vehicle.id) && <button type="button" onClick={() => run(resolveDefect(inspection.id, defect.id, '', today))} className="mt-2 inline-flex h-11 items-center rounded-nx border border-line px-4 text-[15px] font-medium hover:border-ink">Mark resolved</button>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 border-t border-line py-5 text-[15px] text-muted">No outstanding defects.</p>}
      </section>

      <section className="mt-10" aria-label="Construction deficiencies">
        <h2 className="t-title">Construction deficiencies</h2>
        <p className="mt-0.5 text-[14px] text-muted">Quality findings recorded against foundations and areas.</p>
        {open.length ? (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {open.map((d) => {
              const f = d.foundationId ? idx.foundation.get(d.foundationId) : undefined
              const to = f ? foundationPath(projectId, f) : `/projects/${projectId}/areas/${d.areaId}`
              return (
                <li key={d.id}>
                  <Link to={to} className="flex min-h-[64px] items-center justify-between gap-3 py-3">
                    <span className="min-w-0"><span className="block text-[16px]">{d.title}</span><span className="block truncate text-[13px] text-muted">{idx.area.get(d.areaId)?.name}{f ? ` · ${f.number}` : ''} · raised {formatDate(d.raised)}</span></span>
                    <StatusMark status={SEVERITY[d.severity].status} label={SEVERITY[d.severity].label} />
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : <p className="mt-4 border-t border-line py-5 text-[15px] text-muted">No open deficiencies.</p>}
        {closed.length > 0 && <details className="mt-3"><summary className="flex cursor-pointer items-center text-[15px] text-muted">Closed ({closed.length})</summary><ul className="divide-y divide-line">{closed.map((d) => <li key={d.id} className="py-2.5 text-[15px]">{d.title}<span className="block text-[13px] text-muted">Closed {formatDate(d.closed)}</span></li>)}</ul></details>}
      </section>
    </>
  )
}
