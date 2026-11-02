import { ChevronRight } from 'lucide-react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useProjectContext } from '@/app/projectContext'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { useBackend, useIsServer } from '@/lib/dataSource'
import { useAccess } from '@/lib/access'
import { isProductionEnv } from '@/shared/lock'
import { redirectFor } from '../navigation'
import { paths } from '../paths'
import { foundationsOf } from '../selectors'
import { useConstruction } from '../store'
import { useProjectConfig } from '../useProjectConfig'
import type { ProjectModule } from '../types'
import { MODULES } from '../projectSettings'
import { DISCIPLINES } from '../constructionProgress'
import { DisciplineTracker } from './DisciplineTracker'
import { OverviewPage } from './OverviewPage'

/** Shows a project's page only while its module is switched on; otherwise says so and points to Project Settings. The records are untouched either way. */
export function ModuleGate({ module, children }: { module: ProjectModule; children: React.ReactNode }) {
  const { projectId = '' } = useParams()
  const cfg = useProjectConfig(projectId)
  const access = useAccess()
  if (cfg.project && !cfg.moduleOn(module)) {
    const label = MODULES.find((m) => m.id === module)?.label ?? 'This module'
    return (
      <EmptyState
        title={`${label} is not enabled for this project`}
        description={access.can('structure.manage') ? 'Switch it on in Project Settings. Nothing recorded is lost while it is off.' : 'An administrator can enable it in Project Settings.'}
        action={access.can('structure.manage') ? <Link to={paths.settings(projectId)} className="text-[13px] underline underline-offset-4">Open Project Settings</Link> : undefined}
      />
    )
  }
  return <>{children}</>
}

/** The Areas page of a project that does not use areas: says so instead of listing areas that are not there. */
export function AreasGate({ children }: { children: React.ReactNode }) {
  const { projectId = '' } = useParams()
  const cfg = useProjectConfig(projectId)
  const access = useAccess()
  if (cfg.project && !cfg.usesAreas) {
    return (
      <EmptyState
        title="This project does not use areas"
        description={access.can('structure.manage') ? 'Its foundations belong directly to the project. Switch on Use Project Areas in Project Settings to group them into areas.' : 'Foundations belong directly to the project.'}
        action={access.can('structure.manage') ? <Link to={paths.settings(projectId)} className="text-[13px] underline underline-offset-4">Open Project Settings</Link> : undefined}
      />
    )
  }
  return <>{children}</>
}

/* ── Redirects ────────────────────────────────────────────────────────────── */

/** A path that moved in the navigation redesign: sends the visitor to its new home, keeping any ?tab= style search. */
export function LegacyRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={redirectFor(pathname, search) ?? '/'} replace />
}

/** `/` opens the last-used project's Project Progress. With no project yet it shows the onboarding overview instead. */
export function RootRedirect() {
  const { projectId } = useProjectContext()
  const { environment } = useBackend()
  if (projectId) return <Navigate to={paths.progress(projectId)} replace />
  // Company overview is Coming Soon in production, so someone with no project sees a plain message rather than a locked page.
  if (isProductionEnv(environment)) return <EmptyState title="No projects yet" description="You haven’t been given access to a project. Ask an administrator to add you to one." />
  return <OverviewPage />
}

/** A project-less path (the old global /procurement) goes to the same page of the project in context, or to the project list. */
export function ProjectContextRedirect({ to }: { to: (projectId: string) => string }) {
  const { projectId } = useProjectContext()
  return <Navigate to={projectId ? to(projectId) : '/projects'} replace />
}

/* ── Operational pages ────────────────────────────────────────────────────── */

