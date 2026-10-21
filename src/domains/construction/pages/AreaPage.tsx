import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { Section } from '@/components/ui/Section'
import { Stat, StatRow } from '@/components/ui/Stat'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { paths } from '../paths'
import { computeStats, deriveIssues, evaluateHandover, foundationActivities, foundationsOf, percent, plinthBoltStage, tally, type Index } from '../selectors'
import { useConstruction } from '../store'
import { fraction, IssueList, phaseTone, TextLink } from '../ui'
import type { Activity, Foundation } from '../types'
import { AreaHandover } from './HandoverPage'
import { FoundationRegister } from './FoundationRegister'
import { BoltTable, BulkTable } from './materials/Tables'

type Tab = 'overview' | 'register' | 'materials' | 'quality' | 'handover'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'register', label: 'Foundation register' }, { id: 'materials', label: 'Materials' },
  { id: 'quality', label: 'Survey & QA/QC' }, { id: 'handover', label: 'Handover' },
]

export function AreaPage() {
  const { projectId = '', areaId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { idx } = useConstruction()
  const area = idx.area.get(areaId)
  if (!area) return <EmptyState title="Area not found" />
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab
  const foundations = foundationsOf(idx, areaId)
  return (
    <>
      <PageHeader title={area.name} description={`${foundations.length} foundations · ${foundations.reduce((s, f) => s + (idx.plinthsByFoundation.get(f.id)?.length ?? 0), 0)} plinths · tracked and handed over independently`} />
      <Tabs<Tab> items={TABS} value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t })} />
      <div className="pt-6">
        {tab === 'overview' && <Overview projectId={projectId} areaId={areaId} />}
        {tab === 'register' && <FoundationRegister projectId={projectId} areaId={areaId} />}
        {tab === 'materials' && (
          <>
            <Section title="Anchor bolts" description="Requirements and allocation for this area. Ordering and stock are shared across the project." className="mt-0"><BoltTable projectId={projectId} areaId={areaId} /></Section>
            <Section title="Bulk hardware" description="Nuts and washers for this area."><BulkTable areaId={areaId} /></Section>
            <p className="mt-6 text-xs text-muted"><Link className="underline underline-offset-4 hover:text-ink" to={paths.materials(projectId)}>Project materials</Link> shows purchase orders and deliveries.</p>
          </>
        )}
        {tab === 'quality' && <Quality projectId={projectId} areaId={areaId} />}
        {tab === 'handover' && <AreaHandover areaId={areaId} />}
      </div>
    </>
  )
}

