import { Check, Circle, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { createOrganization, createProject, updateOrganization, updateProject } from '../commands'
import { PROJECT_STATUS_LABEL } from '../config'
import { paths } from '../paths'
import { constructionStore, useConstruction, useConstructionCommand } from '../store'
import type { ProjectStatus } from '../types'
import { useTracker } from '../tracker/store'
import { useFleet } from '@/domains/fleet/store'
import { fleetPaths } from '@/domains/fleet/paths'

const EMPTY_ORG = { name: '', legalName: '', location: '', contactName: '', contactEmail: '', contactPhone: '', website: '', notes: '' }

function OrganizationFields({ v, set }: { v: typeof EMPTY_ORG; set: (p: Partial<typeof EMPTY_ORG>) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Organization name *"><Input autoFocus autoComplete="organization" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Northline Construction" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name (optional)"><Input value={v.legalName} onChange={(e) => set({ legalName: e.target.value })} /></Field>
        <Field label="Primary location (optional)"><Input autoComplete="address-level2" value={v.location} onChange={(e) => set({ location: e.target.value })} placeholder="City, province or state" /></Field>
        <Field label="Contact name (optional)"><Input autoComplete="name" value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} /></Field>
        <Field label="Contact email (optional)"><Input type="email" autoComplete="email" value={v.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></Field>
        <Field label="Contact phone (optional)"><Input type="tel" autoComplete="tel" value={v.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} /></Field>
        <Field label="Website (optional)"><Input type="url" value={v.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" /></Field>
      </div>
      <Field label="Notes (optional)"><Textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  )
}

/** First screen of a new installation: no organization exists, so the administrator creates it. Nothing is pre-filled or assumed. */
export function OrganizationSetup() {
  const access = useAccess()
  const navigate = useNavigate()
  const { run, saving } = useConstructionCommand()
  const [v, setV] = useState(EMPTY_ORG)
  if (!access.can('structure.manage')) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="t-display">Welcome to Nexus</h1>
        <p className="mt-3 text-muted">{access.role ? 'Your organization has not been set up yet. An administrator needs to create it before anything else can be added.' : 'Your account has no role yet. Ask an administrator to give you access.'}</p>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-2xl py-8 sm:py-14">
      <p className="t-label">Step 1 of 2</p>
      <h1 className="t-display mt-2">Welcome to Nexus</h1>
      <p className="mt-2 text-[15px] text-muted">Set up your organization to get started. Only the name is required; everything else can be added or changed later.</p>
      <form className="mt-8 space-y-6" onSubmit={(e) => { e.preventDefault(); run(createOrganization(v), () => navigate('/')) }}>
        <OrganizationFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} />
        <Button variant="primary" type="submit" disabled={saving || v.name.trim().length < 2}>{saving ? 'Creating…' : 'Create organization'}</Button>
      </form>
      <p className="mt-6 text-xs text-muted">Next you’ll create your first project. You can set up areas, foundations, materials and fleet at your own pace.</p>
    </div>
  )
}

/** Edit organization information. Administrators only. */
export function EditOrganizationButton() {
  const access = useAccess()
  const { state } = useConstruction()
  const [open, setOpen] = useState(false)
  if (!access.can('structure.manage')) return null
  const c = state.company
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit organization</Button>
      {open && <EditOrganization initial={{ name: c.name, legalName: c.legalName ?? '', location: c.location ?? '', contactName: c.contactName ?? '', contactEmail: c.contactEmail ?? '', contactPhone: c.contactPhone ?? '', website: c.website ?? '', notes: c.notes ?? '' }} onClose={() => setOpen(false)} />}
    </>
  )
}
function EditOrganization({ initial, onClose }: { initial: typeof EMPTY_ORG; onClose: () => void }) {
  const { run, saving } = useConstructionCommand()
  const [v, setV] = useState(initial)
  return (
    <Modal title="Organization" onClose={onClose} wide>
      <form className="space-y-5 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); run(updateOrganization(v), onClose) }}>
        <OrganizationFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} />
        <div className="flex gap-2"><Button variant="primary" type="submit" disabled={saving || v.name.trim().length < 2}>{saving ? 'Saving…' : 'Save changes'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}

/** Guided project creation: the essentials first, optional details second. The project starts with no areas, foundations, materials or fleet. */
export function NewProjectButton({ label = 'New project', variant = 'primary' }: { label?: string; variant?: 'primary' | 'secondary' }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('structure.manage')) return null
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />{label}</Button>
      {open && <NewProject onClose={() => setOpen(false)} />}
    </>
  )
}

