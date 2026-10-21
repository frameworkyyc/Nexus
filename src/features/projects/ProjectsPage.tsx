import { Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProjectForm } from './ProjectForm'
import { ProjectTable } from './ProjectTable'
import { createProject, nextProjectNumber, resetDemoData, useProjects } from './store'
import { STATUSES, STATUS_LABEL, type ProjectInput, type ProjectStatus } from './types'

function blankProject(): ProjectInput {
  return {
    number: nextProjectNumber(), name: '', client: '', location: '', description: '',
    startDate: '', targetDate: '', status: 'planning', progress: 0,
  }
}

export function ProjectsPage() {
  const projects = useProjects()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter(
      (p) =>
        (status === 'all' || p.status === status) &&
        (!q || [p.number, p.name, p.client, p.location].some((f) => f.toLowerCase().includes(q))),
    )
  }, [projects, query, status])

  function reset() {
    if (window.confirm('Reset all projects to the original demonstration data? Your changes will be lost.')) resetDemoData()
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Demonstration data. Changes are saved in this browser only."
        actions={
          <>
            <Button variant="ghost" onClick={reset}><RotateCcw size={14} strokeWidth={1.5} />Reset demo data</Button>
            <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} strokeWidth={1.5} />New project</Button>
          </>
        }
      />

      <div className="mb-2 flex flex-col gap-3 sm:flex-row">
        <Input className="sm:max-w-xs" type="search" placeholder="Search projects" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select className="sm:w-44" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | 'all')}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </div>

      {filtered.length ? (
        <ProjectTable projects={filtered} />
      ) : (
        <EmptyState
          title="No projects found"
          description={projects.length ? 'Try a different search or status filter.' : 'Create a project to get started.'}
          action={!projects.length && <Button variant="primary" onClick={() => setCreating(true)}>New project</Button>}
        />
      )}

      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)}>
          <ProjectForm
            initial={blankProject()}
            submitLabel="Create project"
            onCancel={() => setCreating(false)}
            onSubmit={(value) => { const p = createProject(value); setCreating(false); navigate(`/projects/${p.id}`) }}
          />
        </Modal>
      )}
    </>
  )
}
