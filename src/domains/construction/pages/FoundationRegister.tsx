import { ChevronRight } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CARD, MeterBar, Segmented, SortBar } from '@/components/mobile/Cards'
import { useIsPhone } from '@/lib/useMedia'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { ProgressBar } from '@/components/ui/Progress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { paths } from '../paths'
import {
  BOLT_STAGE_LABEL, FOUNDATION_STATE_LABEL, computeStats, footingActivities, footingStep, foundationState, foundationsOf, foundationsOfProject, percent, plinthActivities, plinthBoltStage,
  plinthState, plinthStep, progressOf, tallyCategory, type FoundationState, type FoundationStateId, type Stats,
} from '../selectors'
import { useConstruction } from '../store'
import { AddAreaButton, AddFoundationButton, ManageFoundationButton } from './AddFoundation'
import { FoundationStateBadge, fraction } from '../ui'
import type { Area, Foundation, Plinth } from '../types'

type SortKey = 'number' | 'construction' | 'survey' | 'qaqc' | 'state'
type StateFilter = FoundationStateId | 'blocked' | 'all'

interface Row {
  f: Foundation
  area: Area
  plinths: Plinth[]
  stats: Stats
  state: FoundationState
  step: string
  types: string[]
}

const STATE_RANK: Record<FoundationStateId, number> = { 'not-started': 0, 'in-progress': 1, constructed: 2, 'closed-out': 3 }

