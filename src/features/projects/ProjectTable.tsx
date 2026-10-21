import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ProgressBar, StatusBadge } from '@/components/ui/StatusBadge'
import type { Project } from './types'

const columns: Column<Project>[] = [
  { key: 'number', header: 'No.', render: (p) => <span className="font-mono text-xs text-muted">{p.number}</span> },
  { key: 'name', header: 'Project', render: (p) => <span className="font-medium">{p.name}</span> },
  { key: 'client', header: 'Client', hideOnMobile: true, render: (p) => <span className="text-muted">{p.client}</span> },
  { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  { key: 'progress', header: 'Progress', hideOnMobile: true, render: (p) => <ProgressBar value={p.progress} /> },
]

export function ProjectTable({ projects }: { projects: Project[] }) {
  const navigate = useNavigate()
  return <DataTable columns={columns} rows={projects} getKey={(p) => p.id} onRowClick={(p) => navigate(`/projects/${p.id}`)} />
}
