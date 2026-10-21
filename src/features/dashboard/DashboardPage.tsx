import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { isWithinDays } from '@/lib/format'
import { ProjectTable } from '@/features/projects/ProjectTable'
import { useProjects } from '@/features/projects/store'
import { ACTIVITY } from './activity'

export function DashboardPage() {
  const projects = useProjects()
  const active = projects.filter((p) => p.status === 'active').length
  const upcoming = projects.filter((p) => p.status !== 'completed' && isWithinDays(p.targetDate, 90)).length

  const metrics = [
    { label: 'Active projects', value: active },
    { label: 'Total projects', value: projects.length },
    { label: 'Upcoming milestones', value: upcoming, hint: 'Completions due within 90 days' },
  ]

  return (
    <>
      <PageHeader title="Overview" description="A central view of your projects and operations." />

      <dl className="grid grid-cols-1 border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
        {metrics.map((m, i) => (
          <div key={m.label} className={`py-6 sm:px-8 ${i === 0 ? 'sm:pl-0' : ''} ${i > 0 ? 'border-t border-line sm:border-t-0' : ''}`}>
            <dt className="t-label">{m.label}</dt>
            <dd className="t-metric mt-2">{m.value}</dd>
            {m.hint && <p className="mt-1 text-xs text-muted">{m.hint}</p>}
          </div>
        ))}
      </dl>

      <section className="mt-14">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="t-title">Projects</h2>
          <Link to="/projects" className="text-[13px] text-muted underline-offset-4 transition-colors hover:text-ink hover:underline">
            View all projects
          </Link>
        </div>
        <ProjectTable projects={projects} />
      </section>

      <section className="mt-14">
        <h2 className="t-title mb-2">Recent activity</h2>
        <ul>
          {ACTIVITY.map((a) => {
            const project = projects.find((p) => p.id === a.projectId)
            return (
              <li key={a.id} className="flex items-baseline justify-between gap-6 border-b border-line py-3.5 text-[13px]">
                <div>
                  <span>{a.text}</span>
                  {project && (
                    <Link to={`/projects/${project.id}`} className="ml-2 text-muted transition-colors hover:text-ink">
                      {project.number}
                    </Link>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted">{a.when}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
