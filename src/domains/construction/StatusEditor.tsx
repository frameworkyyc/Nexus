import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { setProjectStatus } from './actions'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from './config'
import { useRun } from './store'
import type { Project, ProjectStatus } from './types'

/** Project status is recorded explicitly, with a reason. It is never inferred from completion percentage. */
export function StatusEditor({ project }: { project: Project }) {
  const run = useRun()
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [note, setNote] = useState(project.statusNote)

  if (!editing) {
    return (
      <div>
        <div><StatusBadge tone={PROJECT_STATUS_TONE[project.status]} label={PROJECT_STATUS_LABEL[project.status]} className="text-lg" /></div>
        {project.statusNote && <p className="mt-1 max-w-xs text-xs leading-snug text-muted">{project.statusNote}</p>}
        <button onClick={() => { setStatus(project.status); setNote(project.statusNote); setEditing(true) }} className="mt-2 text-xs text-muted underline-offset-4 hover:text-ink hover:underline">Update status</button>
      </div>
    )
  }
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (run(setProjectStatus(project.id, status, note)) === null) setEditing(false) }}>
      <Select aria-label="Project status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
        {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
      </Select>
      <Input aria-label="Reason for status" placeholder="Reason (required for at risk, delayed, on hold)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2"><Button variant="primary" type="submit" className="h-8">Save</Button><Button variant="ghost" className="h-8" onClick={() => setEditing(false)}>Cancel</Button></div>
    </form>
  )
}