function Overview({ projectId, areaId }: { projectId: string; areaId: string }) {
  const { state, idx, today } = useConstruction()
  const foundations = foundationsOf(idx, areaId)
  const stats = computeStats(idx, foundations)
  const ev = evaluateHandover(idx, areaId)
  const issues = deriveIssues(idx, today, projectId).filter((i) => i.areaId === areaId)
  const plinths = state.plinths.filter((p) => idx.foundation.get(p.foundationId)!.areaId === areaId)
  const types = state.anchorageTypes.map((t) => ({ t, used: plinths.filter((p) => p.anchorageTypeId === t.id) })).filter((x) => x.used.length)
  const acts = foundations.flatMap((f) => foundationActivities(idx, f))
  const progress = [
    ['Footings formed', acts.filter((a) => a.scope === 'footing' && a.key === 'formed')],
    ['Footings poured', acts.filter((a) => a.scope === 'footing' && a.key === 'poured')],
    ['Plinths formed', acts.filter((a) => a.scope === 'plinth' && a.key === 'formed')],
    ['Plinths poured', acts.filter((a) => a.scope === 'plinth' && a.key === 'poured')],
    ['Rebar built', acts.filter((a) => a.key === 'rebarBuilt')],
    ['Rebar installed', acts.filter((a) => a.key === 'rebarInstalled')],
  ] as [string, Activity[]][]
  const bolts = plinths.filter((p) => plinthBoltStage(idx, p) === 'ready').length
  return (
    <>
      <StatRow>
        <Stat label="Construction progress" value={`${stats.progress}%`} sub={`${stats.elementsPoured.done} of ${stats.elementsPoured.total} footings and plinths poured`} />
        <Stat label="Foundations constructed" value={`${stats.constructed} / ${stats.foundations}`} sub={`${stats.closedOut} fully closed out`} />
        <Stat label="Survey complete" value={`${percent(stats.survey)}%`} sub={`${fraction(stats.survey)} survey activities`} />
        <Stat label="QA/QC approved" value={`${percent(stats.qaqc)}%`} sub={`${fraction(stats.qaqc)} inspections · ${stats.qaqc.pending} pending`} />
        <Stat label="Plinths with bolts ready" value={`${bolts} / ${plinths.length}`} sub="Allocated and marked ready" />
      </StatRow>

      <Section title="Construction progress" description="Each activity counts equally. Footing and plinth activities are tracked separately.">
        <ul>
          {progress.map(([label, list]) => { const t = tally(idx, list); return (
            <li key={label} className="flex items-center justify-between gap-4 border-b border-line py-3 text-[13px]">
              <span className="w-40">{label}</span>
              <span className="w-16 tabular-nums text-muted">{fraction(t)}</span>
              <ProgressBar value={percent(t)} width="w-32 sm:w-64" />
            </li>
          ) })}
        </ul>
      </Section>

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-2">
        <Section title="Anchorage types in use" description="Defined once in the library; referenced by plinths.">
          <ul className="text-[13px]">
            {types.map(({ t, used }) => (
              <li key={t.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                <span className="font-medium">{t.code}</span>
                <span className="text-muted">{used.length} plinth{used.length === 1 ? '' : 's'} · {used.map((p) => idx.foundation.get(p.foundationId)!.number).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs"><TextLink to={paths.anchorage(projectId)}>Open anchorage library</TextLink></p>
        </Section>
        <Section title="Handover readiness">
          <p className="text-[13px]"><StatusBadge tone={phaseTone(ev.phase)} label={ev.label} /></p>
          <p className="mt-2 text-xs text-muted">{ev.items.filter((i) => i.met).length} of {ev.items.length} requirements met · {ev.outstandingFoundations} foundations not yet constructed · {ev.openDeficiencies} open deficiencies</p>
          <p className="mt-3 text-xs"><TextLink to={paths.area(projectId, areaId, 'handover')}>Open handover</TextLink></p>
        </Section>
      </div>

      <Section title="Outstanding issues" description={`${issues.length} in this area, highest priority first.`}>
        <IssueList issues={issues} limit={10} empty="No outstanding issues in this area." />
      </Section>
    </>
  )
}

const QUALITY_COLUMNS: { key: string; label: string; footing: boolean }[] = [
  { key: 'layout', label: 'Layout', footing: true },
  { key: 'preSurvey', label: 'Pre-pour survey', footing: false },
  { key: 'postSurvey', label: 'Post-pour survey', footing: false },
  { key: 'preInspection', label: 'Pre-pour inspection', footing: false },
  { key: 'postInspection', label: 'Post-pour inspection', footing: false },
]

function Quality({ projectId, areaId }: { projectId: string; areaId: string }) {
  const { idx } = useConstruction()
  const rows = foundationsOf(idx, areaId)
  return (
    <>
      <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">Survey and QA/QC are separate processes: a completed survey does not mean an inspection is approved. Each cell counts the footing and every plinth for that activity.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line"><th className="t-label py-3 pr-4 font-medium">Foundation</th>
              {QUALITY_COLUMNS.map((c, i) => <th key={c.key} className={`t-label py-3 pr-4 font-medium ${i === 3 ? 'border-l border-line pl-4' : ''}`}>{c.label}</th>)}
            </tr>
            <tr className="border-b border-line text-xs text-muted"><td /><td colSpan={3} className="pb-1">Survey</td><td colSpan={2} className="border-l border-line pb-1 pl-4">QA/QC</td></tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-b border-line">
                <td className="py-3 pr-4 text-[13px] font-medium"><TextLink to={paths.foundation(projectId, f)}>{f.number}</TextLink></td>
                {QUALITY_COLUMNS.map((c, i) => <td key={c.key} className={`py-3 pr-4 ${i === 3 ? 'border-l border-line pl-4' : ''}`}><QualityCell idx={idx} f={f} k={c.key} /></td>)}
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
      <PageHeader title="Foundation register" description="Every foundation and plinth in the project. Search, filter, sort, and expand a foundation to see its plinths." />
      <FoundationRegister projectId={projectId} />
    </>
  )
}
