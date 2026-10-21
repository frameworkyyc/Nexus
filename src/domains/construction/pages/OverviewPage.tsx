import { Link } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { paths } from '../paths'
import { computeStats, deriveIssues } from '../selectors'
import { useConstruction } from '../store'
import { IssueList } from '../ui'
import type { Project } from '../types'
import { useNavigate } from 'react-router-dom'

export function ProjectsTable() {
  const { state, idx, today } = useConstruction()
  const navigate = useNavigate()
  const issues = deriveIssues(idx, today)
  const columns: Column<Project>[] = [
    { key: 'job', header: 'Job', render: (p) => <span className="font-mono text-xs text-muted">{p.jobNumber}</span> },
    { key: 'name', header: 'Project', render: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'company', header: 'Company', hideOnMobile: true, render: () => <span className="text-muted">{state.company.name}</span> },
    { key: 'loc', header: 'Location', hideOnMobile: true, render: (p) => <span className="text-muted">{p.location}</span> },
    { key: 'scope', header: 'Scope', hideOnMobile: true, render: (p) => <span className="text-muted">{p.scope}</span> },
    { key: 'progress', header: 'Construction progress', render: () => <ProgressBar value={computeStats(idx, state.foundations).progress} /> },
    { key: 'attn', header: 'High priority', render: () => issues.filter((i) => i.severity === 'high').length },
  ]
  return <DataTable columns={columns} rows={state.projects} getKey={(p) => p.id} onRowClick={(p) => navigate(paths.project(p.id))} />
}

export function OverviewPage() {
  const { state, idx, today } = useConstruction()
  const issues = deriveIssues(idx, today)
  const high = issues.filter((i) => i.severity === 'high')
  return (
    <>
      <PageHeader title="Overview" description="A central view of your projects and operations." />
      <dl className="grid grid-cols-1 border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-line [&>div]:py-6 sm:[&>div]:px-8 sm:[&>div:first-child]:pl-0">
        <Stat label="Active projects" value={state.projects.length} />
        <Stat label="Foundations tracked" value={state.foundations.length} sub={`${state.plinths.length} plinths across ${state.areas.length} areas`} />
        <Stat label="High-priority issues" value={high.length} sub="Blocked work, late deliveries, major deficiencies" />
      </dl>
      <Section title="Projects" actions={<Link to="/projects" className="text-[13px] text-muted hover:text-ink hover:underline underline-offset-4">View all projects</Link>}>
        <ProjectsTable />
      </Section>
      <Section title="Needs attention" description="Highest-priority items across all projects.">
        <IssueList issues={issues} limit={6} />
      </Section>
    </>
  )
}

export function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" description="Demonstration data. Edits are saved in this browser only." />
      <ProjectsTable />
    </>
  )
}