/** Construction, Survey, QA/QC and Civil / Earthworks: one tracker page for each, behind the same area selector (All areas first). */
export function ManageDiscipline({ kind }: { kind: 'construction' | 'survey' | 'qaqc' | 'civil' }) {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const [params, setParams] = useSearchParams()
  const cfg = useProjectConfig(projectId)
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived).sort((a, b) => a.sequence - b.sequence)
  // Every tracker offers All areas (the project-wide view) as its first choice and opens on it. A project without areas is always the project-wide view.
  const allAreas = areas.length > 0 && (!cfg.usesAreas || params.get('area') === 'all' || !areas.some((a) => a.id === params.get('area')))
  const area = allAreas ? undefined : areas.find((a) => a.id === params.get('area')) ?? areas[0]
  const title = DISCIPLINES[kind].title
  if (areas.length === 0 || (!area && !allAreas)) return <><PageHeader title={title} /><EmptyState title="No areas yet" description="Add an area in Setup to record this work." action={<Link to={paths.areas(projectId)} className="text-[13px] underline underline-offset-4">Open Setup → Areas</Link>} /></>
  return (
    <>
      <PageHeader title={title} description={DISCIPLINES[kind].description} />
      {cfg.usesAreas && <div role="group" aria-label="Area" className="mb-6 flex flex-wrap gap-2" data-compact>
        <button type="button" aria-pressed={allAreas} onClick={() => setParams({ area: 'all' })} className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-[13px] transition-colors phone:h-11 phone:text-[15px] ${allAreas ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}>All areas</button>
        {areas.map((a) => (
          <button key={a.id} type="button" aria-pressed={a.id === area?.id} onClick={() => setParams({ area: a.id })}
            className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-[13px] transition-colors phone:h-11 phone:text-[15px] ${a.id === area?.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}>{a.name}</button>
        ))}
      </div>}
      <DisciplineTracker discipline={kind} areaId={area?.id ?? 'all'} areaIds={areas.map((a) => a.id)} />
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
  const cfg = useProjectConfig(projectId)
  const area = areas.find((a) => a.id === params.get('area')) ?? areas[0]
  if (!area) return <><PageHeader title="Foundation Overview" /><EmptyState title="No areas yet" description="Foundations belong to an area. Add an area in Setup first." action={<Link to={paths.areas(projectId)} className="text-[13px] underline underline-offset-4">Open Setup → Areas</Link>} /></>
  const foundations = foundationsOf(idx, area.id).filter((f) => !f.archived)
  return (
    <>
      <PageHeader title="Foundation Overview" description={cfg.usesAreas ? 'Choose an area, then a foundation, to see its full status.' : 'Choose a foundation to see its full status.'} />
      {cfg.usesAreas && <div role="group" aria-label="Area" className="mb-6 flex flex-wrap gap-2" data-compact>
        {areas.map((a) => (
          <button key={a.id} type="button" aria-pressed={a.id === area.id} onClick={() => setParams({ area: a.id })}
            className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-[13px] transition-colors phone:h-11 phone:text-[15px] ${a.id === area.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'}`}>{a.name}</button>
        ))}
      </div>}
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
  const access = useAccess()
  const cfg = useProjectConfig(projectId)
  const cards = [
    ...(access.can('structure.manage') ? [{ to: paths.settings(projectId), title: 'Project settings', text: 'Project information, areas, modules and the construction scope this project includes.' }] : []),
    { to: paths.register(projectId), title: 'Foundations', text: 'Create, edit and configure foundation designations, quantities and anchorage.' },
    ...(cfg.usesAreas ? [{ to: paths.areas(projectId), title: 'Areas', text: 'Add, rename and archive the areas of this project.' }] : []),
    { to: paths.anchorage(projectId), title: 'Anchorage types & library', text: 'Anchorage types, their components and embed plates.' },
    { to: paths.pours(projectId), title: 'Concrete pours', text: 'Plan pours, group foundations and record what was poured.' },
    ...(server && access.can('access.manage') ? [{ to: paths.team(projectId), title: 'Team members', text: 'Invite people, set what they can do, choose their projects and revoke access.' }] : []),
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
