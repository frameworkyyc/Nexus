import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAccess } from '@/lib/access'
import { archiveProject, deleteProject, updateProject, updateProjectSettings } from '../commands'
import { PROJECT_STATUS_LABEL } from '../config'
import { paths } from '../paths'
import { settingsOf, type ProjectSettingsInput } from '../projectSettings'
import { constructionStore, useConstruction, useConstructionCommand } from '../store'
import type { Project, ProjectStatus } from '../types'
import { ProjectConfigFields } from './ProjectConfigFields'

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section className="space-y-4 border-t border-line pt-6">
    <div><h2 className="t-title">{title}</h2>{hint && <p className="mt-1 max-w-2xl text-[13px] text-muted">{hint}</p>}</div>
    {children}
  </section>
)

/** Project information, areas, modules and construction scope, and archive / delete. Administrators change it; everyone else reads it. */
export function ProjectSettingsPage() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const access = useAccess()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <EmptyState title="Project not found" />
  const admin = access.can('structure.manage')
  return (
    <>
      <PageHeader title="Project settings" description={`${project.name}${project.archived ? ' · Archived' : ''}`} actions={<Link to={paths.setup(projectId)} className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">Back to Setup</Link>} />
      {!admin && <p role="note" className="mb-6 border-l-2 border-warn pl-3 text-[13px]">Only an administrator can change these settings.</p>}
      <div className="max-w-3xl space-y-8">
        <Information project={project} admin={admin} />
        <Configuration project={project} admin={admin} />
        {admin && <Lifecycle project={project} />}
      </div>
    </>
  )
}

function Information({ project, admin }: { project: Project; admin: boolean }) {
  const { run, saving } = useConstructionCommand()
  const initial = { name: project.name, jobNumber: project.jobNumber, client: project.client, location: project.location, scope: project.scope, description: project.description ?? '', startDate: project.startDate ?? '', endDate: project.endDate ?? '', status: project.status }
  const [v, setV] = useState(initial)
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const changed = JSON.stringify(v) !== JSON.stringify(initial)
  return (
    <Section title="Project information">
      <form className="space-y-4 text-[13px]" onSubmit={(e) => { e.preventDefault(); run(updateProject(project.id, { ...v, startDate: v.startDate || null, endDate: v.endDate || null })) }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project name *"><Input disabled={!admin} value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Project number"><Input disabled={!admin} value={v.jobNumber} onChange={(e) => set({ jobNumber: e.target.value })} /></Field>
          <Field label="Client"><Input disabled={!admin} value={v.client} onChange={(e) => set({ client: e.target.value })} /></Field>
          <Field label="Location"><Input disabled={!admin} value={v.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        </div>
        <Field label="Scope (a short summary)"><Input disabled={!admin} value={v.scope} onChange={(e) => set({ scope: e.target.value })} placeholder="e.g. Grouting of pump bases" /></Field>
        <Field label="Description"><Textarea disabled={!admin} rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Start date"><Input disabled={!admin} type="date" value={v.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Expected completion"><Input disabled={!admin} type="date" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
          <Field label="Status"><Select aria-label="Status" disabled={!admin} value={v.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>{(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</Select></Field>
        </div>
        {admin && <Button variant="primary" type="submit" disabled={saving || !changed || v.name.trim().length < 2}>{saving ? 'Saving…' : 'Save information'}</Button>}
      </form>
    </Section>
  )
}

function Configuration({ project, admin }: { project: Project; admin: boolean }) {
  const { state } = useConstruction()
  const { run, saving } = useConstructionCommand()
  const initial = settingsOf(project)
  const [v, setV] = useState<ProjectSettingsInput>(initial)
  const [error, setError] = useState('')
  const changed = JSON.stringify(v) !== JSON.stringify(initial)
  const hasRecords = state.foundations.some((f) => state.areas.some((a) => a.id === f.areaId && a.projectId === project.id))
  const save = () => {
    setError('')
    const patch = { useAreas: v.useAreas, modules: v.modules, scopeItems: v.scopeItems }
    const problem = updateProjectSettingsProblem(project.id, patch)
    if (problem) { setError(problem); return }
    run(updateProjectSettings(project.id, patch))
  }
  return (
    <Section title="Areas, modules and scope" hint="What this project includes. Changing it never deletes a record: anything switched off is hidden and left out of progress, and comes back when switched on.">
      <ProjectConfigFields value={v} onChange={setV} disabled={!admin} />
      {error && <p role="alert" className="border-l-2 border-bad pl-3 text-[13px]">{error}</p>}
      {hasRecords && changed && <p role="note" className="text-xs text-muted">This project already has records. Progress is recalculated from the activities that remain in scope; nothing is marked complete or removed.</p>}
      {admin && <Button variant="primary" disabled={saving || !changed} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</Button>}
    </Section>
  )
}

/** The reason the change would be refused, checked against the data in view (the server checks again). */
function updateProjectSettingsProblem(projectId: string, patch: { useAreas: boolean; modules: ProjectSettingsInput['modules']; scopeItems: ProjectSettingsInput['scopeItems'] }): string | null {
  const r = updateProjectSettings(projectId, patch)(constructionStore.get())
  return r.error ?? null
}

function Lifecycle({ project }: { project: Project }) {
  const navigate = useNavigate()
  const { run, saving } = useConstructionCommand()
  const [confirm, setConfirm] = useState(false)
  return (
    <Section title={project.archived ? 'Archived project' : 'Archive'} hint={project.archived ? 'This project is hidden from the lists and the project switcher. Restore it to use it again.' : 'Archiving hides the project from the lists and the project switcher. Every record is kept and it can be restored at any time.'}>
      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={() => run(archiveProject(project.id, !project.archived))}>{project.archived ? 'Restore project' : 'Archive project'}</Button>
        {project.archived && <Button variant="ghost" className="text-bad" onClick={() => setConfirm(true)}>Delete permanently…</Button>}
      </div>
      {confirm && <DeleteProject project={project} onClose={() => setConfirm(false)} onDeleted={() => navigate('/projects')} />}
    </Section>
  )
}

/** Permanent deletion of an archived project: the name must be typed, and the server refuses it while procurement records or fleet assignments still belong to the project. */
export function DeleteProject({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted: () => void }) {
  const { run, saving } = useConstructionCommand()
  const { state } = useConstruction()
  const [typed, setTyped] = useState('')
  const areas = new Set(state.areas.filter((a) => a.projectId === project.id).map((a) => a.id))
  const foundations = state.foundations.filter((f) => areas.has(f.areaId)).length
  return (
    <Modal title="Delete project permanently" onClose={onClose}>
      <form className="space-y-4 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); run(deleteProject(project.id, typed), () => { onClose(); onDeleted() }) }}>
        <p role="alert" className="border-l-2 border-bad pl-3">This permanently deletes <span className="font-medium">{project.name}</span>, its {foundations.toLocaleString('en-CA')} foundation name{foundations === 1 ? '' : 's'}, activity records, anchorage library and pours. It cannot be undone. Archive keeps everything instead.</p>
        <Field label={`Type the project name to confirm`}><Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Project name confirmation" /></Field>
        <div className="flex gap-2"><Button variant="primary" type="submit" disabled={saving || typed.trim() !== project.name}>{saving ? 'Deleting…' : 'Delete project'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}
