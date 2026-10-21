import { Link, useNavigate, useParams } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { Section } from '@/components/ui/Section'
import { Stat, StatRow } from '@/components/ui/Stat'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatShortDate } from '@/lib/format'
import { paths } from '../paths'
import {
  activitiesWhere, boltRows, bulkRows, computeStats, crewsOnSite, deriveIssues, evaluateHandover, foundationsOf, percent, poFulfilment, specLabel, upcomingWork,
  type BoltRow, type HandoverEvaluation, type Stats,
} from '../selectors'
import { useConstruction } from '../store'
import { fraction, IssueList, TextLink } from '../ui'
import type { Area } from '../types'

interface AreaRow {
  area: Area
  stats: Stats
  handover: HandoverEvaluation
}

export function ProjectDashboard() {
  const { projectId = '' } = useParams()
  const { state, idx, today } = useConstruction()
  const navigate = useNavigate()
  const project = state.projects.find((p) => p.id === projectId)!
  const stats = computeStats(idx, state.foundations)
  const issues = deriveIssues(idx, today, projectId)
  const upcoming = upcomingWork(idx, today, 14)
  const rows: AreaRow[] = state.areas.map((area) => ({ area, stats: computeStats(idx, foundationsOf(idx, area.id)), handover: evaluateHandover(idx, area.id) }))
  const onSite = crewsOnSite(idx, today)
  const pendingInspections = activitiesWhere(idx, (_a, def, s) => def.category === 'qaqc' && s === 'pending-review')
  const surveyDue = activitiesWhere(idx, (a, def, s) => def.category === 'survey' && s !== 'complete' && s !== 'blocked' && (s === 'in-progress' || isReadyCached(a)))
  function isReadyCached(a: (typeof state.activities)[number]) {
    return issues.some((i) => i.id === `survey:${a.id}`)
  }
  const shortBolts = boltRows(idx).filter((r) => r.toOrder > 0 || r.received < r.required)
  const lateDeliveries = state.purchaseOrders.filter((po) => po.status === 'issued' && po.expectedDate && po.expectedDate < today && poFulfilment(idx, po).state !== 'complete')
  const toOrderBulk = bulkRows(idx).filter((r) => r.outstanding > 0)
  const highCount = issues.filter((i) => i.severity === 'high').length

  const areaColumns: Column<AreaRow>[] = [
    { key: 'area', header: 'Area', render: (r) => <span className="font-medium">{r.area.name}</span> },
    { key: 'f', header: 'Constructed', render: (r) => <span className="tabular-nums">{r.stats.constructed} / {r.stats.foundations}</span> },
    { key: 'c', header: 'Construction', render: (r) => <ProgressBar value={percent(r.stats.construction)} width="w-20 sm:w-28" /> },
    { key: 'p', header: 'Footings / plinths poured', hideOnMobile: true, render: (r) => <span className="tabular-nums text-muted">{fraction(r.stats.footingPoured)} · {fraction(r.stats.plinthPoured)}</span> },
    { key: 's', header: 'Survey', hideOnMobile: true, render: (r) => <span className="tabular-nums text-muted">{fraction(r.stats.survey)}</span> },
    { key: 'q', header: 'QA/QC', hideOnMobile: true, render: (r) => <span className="tabular-nums text-muted">{fraction(r.stats.qaqc)}</span> },
    { key: 'm', header: 'Bolts ready', hideOnMobile: true, render: (r) => <span className="tabular-nums text-muted">{r.stats.materialsReady.ready}/{r.stats.materialsReady.total}</span> },
    { key: 'h', header: 'Handover', render: (r) => <span className="text-muted">{r.handover.label}</span> },
  ]

  const boltColumns: Column<BoltRow>[] = [
    { key: 's', header: 'Anchor bolt', render: (r) => <span className="font-medium">{specLabel(r.spec)} <span className="font-normal text-muted">{r.spec.id}</span></span> },
    { key: 'r', header: 'Required', render: (r) => r.required },
    { key: 'rc', header: 'Received', render: (r) => r.received },
    { key: 'o', header: 'To order', render: (r) => (r.toOrder > 0 ? <StatusBadge tone="warn" label={String(r.toOrder)} /> : <span className="text-muted">0</span>) },
  ]

  return (
    <>
      <PageHeader title={project.name} description={`Project dashboard · Job ${project.jobNumber} · ${project.scope}`} />

      <StatRow>
        <Stat label="Physical progress" value={`${percent(stats.construction)}%`} sub={`${stats.construction.done} of ${stats.construction.total} construction activities complete (forming, rebar, pours; footings and plinths)`} />
        <Stat label="Foundations constructed" value={`${stats.constructed} / ${stats.foundations}`} sub={`${stats.closedOut} fully closed out (survey and QA/QC also complete)`} />
        <Stat label="Footings poured" value={`${stats.footingPoured.done} / ${stats.footingPoured.total}`} sub={`${stats.footingFormed.done} formed`} />
        <Stat label="Plinths poured" value={`${stats.plinthPoured.done} / ${stats.plinthPoured.total}`} sub={`${stats.plinthFormed.done} formed`} />
        <Stat label="Rebar installed" value={`${stats.rebarInstalled.done} / ${stats.rebarInstalled.total}`} sub={`${stats.rebarBuilt.done} of ${stats.rebarBuilt.total} built (footings and plinths)`} />
      </StatRow>

      <Section title="Readiness" description="Tracked separately from physical progress: a poured foundation is not closed out until survey and inspection are complete.">
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat label="Survey complete" value={`${percent(stats.survey)}%`} sub={`${stats.survey.done} of ${stats.survey.total} survey activities`} />
          <Stat label="QA/QC approved" value={`${percent(stats.qaqc)}%`} sub={`${stats.qaqc.done} of ${stats.qaqc.total} inspections · ${stats.qaqc.pending} pending review`} />
          <Stat label="Plinths with bolts ready" value={`${stats.materialsReady.ready} / ${stats.materialsReady.total}`} sub="Allocated, sorted and marked ready for installation" />
          <Stat label="Open deficiencies" value={state.deficiencies.filter((d) => d.status === 'open').length} sub={`${highCount} high-priority issues overall`} />
        </dl>
      </Section>

      <Section title="Progress by area" description="Select an area to open its workspace.">
        <DataTable columns={areaColumns} rows={rows} getKey={(r) => r.area.id} onRowClick={(r) => navigate(paths.area(projectId, r.area.id))} />
      </Section>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Needs attention" description={`${issues.length} open items, highest priority first.`}>
          <IssueList issues={issues} limit={8} />
        </Section>
        <Section title="Upcoming work" description="Planned for the next 14 days.">
          {upcoming.length ? (
            <ul>
              {upcoming.slice(0, 8).map((u) => (
                <li key={u.activity.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[13px]">
                  <TextLink to={paths.foundation(projectId, u.foundation, u.activity.plinthId ?? undefined)}>{u.title}</TextLink>
                  <span className="shrink-0 text-xs text-muted">{formatShortDate(u.activity.plannedDate)}</span>
                </li>
              ))}
              {upcoming.length > 8 && <li className="py-3 text-xs text-muted">+ {upcoming.length - 8} more</li>}
            </ul>
          ) : (
            <p className="py-6 text-[13px] text-muted">No planned work in the next 14 days.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Outstanding material requirements" description="Anchor bolts consolidated by specification, project-wide." actions={<Link to={paths.materials(projectId)} className="text-[13px] text-muted hover:text-ink hover:underline underline-offset-4">Open materials</Link>}>
          <DataTable columns={boltColumns} rows={shortBolts} getKey={(r) => r.spec.id} />
          {toOrderBulk.length > 0 && <p className="mt-3 text-xs text-muted">{toOrderBulk.length} bulk nut and washer lines still have received quantity below requirement.</p>}
        </Section>
        <Section title="Procurement delays">
          {lateDeliveries.length || issues.some((i) => i.category === 'fabrication') ? (
            <ul>
              {lateDeliveries.map((po) => {
                const f = poFulfilment(idx, po)
                return (
                  <li key={po.id} className="border-b border-line py-3 text-[13px]">
                    <TextLink to={paths.materials(projectId)}>{po.number}</TextLink> <span className="text-muted">· {idx.supplier.get(po.supplierId)?.name}</span>
                    <span className="block text-xs text-muted">Expected {formatShortDate(po.expectedDate)} · {f.received} of {f.ordered} received</span>
                  </li>
                )
              })}
              {issues.filter((i) => i.category === 'fabrication').map((i) => (
                <li key={i.id} className="border-b border-line py-3 text-[13px]">
                  <TextLink to={i.to}>{i.title}</TextLink>
                  <span className="block truncate text-xs text-muted">{i.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-[13px] text-muted">No late deliveries or fabrication delays.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Pending inspections" description="Inspections awaiting a QA/QC response.">
          <ActivityList items={pendingInspections} projectId={projectId} empty="No inspections pending." />
        </Section>
        <Section title="Outstanding survey" description="Survey activities that are in progress or whose prerequisite work is complete.">
          <ActivityList items={surveyDue} projectId={projectId} empty="No survey activities outstanding." />
        </Section>
      </div>

      <Section title="Areas approaching handover" description="Handover requirements are a configurable placeholder. Construction completion is not acceptance.">
        <ul>
          {[...rows].sort((a, b) => percent(b.stats.construction) - percent(a.stats.construction)).slice(0, 3).map((r) => (
            <li key={r.area.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3 text-[13px]">
              <TextLink to={paths.area(projectId, r.area.id, 'handover')}>{r.area.name}</TextLink>
              <span className="text-muted">
                {r.stats.constructed} of {r.stats.foundations} foundations constructed · {r.handover.items.filter((i) => i.met).length} of {r.handover.items.length} requirements met · {r.handover.label}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <p className="mt-12 text-xs text-muted">
        On site today: {onSite.crews.map((c) => c.name).join(' and ')} · Superintendent{onSite.superintendents.length === 1 ? '' : 's'}: {onSite.superintendents.map((s) => s.name).join(', ')} · 14 days on / 7 days off rotation (demonstration).
      </p>

      <details className="mt-6 text-xs text-muted">
        <summary className="cursor-pointer hover:text-ink">How progress is calculated</summary>
        <ul className="mt-2 max-w-2xl list-disc space-y-1 pl-5 leading-relaxed">
          <li>Physical progress = completed construction activities ÷ all construction activities: footing and plinth forming, pouring, rebar built and rebar installed. Every activity counts equally; there is no weighting by effort or cost.</li>
          <li>Survey and QA/QC are separate measures. A completed survey does not imply an approved inspection, and neither changes physical progress.</li>
          <li>Constructed = every construction activity for the foundation and all its plinths is complete. Closed out = constructed plus all survey complete and all inspections approved.</li>
          <li>Anchor bolt, nut, washer and template statuses are derived from allocation and fabrication records, not entered by hand.</li>
          <li>All records are fictional demonstration data.</li>
        </ul>
      </details>
    </>
  )
}

function ActivityList({ items, projectId, empty }: { items: ReturnType<typeof activitiesWhere>; projectId: string; empty: string }) {
  if (!items.length) return <p className="py-6 text-[13px] text-muted">{empty}</p>
  return (
    <ul>
      {items.slice(0, 8).map((u) => (
        <li key={u.activity.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[13px]">
          <TextLink to={paths.foundation(projectId, u.foundation, u.activity.plinthId ?? undefined)}>{u.title}</TextLink>
          <span className="shrink-0 text-xs text-muted">{u.activity.plannedDate ? `planned ${formatShortDate(u.activity.plannedDate)}` : ''}</span>
        </li>
      ))}
      {items.length > 8 && <li className="py-3 text-xs text-muted">+ {items.length - 8} more</li>}
    </ul>
  )
}