function NewProject({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { run, saving } = useConstructionCommand()
  const [step, setStep] = useState<1 | 2>(1)
  const [v, setV] = useState({ name: '', jobNumber: '', client: '', location: '', description: '', startDate: '', endDate: '', status: 'planning' as ProjectStatus })
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const create = () => run(createProject({ ...v, startDate: v.startDate || null, endDate: v.endDate || null }), () => {
    const made = constructionStore.get().projects.find((p) => p.name.toLowerCase() === v.name.trim().toLowerCase())
    onClose()
    if (made) navigate(paths.project(made.id))
  })
  return (
    <Modal title="New project" onClose={onClose}>
      <form className="space-y-4 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); if (step === 1) setStep(2); else create() }}>
        <p className="t-label">{step === 1 ? 'Step 1 of 2 · Essentials' : 'Step 2 of 2 · Details (optional)'}</p>
        {step === 1 ? (
          <>
            <Field label="Project name *"><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project number"><Input value={v.jobNumber} onChange={(e) => set({ jobNumber: e.target.value })} /></Field>
              <Field label="Client"><Input value={v.client} onChange={(e) => set({ client: e.target.value })} /></Field>
            </div>
            <Field label="Location"><Input value={v.location} onChange={(e) => set({ location: e.target.value })} /></Field>
          </>
        ) : (
          <>
            <Field label="Description"><Textarea rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start date"><Input type="date" value={v.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
              <Field label="Expected completion"><Input type="date" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
            </div>
            <Field label="Status"><Select aria-label="Status" value={v.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>{(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</Select></Field>
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {step === 2 && <Button onClick={() => setStep(1)}>Back</Button>}
          {step === 1 ? <Button variant="primary" type="submit" disabled={v.name.trim().length < 2}>Next</Button> : <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</Button>}
          {step === 1 && <Button disabled={saving || v.name.trim().length < 2} onClick={create}>{saving ? 'Creating…' : 'Create now'}</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Shown when there are no projects. */
export function NoProjects() {
  const access = useAccess()
  return (
    <EmptyState
      title="No projects yet"
      description={access.can('structure.manage') ? 'Create your first project to start adding areas, foundations, materials and fleet assignments.' : 'No projects have been created yet. An administrator can create one.'}
      action={<NewProjectButton label="Create project" />}
    />
  )
}

/** A project with nothing set up: what to do next, in order, without forcing any of it. */
export function GettingStarted({ projectId }: { projectId: string }) {
  const { state } = useConstruction()
  const { state: tracker } = useTracker()
  const { state: fleet } = useFleet()
  const access = useAccess()
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived)
  const foundations = state.foundations.filter((f) => areas.some((a) => a.id === f.areaId) && !f.archived)
  const anchorage = state.anchorageTypes.filter((t) => (t.projectId ?? projectId) === projectId && !t.archived)
  const materials = tracker.manual.length + tracker.lines.length
  const assigned = fleet.assignments.filter((a) => a.projectId === projectId && !a.endDate).length
  const admin = access.can('structure.manage')
  const steps = [
    { done: areas.length > 0, title: 'Add construction areas', text: 'Areas group a project’s foundations and materials.', to: paths.register(projectId), cta: 'Open Foundations', admin: true },
    { done: foundations.length > 0, title: 'Add foundations', text: 'Add them one at a time, or a whole list at once.', to: paths.register(projectId), cta: 'Add foundations', admin: true },
    { done: anchorage.length > 0, title: 'Set up the anchorage library', text: 'Define anchorage types once; materials and plinths select from them.', to: paths.anchorage(projectId), cta: 'Open the anchorage library', admin: true },
    { done: materials > 0, title: 'Add materials', text: 'Add them manually, in bulk, or import an Excel tracker.', to: paths.materials(projectId), cta: 'Open Materials', admin: false },
    { done: assigned > 0, title: 'Add vehicles and equipment', text: 'Fleet assets belong to the organization and are assigned to projects.', to: fleetPaths.project(projectId), cta: 'Open Fleet', admin: false },
  ]
  return (
    <section className="mt-8" aria-label="Getting started">
      <h2 className="t-title">Get this project set up</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">Nothing has been recorded for this project yet, so there is no progress to show. Work through these at your own pace — none is required before another.</p>
      <ol className="mt-4 border-t border-line">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3 border-b border-line py-4">
            {s.done ? <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ok" aria-label="Done" /> : <Circle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" aria-label="Not done" />}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{i + 1}. {s.title}</p>
              <p className="text-[13px] text-muted">{s.text}{s.admin && !admin ? ' (An administrator does this.)' : ''}</p>
            </div>
            <Link to={s.to} className="shrink-0 text-[13px] underline underline-offset-4 hover:text-ink">{s.cta}</Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Edit a project's details. Administrators only. */
export function EditProjectButton({ projectId }: { projectId: string }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('structure.manage')) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit project</Button>
      {open && <EditProject projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  )
}
function EditProject({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { state } = useConstruction()
  const { run, saving } = useConstructionCommand()
  const p = state.projects.find((x) => x.id === projectId)
  const [v, setV] = useState({ name: p?.name ?? '', jobNumber: p?.jobNumber ?? '', client: p?.client ?? '', location: p?.location ?? '', description: p?.description ?? '', startDate: p?.startDate ?? '', endDate: p?.endDate ?? '', status: (p?.status ?? 'planning') as ProjectStatus })
  const set = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }))
  if (!p) return null
  return (
    <Modal title="Project details" onClose={onClose}>
      <form className="space-y-4 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); run(updateProject(projectId, { ...v, startDate: v.startDate || null, endDate: v.endDate || null }), onClose) }}>
        <Field label="Project name *"><Input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project number"><Input value={v.jobNumber} onChange={(e) => set({ jobNumber: e.target.value })} /></Field>
          <Field label="Client"><Input value={v.client} onChange={(e) => set({ client: e.target.value })} /></Field>
        </div>
        <Field label="Location"><Input value={v.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date"><Input type="date" value={v.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Expected completion"><Input type="date" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
        </div>
        <Field label="Status"><Select aria-label="Status" value={v.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>{(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</Select></Field>
        <div className="flex gap-2"><Button variant="primary" type="submit" disabled={saving || v.name.trim().length < 2}>{saving ? 'Saving…' : 'Save changes'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}
