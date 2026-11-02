import { MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CARD } from '@/components/mobile/Cards'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { useAccess } from '@/lib/access'
import { archiveProject } from '../commands'
import { completionOf } from '../completionBasis'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from '../config'
import { deriveExceptions } from '../exceptions'
import { paths } from '../paths'
import { PROJECT_TEMPLATES } from '../projectSettings'
import { foundationsOfProject, projectSummaries, type ProjectSummary } from '../selectors'
import { useConstruction, useConstructionCommand } from '../store'
import { DeleteProject } from './ProjectSettings'
import { NewProjectButton, NoProjects } from './Setup'

type Filter = 'active' | 'completed' | 'archived'
const FILTERS: { id: Filter; label: string }[] = [{ id: 'active', label: 'Active' }, { id: 'completed', label: 'Completed' }, { id: 'archived', label: 'Archived' }]
/** Archived projects are only in Archived; a completed one is in Completed; everything else (planning, active, at risk, delayed, on hold) is Active. */
const filterOf = (r: ProjectSummary): Filter => (r.project.archived ? 'archived' : r.project.status === 'complete' ? 'completed' : 'active')

/** Every project in one place: find it, open it, change its settings, archive or restore it, and (administrators, once archived) delete it. */
export function ProjectsDashboard() {
  const { state, idx, today } = useConstruction()
  const access = useAccess()
  const navigate = useNavigate()
  const { run, saving } = useConstructionCommand()
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const admin = access.can('structure.manage')
  // The default completion basis (each foundation type counts once): the figure the project's own dashboard opens with.
  const all = useMemo(() => projectSummaries(idx, (id) => deriveExceptions(idx, today, id)).map((r) => (r.progressSource === 'derived' ? { ...r, progress: completionOf(idx, foundationsOfProject(idx, r.project.id), 'type').percent ?? 0 } : r)), [idx, today])
  const counts = (f: Filter) => all.filter((r) => filterOf(r) === f).length
  const q = query.trim().toLowerCase()
  const rows = all.filter((r) => filterOf(r) === filter).filter((r) => !q || [r.project.name, r.project.jobNumber, r.project.client, r.project.location, r.project.scope, r.project.description ?? ''].some((x) => x.toLowerCase().includes(q))).sort((a, b) => a.project.name.localeCompare(b.project.name))
  if (state.projects.length === 0) return <><PageHeader title="Projects" actions={<NewProjectButton />} /><NoProjects /></>
  const hasFoundations = (id: string) => foundationsOfProject(idx, id).length > 0
  const deletable = state.projects.find((p) => p.id === deleting)
  return (
    <>
      <PageHeader title="Projects" description="Open a project, change what it includes, or archive it." actions={<NewProjectButton />} />
      <Tabs<Filter> items={FILTERS.map((f) => ({ ...f, count: counts(f.id) }))} value={filter} onChange={setFilter} />
      <div className="mt-4 mb-5"><Input data-search className="sm:max-w-xs" type="search" placeholder="Search name, number, client, scope" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      {rows.length === 0 ? (
        <EmptyState title={q ? 'No projects match' : `No ${filter} projects`} description={q ? 'Adjust the search.' : filter === 'archived' ? 'Archived projects appear here and can be restored.' : filter === 'completed' ? 'Projects with the status Complete appear here.' : undefined} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={`${filter} projects`}>
          {rows.map((r) => {
            const p = r.project
            const template = PROJECT_TEMPLATES.find((t) => t.id === (p.template ?? 'full-concrete'))
            return (
              <li key={p.id} className={`${CARD} flex flex-col p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <Link to={paths.project(p.id)} className="min-w-0 text-[16px] font-medium leading-snug underline-offset-4 hover:underline">{p.name}</Link>
                  <StatusBadge tone={PROJECT_STATUS_TONE[p.status]} label={PROJECT_STATUS_LABEL[p.status]} className="shrink-0" />
                </div>
                <p className="mt-1 text-xs text-muted">{[p.jobNumber && `Job ${p.jobNumber}`, p.client, p.location].filter(Boolean).join(' · ') || 'No job details'}</p>
                {p.description && <p className="mt-3 line-clamp-2 text-[13px]">{p.description}</p>}
                <dl className="mt-3 space-y-1 text-xs">
                  <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted">Scope</dt><dd className="min-w-0">{p.scope || template?.label || 'Not described'}</dd></div>
                </dl>
                <div className="mt-4">
                  {p.tracking === 'detailed' && !hasFoundations(p.id) ? <span className="text-xs text-muted">Progress not tracked yet</span> : <ProgressBar value={r.progress} width="w-full" />}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <Button variant="primary" className="h-8 px-3 text-xs" onClick={() => navigate(paths.project(p.id))}>Open</Button>
                  {admin && <Button className="h-8 px-3 text-xs" onClick={() => navigate(paths.settings(p.id))}>Settings</Button>}
                  {admin && <Button variant="ghost" className="h-8 px-3 text-xs" disabled={saving} onClick={() => run(archiveProject(p.id, !p.archived))}>{p.archived ? 'Restore' : 'Archive'}</Button>}
                  {admin && p.archived && <Button variant="ghost" className="ml-auto h-8 px-3 text-xs text-bad" aria-label={`Delete ${p.name} permanently`} onClick={() => setDeleting(p.id)}><MoreHorizontal size={14} strokeWidth={1.5} aria-hidden />Delete…</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {deletable && <DeleteProject project={deletable} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />}
    </>
  )
}
