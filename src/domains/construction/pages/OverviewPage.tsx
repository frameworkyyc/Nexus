import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { Button } from '@/components/ui/Button'
import { companyIssues } from '../portfolio'
import { portfolioCounts } from '../selectors'
import { useConstruction } from '../store'
import { ProjectPortfolio } from './ProjectPortfolio'

const dot = { high: 'bg-bad', medium: 'bg-warn' }

/** Level 1 of 4: Company → Project → Area → Foundation. Project-level information only. */
export function OverviewPage() {
  const { state, idx, today } = useConstruction()
  const [shown, setShown] = useState(6)
  const counts = portfolioCounts(state.projects)
  const issues = companyIssues(idx, today)
  return (
    <>
      <PageHeader title="Overview" description={state.company.name} />
      <dl className="grid grid-cols-3 border-y border-line divide-x divide-line [&>div]:py-6 [&>div]:px-4 sm:[&>div]:px-8 [&>div:first-child]:pl-0">
        <Stat label="Active projects" value={counts.active} />
        <Stat label="At risk" value={counts.atRisk} />
        <Stat label="Delayed" value={counts.delayed} />
      </dl>

      <Section title="Projects">
        <ProjectPortfolio pageSize={10} />
      </Section>

      <Section title="Needs attention" description="Recorded project status and issues, plus critical items derived from detailed projects.">
        {issues.length ? (
          <ul className="border-t border-line">
            {issues.slice(0, shown).map((i) => (
              <li key={i.id} className="border-b border-line">
                <Link to={i.to} className="flex items-start gap-3 py-3 transition-colors hover:bg-hover">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot[i.severity]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{i.title}</span>
                    <span className="block text-xs text-muted">{i.project}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{i.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line py-6 text-[13px] text-muted">Nothing needs attention.</p>
        )}
        {issues.length > shown && <div className="mt-4 flex justify-center"><Button onClick={() => setShown(shown + 10)}>Show more ({issues.length - shown})</Button></div>}
      </Section>
    </>
  )
}

export function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" />
      <ProjectPortfolio pageSize={25} />
    </>
  )
}
