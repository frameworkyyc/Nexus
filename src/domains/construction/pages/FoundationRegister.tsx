import { ChevronRight } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CARD, MeterBar, Segmented, SortBar } from '@/components/mobile/Cards'
import { useIsPhone } from '@/lib/useMedia'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { Stat } from '@/components/ui/Stat'
import { FilterToolbar, ViewToggle } from '@/components/ui/Toolbar'
import { ProgressBar } from '@/components/ui/Progress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { paths } from '../paths'
import {
  FOUNDATION_STATE_LABEL, boltStageLabel, computeStats, footingActivities, footingStep, foundationState, foundationsOf, foundationsOfProject, percent, plinthActivities,
  plinthState, plinthStep, progressOf, tallyCategory, type FoundationState, type FoundationStateId, type Stats,
} from '../selectors'
import { useProjectConfig } from '../useProjectConfig'
import { useConstruction } from '../store'
import { foundationConcrete, volumeLabel, type FoundationConcrete } from '../concrete'
import { foundationQuantity, foundationTotals, plinthsPerFoundationFromGroups } from '../foundationQuantity'
import { AddAreaButton, AddFoundationButton, ManageFoundationButton } from './AddFoundation'
import { IndividualFoundations } from './IndividualFoundations'
import { FoundationStateBadge, fraction } from '../ui'
import { resolveAnchorages } from '../anchorageMounts'
import { foundationAnchorageIssues } from '../anchorageStatus'
import { AnchorageWarning } from './AnchorageWarning'
import type { Area, ConstructionState, Foundation, Plinth } from '../types'

type SortKey = 'number' | 'construction' | 'survey' | 'qaqc' | 'state'
type StateFilter = FoundationStateId | 'blocked' | 'all'

interface Row {
  f: Foundation
  area: Area
  plinths: Plinth[]
  qty: number
  /** Plinths on each physical foundation; null = not known. */
  per: number | null
  /** Quantity × plinths per foundation; null when the plinth count is not known. */
  total: number | null
  stats: Stats
  state: FoundationState
  step: string
  types: string[]
  /** One entry per anchorage group: type id (null = not assigned) and plinths per foundation. */
  groups: { typeId: string | null; count: number }[]
  concrete: FoundationConcrete
  anchorageIssues: string[]
}

const codeOfType = (state: ConstructionState, id: string | null) => (id ? state.anchorageTypes.find((t) => t.id === id)?.code ?? id : 'Not assigned')
/** "A × 2, B × 1": plinths per foundation by anchorage type. */
const anchorageSummary = (state: ConstructionState, r: Row) => r.groups.length ? r.groups.map((g) => `${codeOfType(state, g.typeId)} × ${g.count}`).join(', ') : '—'
/** Total concrete for the whole quantity, or why it is not shown: never a partial figure presented as the total. */
const concreteCell = (c: FoundationConcrete) => (c.total !== null ? volumeLabel(c.total) : c.totalKnown > 0 ? `≥ ${volumeLabel(c.totalKnown)}` : '—')
const concreteTitle = (c: FoundationConcrete) => (c.complete ? `${volumeLabel(c.perFoundation!)} per foundation` : `Incomplete: missing ${c.missing.join(' and ')}`)

/** Short names for the step labels, so the column stays on one line: "Layout completed" → "Layout", "Footing poured" → "Pour". */
const STEP_SHORT: Record<string, string> = { 'Layout completed': 'Layout', 'Rebar built': 'Rebar build', 'Rebar installed': 'Rebar install', 'Footing formed': 'Forming', 'Plinth formed': 'Forming', 'Pre-pour survey checks': 'Pre-pour survey', 'Pre-pour inspection': 'Pre-pour QA/QC', 'Footing poured': 'Pour', 'Plinth poured': 'Pour', 'As-built survey': 'As-built survey', 'Post-pour inspection': 'Post-pour QA/QC' }
const shortStep = (label: string) => STEP_SHORT[label] ?? label
/** Anchorage as compact as it can be while staying exact: one code on its own, "A × 2 · B × 1" for several. */
const anchorageShort = (state: ConstructionState, r: Row) =>
  r.groups.length === 0 ? '—' : r.groups.length === 1 ? codeOfType(state, r.groups[0].typeId).replace('Not assigned', '—') : r.groups.map((g) => `${codeOfType(state, g.typeId).replace('Not assigned', '—')} × ${g.count}`).join(' · ')

const STATE_RANK: Record<FoundationStateId, number> = { 'not-started': 0, 'in-progress': 1, constructed: 2, 'closed-out': 3 }

