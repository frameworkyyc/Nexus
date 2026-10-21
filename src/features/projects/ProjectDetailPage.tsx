import { ArrowLeft, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar, StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { ProjectForm } from './ProjectForm'
import { updateProject, useProject } from './store'

const FUTURE_TABS = ['Tasks', 'Workforce', 'Procurement', 'Documents', 'Quality', 'Assets']

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const [editing, setEditing] = useState(false)

  if (!project) {
    return <EmptyState title="Project not found" description="It may have been removed when demo data was reset." action={<Link to="/projects" className="text-[13px] underline underline-offset-4">Back to projects</Link>} />
  }

  const facts = [
    { label: 'Client', value: project.client },
    { label: 'Location', value: project.location },
    { label: 'Start date', value: formatDate(project.startDate) },
    { label: 'Target completion', value: formatDate(project.targetDate) },
  ]

  return (
    <>
      <Link to="/projects" className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.5} />Projects
      </Link>
      <PageHeader
        title={project.name}
        description={project.number}
        actions={<Button onClick={() => setEditing(true)}><Pencil size={14} strokeWidth={1.5} />Edit</Button>}
      />

      <dl className="grid grid-cols-1 gap-x-8 gap-y-6 border-y border-line py-6 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="t-label">{f.label}</dt>
            <dd className="mt-1.5">{f.value}</dd>
          </div>
        ))}
        <div>
          <dt className="t-label">Status</dt>
          <dd className="mt-1.5"><StatusBadge status={project.status} /></dd>
        </div>
        <div>
          <dt className="t-label">Progress</dt>
          <dd className="mt-1.5"><ProgressBar value={project.progress} /></dd>
        </div>
      </dl>

      <section className="mt-10 max-w-2xl">
        <h2 className="t-label mb-2">Description</h2>
        <p className="leading-relaxed">{project.description || <span className="text-muted">No description.</span>}</p>
      </section>

      <div className="mt-14 flex gap-6 overflow-x-auto border-b border-line" role="tablist" aria-label="Project sections">
        {FUTURE_TABS.map((t) => (
          <button
            key={t} role="tab" aria-disabled="true" disabled
            title={`${t} is planned — coming soon`}
            className="flex shrink-0 items-center gap-1.5 pb-3 text-[13px] text-neutral-400"
          >
            {t}<Lock size={11} strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Project sections are planned for future releases.</p>

      {editing && (
        <Modal title="Edit project" onClose={() => setEditing(false)}>
          <ProjectForm
            initial={project}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={(value) => { updateProject(project.id, value); setEditing(false) }}
          />
        </Modal>
      )}
    </>
  )
}
