import { identity } from '@/app/identity'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Disclosure } from '@/components/ui/Disclosure'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { useIsServer } from '@/lib/dataSource'
import { formatShortDate, pct } from '@/lib/format'
import { FOUNDATION_COMPLETE_DEFINITION } from '../config'
import { deriveExceptions } from '../exceptions'
import { paths } from '../paths'
import { completionOf } from '../completionBasis'
import { computeStats, foundationActivities, foundationState, foundationsOf, tally, upcomingWork, type Index } from '../selectors'
import { useConstruction } from '../store'
import { ExceptionList, fraction, TextLink } from '../ui'
import type { Activity, Foundation } from '../types'
import { foundationTotals } from '../foundationQuantity'
import { PackageDashboard } from './PackageDashboard'
import { AddFoundationButton, ManageAreaButton } from './AddFoundation'
import { AreaHandover } from './HandoverPage'
import { BasisFigures, CompletionBasisSelector, percentText, useCompletionBasis } from './CompletionBasis'
import { FoundationRegister } from './FoundationRegister'
import { BoltTable, BulkTable } from './materials/Tables'
import { PurchaseOrders } from './materials/Purchasing'
import { MaterialTracker } from '../tracker/TrackerView'

export type AreaTab = 'overview' | 'materials' | 'construction' | 'survey' | 'qaqc'
/** The same five tabs, in this order, on every area of every project. Foundations and Handover are sections of Overview, not tabs. */
export const AREA_TABS: { id: AreaTab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'materials', label: 'Materials' }, { id: 'construction', label: 'Construction' },
  { id: 'survey', label: 'Survey' }, { id: 'qaqc', label: 'QA/QC' },
]
/** Tab names from before the five-tab layout: the old Foundations and Handover tabs now live in Overview; Survey & QA/QC became two tabs. */
const LEGACY_TAB: Record<string, AreaTab> = { register: 'overview', handover: 'overview', quality: 'survey' }

/** The tab a ?tab= value means, and whether the value was an old name (so the address can be tidied). */
export function resolveAreaTab(value: string | null): { tab: AreaTab; legacy: boolean } {
  if (value && value in LEGACY_TAB) return { tab: LEGACY_TAB[value], legacy: true }
  const known = AREA_TABS.find((t) => t.id === value)
  return { tab: known?.id ?? 'overview', legacy: !!value && !known }
}

/** Level 3 of 4: an area's own dashboard, with detail one tab away. */
export function AreaPage() {
  const { projectId = '', areaId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { idx } = useConstruction()
  const area = idx.area.get(areaId)
  if (!area) return <EmptyState title="Area not found" />
  const { tab, legacy } = resolveAreaTab(params.get('tab'))
  // Old bookmarks (?tab=register, ?tab=quality, ?tab=handover) land on the right tab, and the address is tidied.
  if (legacy) return <Navigate to={paths.area(projectId, areaId, tab === 'overview' ? undefined : tab)} replace />
  const foundations = foundationsOf(idx, areaId)
  return (
    <>
      <PageHeader title={area.name} description={[area.identifier, `${foundations.length} foundation name${foundations.length === 1 ? '' : 's'} · ${foundationTotals(foundations, foundations.flatMap((f) => idx.plinthsByFoundation.get(f.id) ?? [])).physical.toLocaleString('en-CA')} foundations`, area.archived ? 'Archived' : '', area.description].filter(Boolean).join(' · ')} actions={<><ManageAreaButton areaId={areaId} /><AddFoundationButton projectId={projectId} areaId={areaId} /></>} />
      <Tabs<AreaTab> items={AREA_TABS} value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t })} />
      <div className="pt-6">
        {tab === 'overview' && (foundations.length === 0 ? <EmptyState title="No foundations in this area yet" description="Add the foundations to start tracking construction, survey and QA/QC here. Materials can already be added to the area." action={<AddFoundationButton projectId={projectId} areaId={areaId} />} /> : <Overview projectId={projectId} areaId={areaId} />)}
        {tab === 'construction' && <Construction projectId={projectId} areaId={areaId} />}
        {tab === 'materials' && <AreaMaterials projectId={projectId} areaId={areaId} />}
        {tab === 'survey' && <Quality projectId={projectId} areaId={areaId} kind="survey" />}
        {tab === 'qaqc' && <Quality projectId={projectId} areaId={areaId} kind="qaqc" />}
      </div>
    </>
  )
}