export function FoundationRegister({ projectId, areaId: areaIdProp }: { projectId: string; areaId?: string }) {
  const { state, idx } = useConstruction()
  const cfg = useProjectConfig(projectId)
  // A project without areas: its foundations are all in its hidden area, so the register works as one area's and shows no area controls.
  const areaId = areaIdProp ?? (cfg.usesAreas ? undefined : state.areas.find((a) => a.projectId === projectId && a.implicit)?.id)
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
        const groups = (state.anchorageGroups ?? []).filter((g) => g.foundationId === f.id)
        const perOf = plinthsPerFoundationFromGroups(f, plinths.length, groups)
        const mountedTypes = [...resolveAnchorages(state, f.id).reduce((m, a) => m.set(a.typeId, (m.get(a.typeId) ?? 0) + a.perFoundation), new Map<string, number>())]
        return {
          f, plinths, qty: foundationQuantity(f), per: perOf, total: perOf === null ? null : foundationQuantity(f) * perOf, area: idx.area.get(f.areaId)!, stats: computeStats(idx, [f]), state: foundationState(idx, f), step: footingStep(idx, f),
          types: mountedTypes.length ? mountedTypes.map(([t]) => t) : ['—'],
          // Anchorages per foundation by type, wherever they are mounted (footing or plinths): not the number of plinths.
          groups: mountedTypes.map(([typeId, count]) => ({ typeId, count })),
          concrete: foundationConcrete(f, plinths, groups),
          anchorageIssues: foundationAnchorageIssues(state, f.id),
        }
      }),
    [idx, state, areaId, projectId, showArchived],
  )

  const q = query.trim().toLowerCase()
  const visible = rows
    .filter((r) => !areaId && areaFilter !== 'all' ? r.f.areaId === areaFilter : true)
    .filter((r) => typeFilter === 'all' || r.types.includes(typeFilter))
    .filter((r) => (stateFilter === 'all' ? true : stateFilter === 'blocked' ? r.state.blocked : stateFilter === 'constructed' ? r.state.state === 'constructed' || r.state.state === 'closed-out' : r.state.state === stateFilter))
    .filter((r) => !q || [r.f.number, r.f.description, r.area.name, ...r.types.map((t) => (t === '—' ? '' : codeOfType(state, t)))].some((x) => x.toLowerCase().includes(q)))
    .sort((a, b) => {
      const by = (x: Row) =>
        sort.key === 'number' ? x.f.number : sort.key === 'construction' ? x.stats.progress : sort.key === 'survey' ? percent(x.stats.survey) : sort.key === 'qaqc' ? percent(x.stats.qaqc) : STATE_RANK[x.state.state]
      const [va, vb] = [by(a), by(b)]
      return (va < vb ? -1 : va > vb ? 1 : a.f.number.localeCompare(b.f.number)) * sort.dir
    })

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Columns appear as the screen allows. Whatever is hidden stays one tap away in the expanded row.
  const SHOW = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', wide: 'hidden min-[1400px]:table-cell' } as const
  type Show = keyof typeof SHOW
  const Th = ({ k, children, show, right, title }: { k?: SortKey; children: React.ReactNode; show?: Show; right?: boolean; title?: string }) => (
    <th scope="col" title={title} className={`t-label whitespace-nowrap py-2.5 pr-4 font-medium ${right ? 'text-right' : 'text-left'} ${show ? SHOW[show] : ''}`}>
      {k ? (
        <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink">
          {children}
          {sort.key === k && <span aria-hidden>{sort.dir === 1 ? '↑' : '↓'}</span>}
        </button>
      ) : children}
    </th>
  )
  /** One body cell: fixed row rhythm, vertically centred, never wraps. */
  const Td = ({ show, right, muted, title, children, className = '' }: { show?: Show; right?: boolean; muted?: boolean; title?: string; children: React.ReactNode; className?: string }) => (
    <td title={title} className={`whitespace-nowrap py-0 pr-4 align-middle text-[13px] ${right ? 'text-right tabular-nums' : 'text-left'} ${muted ? 'text-muted' : ''} ${show ? SHOW[show] : ''} ${className}`}>{children}</td>
  )

  const totals = foundationTotals(visible.map((r) => r.f), visible.flatMap((r) => r.plinths))
  const plinthRows = visible.flatMap((r) => r.plinths.map((p) => ({ r, p })))

  return (
    <div>
      {rows.length > 0 && (
        <>
          <dl className="mb-4 grid grid-cols-3 gap-4 border-y border-line py-4" aria-label="Foundation totals">
            <Stat label="Foundation names" value={totals.designations.toLocaleString('en-CA')} />
            <Stat label="Physical foundations" value={totals.physical.toLocaleString('en-CA')} sub="Sum of quantities" />
            <Stat label="Total plinths" value={totals.knownPlinths.toLocaleString('en-CA')} sub={totals.unknownDesignations ? `Excludes ${totals.unknownDesignations} name${totals.unknownDesignations === 1 ? '' : 's'} with unknown plinths` : 'Quantity × plinths per foundation'} />
          </dl>
        </>
      )}
      <FilterToolbar
        phone={phone}
        filterCount={areaId ? 2 : 3}
        activeFilters={[areaFilter, stateFilter, typeFilter].filter((v) => v !== 'all').length}
        search={<Input data-search type="search" placeholder="Search foundations" aria-label="Search foundations" value={query} onChange={(e) => setQuery(e.target.value)} />}
        filters={(
          <>
            {!areaId && (
              <Select aria-label="Filter by area" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
                <option value="all">All areas</option>
                {state.areas.filter((a) => a.projectId === projectId && (showArchived || !a.archived)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
            <Select aria-label="Filter by status" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
              <option value="all">All statuses</option>
              {(Object.keys(FOUNDATION_STATE_LABEL) as FoundationStateId[]).map((s) => <option key={s} value={s}>{FOUNDATION_STATE_LABEL[s]}</option>)}
              <option value="blocked">Blocked</option>
            </Select>
            <Select aria-label="Filter by anchorage type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All anchorage</option>
              {state.anchorageTypes.filter((t) => !t.projectId || t.projectId === projectId).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
            </Select>
          </>
        )}
        secondaryStart={(
          <>
            <label className="flex h-9 items-center gap-2 text-[13px] text-muted phone:h-11"><input type="checkbox" className="h-4 w-4 phone:h-6 phone:w-6" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
            <p className="text-xs text-muted" aria-live="polite">{view === 'foundations' ? `${visible.length} of ${rows.length} foundation names` : `${plinthRows.length} plinths`}</p>
          </>
        )}
        secondaryEnd={phone ? (
          <>
            <SortBar options={[{ key: 'number', label: 'Foundation Name' }, { key: 'construction', label: 'Construction' }, { key: 'survey', label: 'Survey' }, { key: 'qaqc', label: 'QA/QC' }, { key: 'state', label: 'Status' }]} value={sort.key} dir={sort.dir} onChange={(k) => setSort({ key: k, dir: 1 })} onToggleDir={() => setSort((x) => ({ ...x, dir: x.dir === 1 ? -1 : 1 }))} />
            <Segmented label="Foundations view" value={view} onChange={setView} items={[{ id: 'foundations', label: 'Foundations' }, { id: 'plinths', label: 'Plinths' }]} />
            {!areaId && <AddAreaButton projectId={projectId} />}
          </>
        ) : (
          <>
            <ViewToggle label="Foundations view" value={view} onChange={setView} items={[{ id: 'foundations', label: 'Foundations' }, { id: 'plinths', label: 'Plinths' }]} />
            {!areaId && <AddAreaButton projectId={projectId} />}
          </>
        )}
      />
      <p className="mb-1 text-xs text-muted">Expand a foundation to see its plinths.</p>

      {!visible.length ? (
        rows.length === 0 ? (
          <EmptyState
            title={state.areas.some((a) => a.projectId === projectId && !a.archived) ? 'No foundations yet' : 'No construction areas yet'}
            description={state.areas.some((a) => a.projectId === projectId && !a.archived) ? 'Add foundations to build this list. Materials, survey and QA/QC then use them automatically.' : 'Create an area first, then add its foundations. You can add several foundations at once.'}
            action={<div className="flex flex-wrap justify-center gap-2">{!areaId && !state.areas.some((a) => a.projectId === projectId && !a.archived) && <AddAreaButton projectId={projectId} />}<AddFoundationButton projectId={projectId} areaId={areaId} /></div>}
          />
        ) : <EmptyState title="No foundations match" description="Adjust the search or filters." />
      ) : phone ? (
        <RegisterCards view={view} visible={visible} plinthRows={plinthRows} open={open} toggleOpen={toggleOpen} projectId={projectId} areaId={areaId} />
      ) : view === 'foundations' ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="w-8"><span className="sr-only">Expand</span></th>
                <Th k="number">Name</Th>
                <Th right title="Physical foundations of this name">Footings</Th>
                <Th right show="md" title="Plinths across all footings (footings × plinths on each)">Plinths</Th>
                <Th right show="lg" title="Calculated concrete for all foundations of this name">Concrete</Th>
                {!areaId && <Th show="wide">Area</Th>}
                <Th show="lg">Anchorage</Th>
                <Th show="wide" title="Next footing step">Step</Th>
                <Th k="construction" title="Construction progress">Progress</Th>
                <Th k="state">Status</Th>
                <th className="w-9"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isOpen = open.has(r.f.id)
                return (
                  <Fragment key={r.f.id}>
                    <tr className="h-12 border-b border-line transition-colors hover:bg-hover">
                      <td className="align-middle">
                        <button onClick={() => toggleOpen(r.f.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${r.f.number}`} className="grid h-8 w-8 place-items-center text-muted hover:text-ink">
                          <ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                      <Td>
                        <div className="flex min-w-0 max-w-[12rem] items-center gap-2 min-[1400px]:max-w-[14rem]">
                          <div className="flex min-w-0 flex-1 items-baseline gap-2">
                            <Link to={paths.foundation(projectId, r.f)} className="max-w-full shrink-0 truncate font-medium underline-offset-4 hover:underline" title={r.f.number}>{r.f.number}</Link>
                            {r.f.archived && <span className="shrink-0 text-xs text-muted">Archived</span>}
                            {r.f.description && <span className="min-w-0 flex-1 truncate text-xs text-muted" title={r.f.description}>{r.f.description}</span>}
                          </div>
                          <span className="flex h-5 w-5 shrink-0 justify-end"><AnchorageWarning issues={r.anchorageIssues} align="right" /></span>
                        </div>
                      </Td>
                      <Td right>{r.qty.toLocaleString('en-CA')}</Td>
                      <Td right show="md">{r.total === null ? <span className="text-muted" title="Plinths per foundation is not known">—</span> : r.total.toLocaleString('en-CA')}</Td>
                      <Td right show="lg" title={concreteTitle(r.concrete)}>{concreteCell(r.concrete)}</Td>
                      {!areaId && <Td show="wide" muted title={r.area.name}><div className="max-w-[7rem] truncate">{r.area.name}</div></Td>}
                      <Td show="lg" title={anchorageSummary(state, r)}><div className="max-w-[9rem] truncate min-[1400px]:max-w-[11rem]">{anchorageShort(state, r)}</div></Td>
                      <Td show="wide" muted>{shortStep(r.step)}</Td>
                      <Td><ProgressBar value={r.stats.progress} width="w-12" /></Td>
                      <Td><FoundationStateBadge state={r.state.state} blocked={r.state.blocked} /></Td>
                      <td className="pr-1 text-right align-middle"><ManageFoundationButton foundation={r.f} compact /></td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-canvas">
                        <td />
                        <td colSpan={20} className="py-3 pr-5">
                          <RowSummary state={state} r={r} areaId={areaId} />
                          <IndividualFoundations foundation={r.f} />
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
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <Th>Plinth</Th>
                <Th show="md">Anchorage</Th>
                <Th>Step</Th>
                <Th>Progress</Th>
                <Th right show="lg">Survey</Th>
                <Th right show="lg">QA/QC</Th>
                <Th show="wide" title="Anchor bolt stage">Bolts</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {plinthRows.map(({ r, p }) => {
                const acts = plinthActivities(idx, p)
                const ps = plinthState(idx, p)
                return (
                  <tr key={p.id} className="h-12 border-b border-line transition-colors hover:bg-hover">
                    <Td>
                      <Link to={paths.foundation(projectId, r.f, p.id)} className="font-medium underline-offset-4 hover:underline">{r.f.number} · P{p.index}</Link>
                      {!areaId && <span className="ml-2 text-xs text-muted">{r.area.name}</span>}
                    </Td>
                    <Td show="md">{codeOfType(state, p.anchorageTypeId).replace('Not assigned', '—')}</Td>
                    <Td muted>{shortStep(plinthStep(idx, p))}</Td>
                    <Td><ProgressBar value={progressOf(idx, acts)} width="w-12" /></Td>
                    <Td right show="lg" muted>{fraction(tallyCategory(idx, acts, 'survey'))}</Td>
                    <Td right show="lg" muted>{fraction(tallyCategory(idx, acts, 'qaqc'))}</Td>
                    <Td show="wide" muted>{boltStageLabel(idx, p)}</Td>
                    <Td><FoundationStateBadge state={ps.state} blocked={ps.blocked} /></Td>
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

/** Everything the table can hide on a narrow screen (and a little more), kept together in the expanded row. */
function RowSummary({ state, r, areaId }: { state: ConstructionState; r: Row; areaId?: string }) {
  const items: [string, React.ReactNode][] = [
    ...(r.f.description ? [['Description', r.f.description] as [string, React.ReactNode]] : []),
    ...(!areaId ? [['Area', r.area.name] as [string, React.ReactNode]] : []),
    ['Anchorage', anchorageSummary(state, r)],
    ['Plinths', r.per === null ? 'Not known' : `${r.per} per foundation${r.total !== null ? ` · ${r.total.toLocaleString('en-CA')} in total` : ''}`],
    ['Concrete', `${concreteCell(r.concrete)}${r.concrete.complete ? ` (${volumeLabel(r.concrete.perFoundation!)} each)` : ' (incomplete)'}`],
    ['Next footing step', r.step],
    ['Plinths poured', fraction(r.stats.plinthPoured)],
    ['Survey', fraction(r.stats.survey)],
    ['QA/QC', fraction(r.stats.qaqc)],
    ['Bolts ready', `${r.stats.materialsReady.ready}/${r.stats.materialsReady.total}`],
  ]
  return (
    <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] md:grid-cols-3 xl:grid-cols-5">
      {items.map(([l, v]) => <div key={l} className="min-w-0"><dt className="t-label">{l}</dt><dd className="mt-0.5 truncate tabular-nums" title={typeof v === 'string' ? v : undefined}>{v}</dd></div>)}
    </dl>
  )
}

function PlinthDetail({ projectId, f, plinths, footingStatsLine }: { projectId: string; f: Foundation; plinths: Plinth[]; footingStatsLine: string }) {
  const { idx, state } = useConstruction()
  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-xs text-muted">{footingStatsLine}</p>
      {plinths.map((p) => {
        const acts = plinthActivities(idx, p)
        const ps = plinthState(idx, p)
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 phone:gap-x-3 phone:border-t phone:border-line phone:py-3">
            <Link to={paths.foundation(projectId, f, p.id)} className="w-24 font-medium underline-offset-4 hover:underline phone:flex phone:min-h-11 phone:items-center">Plinth {p.index}</Link>
            <span className="w-16">{codeOfType(state, p.anchorageTypeId)}</span>
            <span className="w-44 text-muted phone:w-auto">{plinthStep(idx, p)}</span>
            <span className="w-20 tabular-nums text-muted phone:w-auto">{progressOf(idx, acts)}%</span>
            <span className="text-muted">{boltStageLabel(idx, p)}</span>
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
  const { idx, state } = useConstruction()
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
              <p className="mt-0.5 text-[14px] text-muted">{!areaId && `${r.area.name} · `}{codeOfType(state, p.anchorageTypeId)} · {plinthStep(idx, p)}</p>
              <div className="mt-3 flex items-center gap-3"><MeterBar value={progress} label={`${r.f.number} plinth ${p.index} construction`} /><span className="w-12 shrink-0 text-right text-[16px] font-medium tabular-nums">{progress}%</span></div>
              <p className="mt-2 text-[13px] text-muted">Survey {fraction(tallyCategory(idx, acts, 'survey'))} · QA/QC {fraction(tallyCategory(idx, acts, 'qaqc'))} · {boltStageLabel(idx, p)}</p>
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
              <Link to={paths.foundation(projectId, r.f)} className="min-w-0 flex-1 text-[20px] font-semibold leading-tight">{r.f.number}{r.f.archived && <span className="ml-2 text-xs font-normal text-muted">Archived</span>}</Link>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 justify-end"><AnchorageWarning issues={r.anchorageIssues} align="right" /></span>
              <FoundationStateBadge state={r.state.state} blocked={r.state.blocked} />
            </div>
            <p className="mt-0.5 text-[14px] text-muted">{[r.f.description, !areaId && r.area.name].filter(Boolean).join(' · ')}</p>
            <p className="text-[14px]"><span className="font-medium">{r.qty.toLocaleString('en-CA')}</span> footing{r.qty === 1 ? '' : 's'} · {r.total === null ? 'plinths not known' : <><span className="font-medium">{r.total.toLocaleString('en-CA')}</span> plinth{r.total === 1 ? '' : 's'}</>}</p>
            <p className="text-[14px] text-muted">Anchorage {anchorageSummary(state, r)} · {r.step}</p>
            <p className="text-[14px] text-muted" title={concreteTitle(r.concrete)}>Concrete {concreteCell(r.concrete)}{!r.concrete.complete && <span> (incomplete)</span>}</p>
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
            {isOpen && <IndividualFoundations foundation={r.f} />}
            {isOpen && <PlinthDetail projectId={projectId} f={r.f} plinths={r.plinths} footingStatsLine={`Footing: ${r.step} · construction ${fraction(tallyCategory(idx, footingActivities(idx, r.f), 'construction'))}`} />}
          </li>
        )
      })}
    </ul>
  )
}