export function FoundationRegister({ projectId, areaId }: { projectId: string; areaId?: string }) {
  const { state, idx } = useConstruction()
  const phone = useIsPhone()
  const [view, setView] = useState<'foundations' | 'plinths'>('foundations')
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [areaFilter, setAreaFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'number', dir: 1 })
  const [open, setOpen] = useState<Set<string>>(new Set())

  const rows = useMemo<Row[]>(
    () =>
      (areaId ? foundationsOf(idx, areaId) : foundationsOfProject(idx, projectId)).filter((f) => showArchived || !f.archived).map((f) => {
        const plinths = idx.plinthsByFoundation.get(f.id) ?? []
        return {
          f, plinths, area: idx.area.get(f.areaId)!, stats: computeStats(idx, [f]), state: foundationState(idx, f), step: footingStep(idx, f),
          types: [...new Set(plinths.map((p) => p.anchorageTypeId ?? '—'))],
        }
      }),
    [idx, areaId, projectId, showArchived],
  )

  const q = query.trim().toLowerCase()
  const visible = rows
    .filter((r) => !areaId && areaFilter !== 'all' ? r.f.areaId === areaFilter : true)
    .filter((r) => typeFilter === 'all' || r.types.includes(typeFilter))
    .filter((r) => (stateFilter === 'all' ? true : stateFilter === 'blocked' ? r.state.blocked : stateFilter === 'constructed' ? r.state.state === 'constructed' || r.state.state === 'closed-out' : r.state.state === stateFilter))
    .filter((r) => !q || [r.f.number, r.f.description, r.area.name, ...r.types].some((x) => x.toLowerCase().includes(q)))
    .sort((a, b) => {
      const by = (x: Row) =>
        sort.key === 'number' ? x.f.number : sort.key === 'construction' ? x.stats.progress : sort.key === 'survey' ? percent(x.stats.survey) : sort.key === 'qaqc' ? percent(x.stats.qaqc) : STATE_RANK[x.state.state]
      const [va, vb] = [by(a), by(b)]
      return (va < vb ? -1 : va > vb ? 1 : a.f.number.localeCompare(b.f.number)) * sort.dir
    })

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const Th = ({ k, children, hide }: { k?: SortKey; children: React.ReactNode; hide?: boolean | 'sm' }) => (
    <th className={`t-label py-3 pr-5 font-medium ${hide === 'sm' ? 'hidden sm:table-cell' : hide ? 'hidden lg:table-cell' : ''}`}>
      {k ? (
        <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink">
          {children}
          {sort.key === k && <span aria-hidden>{sort.dir === 1 ? '↑' : '↓'}</span>}
        </button>
      ) : children}
    </th>
  )

  const plinthRows = visible.flatMap((r) => r.plinths.map((p) => ({ r, p })))

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Input data-search className="lg:max-w-xs" type="search" placeholder="Search foundation, anchorage, area" aria-label="Search register" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-3 phone:grid phone:grid-cols-2">
          <Select className="w-40 phone:w-full" aria-label="Filter by status" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
            <option value="all">All statuses</option>
            {(Object.keys(FOUNDATION_STATE_LABEL) as FoundationStateId[]).map((s) => <option key={s} value={s}>{FOUNDATION_STATE_LABEL[s]}</option>)}
            <option value="blocked">Blocked</option>
          </Select>
          <Select className="w-36 phone:w-full" aria-label="Filter by anchorage type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All anchorage</option>
            {state.anchorageTypes.map((t) => <option key={t.id} value={t.code}>{t.code}</option>)}
          </Select>
          {!areaId && (
            <Select className="w-44 phone:w-full phone:col-span-2" aria-label="Filter by area" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
              <option value="all">All areas</option>
              {state.areas.filter((a) => a.projectId === projectId && (showArchived || !a.archived)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </div>
        {phone && <SortBar options={[{ key: 'number', label: 'Foundation' }, { key: 'construction', label: 'Construction' }, { key: 'survey', label: 'Survey' }, { key: 'qaqc', label: 'QA/QC' }, { key: 'state', label: 'Status' }]} value={sort.key} dir={sort.dir} onChange={(k) => setSort({ key: k, dir: 1 })} onToggleDir={() => setSort((x) => ({ ...x, dir: x.dir === 1 ? -1 : 1 }))} />}
        {phone && <Segmented label="Register view" value={view} onChange={setView} items={[{ id: 'foundations', label: 'Foundations' }, { id: 'plinths', label: 'Plinths' }]} />}
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto phone:[&>div[role=group]]:hidden"><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>{!areaId && <AddAreaButton projectId={projectId} />}<AddFoundationButton projectId={projectId} areaId={areaId} />
        <div className="flex gap-1 text-[13px]" role="group" aria-label="Register view">
          {(['foundations', 'plinths'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`rounded-nx px-3 py-1.5 capitalize transition-colors ${view === v ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink'}`}>{v}</button>
          ))}
        </div></div>
      </div>
      <p className="mb-1 text-xs text-muted">
        {view === 'foundations' ? `${visible.length} of ${rows.length} foundations` : `${plinthRows.length} plinths`} · expand a foundation to see its plinths
      </p>

      {!visible.length ? (
        rows.length === 0 ? (
          <EmptyState
            title={state.areas.some((a) => a.projectId === projectId && !a.archived) ? 'No foundations yet' : 'No construction areas yet'}
            description={state.areas.some((a) => a.projectId === projectId && !a.archived) ? 'Add foundations to build this register. Materials, survey and QA/QC then use them automatically.' : 'Create an area first, then add its foundations. You can add several foundations at once.'}
            action={<div className="flex flex-wrap justify-center gap-2">{!areaId && !state.areas.some((a) => a.projectId === projectId && !a.archived) && <AddAreaButton projectId={projectId} />}<AddFoundationButton projectId={projectId} areaId={areaId} /></div>}
          />
        ) : <EmptyState title="No foundations match" description="Adjust the search or filters." />
      ) : phone ? (
        <RegisterCards view={view} visible={visible} plinthRows={plinthRows} open={open} toggleOpen={toggleOpen} projectId={projectId} areaId={areaId} />
      ) : view === 'foundations' ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="w-6" />
                <Th k="number">Foundation</Th>
                {!areaId && <Th hide>Area</Th>}
                <Th hide="sm">Anchorage</Th>
                <Th hide>Footing step</Th>
                <Th k="construction">Construction</Th>
                <Th hide>Plinths poured</Th>
                <Th k="survey" hide>Survey</Th>
                <Th k="qaqc" hide>QA/QC</Th>
                <Th hide>Bolts ready</Th>
                <Th k="state">Status</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isOpen = open.has(r.f.id)
                const plinthPoured = r.stats.plinthPoured
                return (
                  <Fragment key={r.f.id}>
                    <tr className="border-b border-line transition-colors hover:bg-hover">
                      <td className="py-3.5">
                        <button onClick={() => toggleOpen(r.f.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${r.f.number}`} className="text-muted hover:text-ink">
                          <ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                      <td className="py-3.5 pr-5 text-[13px]">
                        <Link to={paths.foundation(projectId, r.f)} className="font-medium underline-offset-4 hover:underline">{r.f.number}</Link>{r.f.archived && <span className="ml-2 text-xs text-muted">Archived</span>}<span className="ml-2 inline-block align-middle"><ManageFoundationButton foundation={r.f} /></span>
                        <span className="block text-xs text-muted">{r.f.description} · {r.plinths.length} plinth{r.plinths.length === 1 ? '' : 's'}<span className="sm:hidden"> · {r.types.join(', ')}</span></span>
                      </td>
                      {!areaId && <td className="hidden py-3.5 pr-5 text-[13px] text-muted lg:table-cell">{r.area.name}</td>}
                      <td className="hidden py-3.5 pr-5 text-[13px] sm:table-cell">{r.types.join(', ')}</td>
                      <td className="hidden py-3.5 pr-5 text-[13px] text-muted lg:table-cell">{r.step}</td>
                      <td className="py-3.5 pr-5"><ProgressBar value={r.stats.progress} width="w-16 sm:w-24" /></td>
                      <td className="hidden py-3.5 pr-5 text-[13px] tabular-nums text-muted lg:table-cell">{fraction(plinthPoured)}</td>
                      <td className="hidden py-3.5 pr-5 text-[13px] tabular-nums text-muted lg:table-cell">{fraction(r.stats.survey)}</td>
                      <td className="hidden py-3.5 pr-5 text-[13px] tabular-nums text-muted lg:table-cell">{fraction(r.stats.qaqc)}</td>
                      <td className="hidden py-3.5 pr-5 text-[13px] tabular-nums text-muted lg:table-cell">{r.stats.materialsReady.ready}/{r.stats.materialsReady.total}</td>
                      <td className="py-3.5 pr-2"><FoundationStateBadge state={r.state.state} blocked={r.state.blocked} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-canvas">
                        <td />
                        <td colSpan={areaId ? 9 : 10} className="py-3 pr-5">
                          <PlinthDetail projectId={projectId} f={r.f} plinths={r.plinths} footingStatsLine={`Footing: ${r.step} · construction ${fraction(tallyCategory(idx, footingActivities(idx, r.f), 'construction'))}`} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <Th>Plinth</Th>
                <Th hide="sm">Anchorage</Th>
                <Th>Current step</Th>
                <Th>Construction</Th>
                <Th hide>Survey</Th>
                <Th hide>QA/QC</Th>
                <Th hide>Anchor bolts</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {plinthRows.map(({ r, p }) => {
                const acts = plinthActivities(idx, p)
                const ps = plinthState(idx, p)
                return (
                  <tr key={p.id} className="border-b border-line transition-colors hover:bg-hover">
                    <td className="py-3.5 pr-5 text-[13px]">
                      <Link to={paths.foundation(projectId, r.f, p.id)} className="font-medium underline-offset-4 hover:underline">{r.f.number} · P{p.index}</Link>
                      <span className="block text-xs text-muted">{!areaId && `${r.area.name} · `}<span className="sm:hidden">{p.anchorageTypeId ?? '—'}</span></span>
                    </td>
                    <td className="hidden py-3.5 pr-5 text-[13px] sm:table-cell">{p.anchorageTypeId ?? '—'}</td>
                    <td className="py-3.5 pr-5 text-[13px] text-muted">{plinthStep(idx, p)}</td>
                    <td className="py-3.5 pr-5"><ProgressBar value={progressOf(idx, acts)} width="w-16 sm:w-24" /></td>
                    <td className="hidden py-3.5 pr-5 text-[13px] tabular-nums text-muted lg:table-cell">{fraction(tallyCategory(idx, acts, 'survey'))}</td>
                    <td className="hidden py-3.5 pr-5 text-[13px] tabular-nums text-muted lg:table-cell">{fraction(tallyCategory(idx, acts, 'qaqc'))}</td>
                    <td className="hidden py-3.5 pr-5 text-[13px] text-muted lg:table-cell">{BOLT_STAGE_LABEL[plinthBoltStage(idx, p)]}</td>
                    <td className="py-3.5 pr-2"><FoundationStateBadge state={ps.state} blocked={ps.blocked} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PlinthDetail({ projectId, f, plinths, footingStatsLine }: { projectId: string; f: Foundation; plinths: Plinth[]; footingStatsLine: string }) {
  const { idx } = useConstruction()
  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-xs text-muted">{footingStatsLine}</p>
      {plinths.map((p) => {
        const acts = plinthActivities(idx, p)
        const ps = plinthState(idx, p)
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 phone:gap-x-3 phone:border-t phone:border-line phone:py-3">
            <Link to={paths.foundation(projectId, f, p.id)} className="w-24 font-medium underline-offset-4 hover:underline phone:flex phone:min-h-11 phone:items-center">Plinth {p.index}</Link>
            <span className="w-16">{p.anchorageTypeId ?? '—'}</span>
            <span className="w-44 text-muted phone:w-auto">{plinthStep(idx, p)}</span>
            <span className="w-20 tabular-nums text-muted phone:w-auto">{progressOf(idx, acts)}%</span>
            <span className="text-muted">{BOLT_STAGE_LABEL[plinthBoltStage(idx, p)]}</span>
            <StatusBadge tone={ps.blocked ? 'bad' : ps.state === 'in-progress' ? 'info' : ps.state === 'not-started' ? 'muted' : 'ok'} label={ps.blocked ? 'Blocked' : FOUNDATION_STATE_LABEL[ps.state]} />
          </div>
        )
      })}
    </div>
  )
}


/** Phone presentation of the register: one card per foundation (or plinth) with progress, status and the key counts; plinths expand in place. */
function RegisterCards({ view, visible, plinthRows, open, toggleOpen, projectId, areaId }: {
  view: 'foundations' | 'plinths'; visible: Row[]; plinthRows: { r: Row; p: Plinth }[]; open: Set<string>; toggleOpen: (id: string) => void; projectId: string; areaId?: string
}) {
  const { idx } = useConstruction()
  if (view === 'plinths') {
    return (
      <ul className="space-y-3" aria-label="Plinths">
        {plinthRows.map(({ r, p }) => {
          const acts = plinthActivities(idx, p)
          const ps = plinthState(idx, p)
          const progress = progressOf(idx, acts)
          return (
            <li key={p.id} className={`${CARD} p-4`}>
              <div className="flex items-start justify-between gap-3">
                <Link to={paths.foundation(projectId, r.f, p.id)} className="min-w-0 text-[18px] font-semibold">{r.f.number} · P{p.index}</Link>
                <FoundationStateBadge state={ps.state} blocked={ps.blocked} />
              </div>
              <p className="mt-0.5 text-[14px] text-muted">{!areaId && `${r.area.name} · `}{p.anchorageTypeId ?? '—'} · {plinthStep(idx, p)}</p>
              <div className="mt-3 flex items-center gap-3"><MeterBar value={progress} label={`${r.f.number} plinth ${p.index} construction`} /><span className="w-12 shrink-0 text-right text-[16px] font-medium tabular-nums">{progress}%</span></div>
              <p className="mt-2 text-[13px] text-muted">Survey {fraction(tallyCategory(idx, acts, 'survey'))} · QA/QC {fraction(tallyCategory(idx, acts, 'qaqc'))} · {BOLT_STAGE_LABEL[plinthBoltStage(idx, p)]}</p>
            </li>
          )
        })}
      </ul>
    )
  }
  return (
    <ul className="space-y-3" aria-label="Foundations">
      {visible.map((r) => {
        const isOpen = open.has(r.f.id)
        return (
          <li key={r.f.id} className={`${CARD} p-4`}>
            <div className="flex items-start justify-between gap-3">
              <Link to={paths.foundation(projectId, r.f)} className="min-w-0 text-[20px] font-semibold leading-tight">{r.f.number}{r.f.archived && <span className="ml-2 text-xs font-normal text-muted">Archived</span>}</Link>
              <FoundationStateBadge state={r.state.state} blocked={r.state.blocked} />
            </div>
            <p className="mt-0.5 text-[14px] text-muted">{r.f.description} · {r.plinths.length} plinth{r.plinths.length === 1 ? '' : 's'}{!areaId && ` · ${r.area.name}`}</p>
            <p className="text-[14px] text-muted">Anchorage {r.types.join(', ')} · {r.step}</p>
            <div className="mt-3 flex items-center gap-3"><MeterBar value={r.stats.progress} label={`${r.f.number} construction`} /><span className="w-12 shrink-0 text-right text-[16px] font-medium tabular-nums">{r.stats.progress}%</span></div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[['Survey', fraction(r.stats.survey)], ['QA/QC', fraction(r.stats.qaqc)], ['Bolts ready', `${r.stats.materialsReady.ready}/${r.stats.materialsReady.total}`]].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-canvas px-1 py-2"><dt className="text-[12px] text-muted">{l}</dt><dd className="text-[16px] font-medium tabular-nums">{v}</dd></div>
              ))}
            </dl>
            <div className="mt-2 flex justify-end"><ManageFoundationButton foundation={r.f} /></div>
            <button type="button" onClick={() => toggleOpen(r.f.id)} aria-expanded={isOpen} className="flex h-11 w-full items-center justify-between text-[15px] text-muted">
              <span>Plinths ({r.plinths.length})</span><ChevronRight size={18} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
            {isOpen && <PlinthDetail projectId={projectId} f={r.f} plinths={r.plinths} footingStatsLine={`Footing: ${r.step} · construction ${fraction(tallyCategory(idx, footingActivities(idx, r.f), 'construction'))}`} />}
          </li>
        )
      })}
    </ul>
  )
}