function Overview({ projectId, areaId }: { projectId: string; areaId: string }) {
  const { idx, today } = useConstruction()
  const server = useIsServer()
  const foundations = foundationsOf(idx, areaId)
  const stats = computeStats(idx, foundations)
  const [basis] = useCompletionBasis()
  const completion = completionOf(idx, foundations, basis)
  const total = stats.foundations
  const items = deriveExceptions(idx, today, projectId).filter((e) => e.areaId === areaId)
  const segments = [
    { key: 'complete', label: 'Complete', n: stats.constructed, cls: 'bg-ink' },
    { key: 'progress', label: 'In progress', n: stats.inProgress, cls: 'bg-neutral-400' },
    { key: 'none', label: 'Not started', n: stats.notStarted, cls: 'bg-line' },
  ]
  return (
    <>
      <PackageDashboard idx={idx} projectId={projectId} areaId={areaId} />
      <CompletionBasisSelector className="mb-4" />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-6 lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-line [&>div]:lg:px-6 [&>div:first-child]:lg:pl-0">
        <div>
          <Stat label="Construction progress" value={<>{percentText(completion)}{completion.percent !== null && <span className="text-2xl text-muted">%</span>}</>} />
          <div className="mt-3 h-px bg-line lg:mr-2" role="progressbar" aria-label="Construction progress" aria-valuenow={completion.percent ?? undefined} aria-valuemin={0} aria-valuemax={100}><div className="-mt-px h-0.5 bg-ink" style={{ width: `${completion.percent ?? 0}%` }} /></div>
          <BasisFigures result={completion} className="mt-2 lg:mr-2" />
        </div>
        <Stat label="Foundations complete" value={<>{stats.constructed}<span className="text-2xl text-muted"> / {total}</span></>} sub={`${pct(stats.constructed, total)}% fully built`} />
        <Stat label="In progress" value={stats.inProgress} />
        <Stat label="Not started" value={stats.notStarted} />
      </dl>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">Construction progress measures partial work across every footing and plinth. Foundations complete counts only those fully built, so the two figures differ.</p>

      <Section title="Foundations" description={`${total} in total`}>
        <div className="flex h-3 w-full gap-px bg-surface" role="img" aria-label={`${stats.constructed} complete, ${stats.inProgress} in progress, ${stats.notStarted} not started`}>
          {segments.filter((s) => s.n > 0).map((s) => <div key={s.key} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />)}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          {segments.map((s) => <li key={s.key} className="flex items-center gap-2"><span className={`h-2 w-2 ${s.cls}`} />{s.label} {s.n}</li>)}
          {stats.closedOut > 0 && <li>{stats.closedOut} closed out (survey and QA/QC complete)</li>}
        </ul>
        <FoundationTiles projectId={projectId} foundations={foundations} />
        <div className="mt-8"><FoundationRegister projectId={projectId} areaId={areaId} /></div>
      </Section>

      <Section title="Needs attention" actions={<Link to={`${paths.issues(projectId)}?area=${areaId}`} className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">All issues</Link>}>
        <ExceptionList items={items} showArea={false} empty="Nothing in this area needs attention." />
      </Section>

      {!server && <Section title="Handover"><AreaHandover areaId={areaId} /></Section>}

      <div className="mt-12 border-t border-line">
        <Disclosure summary={<span className="text-xs text-muted">What counts as a complete foundation</span>}>
          <p className="max-w-2xl text-xs leading-relaxed text-muted">{FOUNDATION_COMPLETE_DEFINITION}</p>
        </Disclosure>
      </div>
    </>
  )
}

/** One clickable tile per foundation: filled when complete, with a thin progress bar otherwise. */
function FoundationTiles({ projectId, foundations }: { projectId: string; foundations: Foundation[] }) {
  const { idx } = useConstruction()
  return (
    <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      {foundations.map((f) => {
        const st = foundationState(idx, f)
        const progress = computeStats(idx, [f]).progress
        const done = st.state === 'constructed' || st.state === 'closed-out'
        return (
          <li key={f.id}>
            <Link to={paths.foundation(projectId, f)} className={`block border p-3 transition-colors ${done ? 'border-ink bg-ink text-white hover:bg-neutral-800' : 'border-line bg-surface hover:border-ink'}`}>
              <span className="flex items-center justify-between text-[13px] font-medium">
                <span className="flex items-center gap-1.5">{f.number}{st.blocked && <span className="h-1.5 w-1.5 rounded-full bg-bad" title="Blocked" />}</span>
                <span className={`tabular-nums ${done ? 'text-white/70' : 'text-muted'}`}>{progress}%</span>
              </span>
              <span className={`mt-0.5 block truncate text-xs ${done ? 'text-white/60' : 'text-muted'}`}>{f.description}</span>
              <span className={`mt-3 block h-0.5 ${done ? 'bg-white/30' : 'bg-line'}`}><span className={`block h-full ${done ? 'bg-white' : 'bg-ink'}`} style={{ width: `${progress}%` }} /></span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function Construction({ projectId, areaId }: { projectId: string; areaId: string }) {
  const { idx, today } = useConstruction()
  const foundations = foundationsOf(idx, areaId)
  const acts = foundations.flatMap((f) => foundationActivities(idx, f))
  const rows = [
    ['Footings formed', acts.filter((a) => a.scope === 'footing' && a.key === 'formed')],
    ['Footings poured', acts.filter((a) => a.scope === 'footing' && a.key === 'poured')],
    ['Plinths formed', acts.filter((a) => a.scope === 'plinth' && a.key === 'formed')],
    ['Plinths poured', acts.filter((a) => a.scope === 'plinth' && a.key === 'poured')],
    ['Rebar built', acts.filter((a) => a.key === 'rebarBuilt')],
    ['Rebar installed', acts.filter((a) => a.key === 'rebarInstalled')],
  ] as [string, Activity[]][]
  const upcoming = upcomingWork(idx, today, 14, areaId)
  return (
    <>
      <Section title="Activity progress" description="Each activity is shown as complete over total for the area's footings and plinths." className="mt-0">
        <ul className="border-t border-line">
          {rows.map(([label, list]) => { const t = tally(idx, list); return (
            <li key={label} className="flex items-center justify-between gap-4 border-b border-line py-3 text-[13px]">
              <span className="w-40">{label}</span>
              <span className="w-16 tabular-nums text-muted">{fraction(t)}</span>
              <ProgressBar value={pct(t.done, t.total)} width="w-32 sm:w-64" />
            </li>
          ) })}
        </ul>
      </Section>
      <Section title="Upcoming work" description="Planned in the next 14 days.">
        {upcoming.length ? (
          <ul className="border-t border-line">
            {upcoming.slice(0, 10).map((u) => (
              <li key={u.activity.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[13px]">
                <TextLink to={paths.foundation(projectId, u.foundation, u.activity.plinthId ?? undefined)}>{u.title}</TextLink>
                <span className="shrink-0 text-xs text-muted">{formatShortDate(u.activity.plannedDate)}</span>
              </li>
            ))}
            {upcoming.length > 10 && <li className="py-3 text-xs text-muted">+ {upcoming.length - 10} more</li>}
          </ul>
        ) : <p className="border-t border-line py-6 text-[13px] text-muted">No work planned in the next 14 days.</p>}
      </Section>
    </>
  )
}

function AreaMaterials({ projectId, areaId }: { projectId: string; areaId: string }) {
  const { state, idx } = useConstruction()
  if (useIsServer()) return <MaterialTracker areaId={areaId} />
  const plinths = state.plinths.filter((p) => idx.foundation.get(p.foundationId)!.areaId === areaId)
  const types = state.anchorageTypes.map((t) => ({ t, used: plinths.filter((p) => p.anchorageTypeId === t.id) })).filter((x) => x.used.length)
  return (
    <>
      <MaterialTracker areaId={areaId} />
      <Section title="Anchorage types in use (demonstration)" description="Defined once in the library; referenced by plinths." className="mt-0">
        <ul className="border-t border-line text-[13px]">
          {types.map(({ t, used }) => (
            <li key={t.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
              <span className="font-medium">{t.code}</span>
              <span className="text-muted">{used.length} plinth{used.length === 1 ? '' : 's'} · {[...new Set(used.map((p) => idx.foundation.get(p.foundationId)!.number))].join(', ')}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs"><TextLink to={paths.anchorage(projectId)}>Open anchorage library</TextLink></p>
      </Section>
      <Section title="Demonstration procurement data" description={`Fictional bolt, hardware and purchase-order records, kept apart from the ${identity.trackerName} tracker above and not included in its totals.`}>
        <Disclosure summary={<span className="text-xs text-muted">Show demonstration data</span>}>
          <Section title="Anchor bolts" className="mt-0"><BoltTable projectId={projectId} areaId={areaId} /></Section>
          <Section title="Bulk hardware"><BulkTable areaId={areaId} /></Section>
          <Section title="Procurement"><PurchaseOrders areaId={areaId} /></Section>
        </Disclosure>
      </Section>
    </>
  )
}

const SURVEY_COLUMNS: { key: string; label: string }[] = [
  { key: 'layout', label: 'Layout' }, { key: 'preSurvey', label: 'Pre-pour survey' }, { key: 'postSurvey', label: 'As-built survey' },
]
const QAQC_COLUMNS: { key: string; label: string }[] = [
  { key: 'preInspection', label: 'Pre-pour inspection (CM03)' }, { key: 'postInspection', label: 'Post-pour inspection (CM04)' },
]
const NOTE = {
  survey: 'Survey records whether each check is complete. A completed survey does not mean an inspection is approved: that is on the QA/QC tab.',
  qaqc: 'QA/QC records inspections and their approval. Each cell counts the footing and every plinth for that inspection. Survey checks are on the Survey tab.',
  both: 'Survey and QA/QC are separate processes: a completed survey does not mean an inspection is approved. Each cell counts the footing and every plinth for that activity.',
}

/**
 * The survey and inspection records of an area's foundations. `survey` and `qaqc` each show their own discipline (the Area tabs); `both`
 * (the default) is the combined table Project Management uses. Same records and cells in every case.
 */
export function Quality({ projectId, areaId, kind = 'both' }: { projectId: string; areaId: string; kind?: 'survey' | 'qaqc' | 'both' }) {
  const { idx } = useConstruction()
  const rows = foundationsOf(idx, areaId)
  const survey = kind !== 'qaqc' ? SURVEY_COLUMNS : []
  const qaqc = kind !== 'survey' ? QAQC_COLUMNS : []
  const columns = [...survey, ...qaqc]
  if (rows.length === 0) return <EmptyState title="No foundations in this area yet" description="Add foundations on the Overview tab to record this work." />
  return (
    <>
      <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">{NOTE[kind]}</p>
      <div className="overflow-x-auto">
        <table className="card-table w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line"><th className="t-label py-3 pr-4 font-medium">Foundation</th>
              {columns.map((c) => <th key={c.key} className={`t-label py-3 pr-4 font-medium ${kind === 'both' && c.key === 'preInspection' ? 'border-l border-line pl-4' : ''}`}>{c.label}</th>)}
            </tr>
            {kind === 'both' && <tr className="border-b border-line text-xs text-muted"><td /><td colSpan={3} className="pb-1">Survey</td><td colSpan={2} className="border-l border-line pb-1 pl-4">QA/QC</td></tr>}
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-b border-line">
                <td className="py-3 pr-4 text-[13px] font-medium"><TextLink to={paths.foundation(projectId, f)}>{f.number}</TextLink></td>
                {columns.map((c) => <td key={c.key} className={`py-3 pr-4 ${kind === 'both' && c.key === 'preInspection' ? 'border-l border-line pl-4' : ''}`}><QualityCell idx={idx} f={f} k={c.key} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function QualityCell({ idx, f, k }: { idx: Index; f: Foundation; k: string }) {
  const acts = foundationActivities(idx, f).filter((a) => a.key === k)
  const t = tally(idx, acts)
  const tone: Tone = t.blocked ? 'bad' : t.done === t.total ? 'ok' : t.pending ? 'warn' : t.done > 0 || acts.some((a) => a.status === 'in-progress') ? 'info' : 'muted'
  return <StatusBadge tone={tone} label={`${t.done}/${t.total}${t.pending ? ' · pending' : ''}`} />
}

export function RegisterPage() {
  const { projectId = '' } = useParams()
  return (
    <>
      <PageHeader title="Foundations" description="Every foundation and plinth in the project. Search, filter, sort, and expand a foundation to see its plinths." actions={<AddFoundationButton projectId={projectId} />} />
      <FoundationRegister projectId={projectId} />
    </>
  )
}
