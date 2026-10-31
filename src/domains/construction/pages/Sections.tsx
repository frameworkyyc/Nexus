import { ChevronRight } from 'lucide-react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useProjectContext } from '@/app/projectContext'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { useIsServer } from '@/lib/dataSource'
import { redirectFor } from '../navigation'
import { paths } from '../paths'
import { foundationsOf } from '../selectors'
import { useConstruction } from '../store'
import { Construction, Quality } from './AreaPage'
import { OverviewPage } from './OverviewPage'

/* ── Redirects ────────────────────────────────────────────────────────────── */

/** A path that moved in the navigation redesign: sends the visitor to its new home, keeping any ?tab= style search. */
export function LegacyRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={redirectFor(pathname, search) ?? '/'} replace />
}

/** `/` opens the last-used project's Project Progress. With no project yet it shows the onboarding overview instead. */
export function RootRedirect() {
  const { projectId } = useProjectContext()
  return projectId ? <Navigate to={paths.progress(projectId)} replace /> : <OverviewPage />
}

/** A project-less path (the old global /procurement) goes to the same page of the project in context, or to the project list. */
export function ProjectContextRedirect({ to }: { to: (projectId: string) => string }) {
  const { projectId } = useProjectContext()
  return <Navigate to={projectId ? to(projectId) : '/projects'} replace />
}

/* ── Future development ───────────────────────────────────────────────────── */

/** Shown where a category is planned but has no screens or records yet. It never shows a number: nothing is recorded, so nothing is claimed. */
export function FutureDevelopment({ title, description }: { title: string; description: string }) {
  return (
    <section aria-label={`${title}: future development`} className="rounded-nx border border-dashed border-line bg-surface px-6 py-12 text-center">
      <span className="inline-flex rounded-full border border-line px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">Future development</span>
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
    </section>
  )
}

/* ── Operational pages ────────────────────────────────────────────────────── */

/**
 * Construction, Survey and QA/QC (operational pages): the existing area screens, unchanged, behind an area selector. Survey and QA/QC
 * are recorded together today (one table), so both entries open that same table until their own workflows are developed.
 */
export function ManageDiscipline({ kind }: { kind: 'construction' | 'survey' | 'qaqc' }) {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const [params, setParams] = useSearchParams()
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived).sort((a, b) => a.sequence - b.sequence)
  const area = areas.find((a) => a.id === params.get('area')) ?? areas[0]
  const title = kind === 'construction' ? 'Construction / Installation' : kind === 'survey' ? 'Survey' : 'QA/QC'
  if (!area) return <><PageHeader title={title} /><EmptyState title="No areas yet" description="Add an area in Setup to record this work." action={<Link to={paths.areas(projectId)} className="text-[13px] underline underline-offset-4">Open Setup → Areas</Link>} /></>
  return (
    <>
      <PageHeader title={title} description={kind === 'construction' ? 'Footing and plinth work for the selected area, as recorded today.' : 'Survey checks and QA/QC inspections for the selected area. They are recorded together in one table today.'} />
      <div role="group" aria-label="Area" className="mb-6 flex flex-wrap gap-2" data-compact>
        {areas.map((a) => (
          <button key={a.id} type="button" aria-pressed={a.id === area.id} onClick={() => setParams({ area: a.id })}
            className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-[13px] transition-colors phone:h-11 phone:text-[15px] ${a.id === area.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}>{a.name}</button>
        ))}
      </div>
      {kind === 'construction' ? <Construction projectId={projectId} areaId={area.id} /> : <Quality projectId={projectId} areaId={area.id} />}
    </>
  )
}

/* ── Foundation Overview ──────────────────────────────────────────────────── */

/** Choose an area, then a foundation designation, to open its overview. Each designation is one entry (individual footings come later). */
export function FoundationSelector() {
  const { projectId = '' } = useParams()
  const { state, idx } = useConstruction()
  const [params, setParams] = useSearchParams()
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived).sort((a, b) => a.sequence - b.sequence)
  const area = areas.find((a) => a.id === params.get('area')) ?? areas[0]
  if (!area) return <><PageHeader title="Foundation Overview" /><EmptyState title="No areas yet" description="Foundations belong to an area. Add an area in Setup first." action={<Link to={paths.areas(projectId)} className="text-[13px] underline underline-offset-4">Open Setup → Areas</Link>} /></>
  const foundations = foundationsOf(idx, area.id).filter((f) => !f.archived)
  return (
    <>
      <PageHeader title="Foundation Overview" description="Choose an area, then a foundation, to see its full status." />
      <div role="group" aria-label="Area" className="mb-6 flex flex-wrap gap-2" data-compact>
        {areas.map((a) => (
          <button key={a.id} type="button" aria-pressed={a.id === area.id} onClick={() => setParams({ area: a.id })}
            className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-[13px] transition-colors phone:h-11 phone:text-[15px] ${a.id === area.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}>{a.name}</button>
        ))}
      </div>
      {foundations.length === 0 ? <EmptyState title="No foundations in this area yet" description="Add foundations in Setup → Foundations." action={<Link to={paths.register(projectId)} className="text-[13px] underline underline-offset-4">Open Setup → Foundations</Link>} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Foundations">
          {foundations.map((f) => {
            const plinths = (idx.plinthsByFoundation.get(f.id) ?? []).length
            return (
              <li key={f.id}>
                <Link to={paths.foundation(projectId, f)} className="flex items-center justify-between gap-3 rounded-nx border border-line bg-surface p-4 transition-colors hover:border-ink">
                  <span className="min-w-0">
                    <span className="block font-medium">{f.number}</span>
                    <span className="block truncate text-[13px] text-muted">{f.description || 'No description'}</span>
                    <span className="mt-1 block text-xs text-muted">{(f.quantity ?? 1) > 1 ? `${f.quantity} foundations · ` : ''}{plinths} plinth{plinths === 1 ? '' : 's'}</span>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/* ── Setup ────────────────────────────────────────────────────────────────── */

/** Configuration that used to sit in the project tabs: foundations, areas, the Anchorage Library and concrete pours. */
export function SetupHub() {
  const { projectId = '' } = useParams()
  const server = useIsServer()
  const cards = [
    { to: paths.register(projectId), title: 'Foundations', text: 'Create, edit and configure foundation designations, quantities and anchorage.' },
    { to: paths.areas(projectId), title: 'Areas', text: 'Add, rename and archive the areas of this project.' },
    { to: paths.anchorage(projectId), title: 'Anchorage types & library', text: 'Anchorage types, their components and embed plates.' },
    { to: paths.pours(projectId), title: 'Concrete pours', text: 'Plan pours, group foundations and record what was poured.' },
  ]
  return (
    <>
      <PageHeader title="Setup" description={`Configuration for this project.${server ? '' : ' Changes here are made to demonstration data.'}`} />
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Setup">
        {cards.map((c) => (
          <li key={c.to}><Link to={c.to} className="block rounded-nx border border-line bg-surface p-5 transition-colors hover:border-ink"><span className="block font-medium">{c.title}</span><span className="mt-1 block text-[13px] text-muted">{c.text}</span></Link></li>
        ))}
      </ul>
    </>
  )
}
