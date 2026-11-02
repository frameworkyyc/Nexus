import { Link, useParams } from 'react-router-dom'
import { Disclosure } from '@/components/ui/Disclosure'
import { Section } from '@/components/ui/Section'
import { PROGRESS_BASIS } from '../config'
import { deriveExceptions } from '../exceptions'
import { paths } from '../paths'
import { basisFigures, basisWarning, completionOf } from '../completionBasis'
import { areaStatus, foundationsOfProject, foundationsOf } from '../selectors'
import { useConstruction, useRun } from '../store'
import { ExceptionList } from '../ui'
import { StatusEditor } from '../StatusEditor'
import { BasisFigures, CompletionBasisSelector, percentText, useCompletionBasis } from './CompletionBasis'
import { Input, Select, Textarea } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { setProjectIssueStatus, addProjectIssue, setReportedProgress } from '../actions'
import { useState } from 'react'
import { formatShortDate } from '@/lib/format'
import { EditProjectButton, GettingStarted } from './Setup'
import { useAccess } from '@/lib/access'
import { PackageDashboard } from './PackageDashboard'
import { FoundationRegister } from './FoundationRegister'
import { implicitAreaOf } from '../projectActions'
import { useProjectConfig } from '../useProjectConfig'

/** Project Settings, for administrators. */
function ProjectSettingsLink({ projectId }: { projectId: string }) {
  const access = useAccess()
  if (!access.can('structure.manage')) return null
  return <Link to={paths.settings(projectId)} className="inline-flex h-9 items-center rounded-nx border border-line px-4 text-[13px] font-medium hover:border-ink">Project settings</Link>
}

function ProjectHeader({ projectId }: { projectId: string }) {
  const { state } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId)!
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="t-display">{project.name}</h1>
        <p className="mt-1 text-[13px] text-muted">{[project.jobNumber && `Job ${project.jobNumber}`, state.company.name, project.scope].filter(Boolean).join(' · ')}</p>
        <p className="text-[13px] text-muted">{[project.location, project.client && `Client: ${project.client}`].filter(Boolean).join(' · ')}</p>
        {project.description && <p className="mt-2 max-w-2xl text-[13px]">{project.description}</p>}
        {(project.startDate || project.endDate) && <p className="mt-1 text-xs text-muted">{[project.startDate && `Starts ${formatShortDate(project.startDate)}`, project.endDate && `Expected completion ${formatShortDate(project.endDate)}`].filter(Boolean).join(' · ')}</p>}
      </div>
      <div className="flex flex-wrap gap-2"><EditProjectButton projectId={projectId} /><ProjectSettingsLink projectId={projectId} /></div>
    </header>
  )
}

/** Level 2 of 4 (detailed projects): overall progress, progress and status by area, significant issues. */
export function ProjectDashboard() {
  const { projectId = '' } = useParams()
  const { state, idx, today } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId)!
  const [basis] = useCompletionBasis()
  const cfg = useProjectConfig(projectId)
  const hidden = implicitAreaOf(state, projectId)
  const overall = completionOf(idx, foundationsOfProject(idx, projectId), basis)
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived && !a.implicit).map((area) => ({ area, progress: completionOf(idx, foundationsOf(idx, area.id), basis), status: areaStatus(idx, area.id) }))
  const exceptions = deriveExceptions(idx, today, projectId)
  const critical = exceptions.filter((e) => e.severity === 'high').length

  // Nothing is tracked until foundations exist: show what to do next instead of 0% bars and empty lists.
  if (foundationsOfProject(idx, projectId).length === 0) {
    return (
      <>
        <ProjectHeader projectId={projectId} />
        <dl className="mt-8 grid grid-cols-1 border-y border-line sm:grid-cols-2 sm:divide-x sm:divide-line">
          <div className="py-6 sm:pr-8"><dt className="t-label">Progress</dt><dd className="mt-2 text-[15px] text-muted">Not tracked yet — add foundations to start.</dd></div>
          <div className="border-t border-line py-6 sm:border-t-0 sm:pl-8"><dt className="t-label mb-2">Status</dt><dd><StatusEditor project={project} /></dd></div>
        </dl>
        <GettingStarted projectId={projectId} />
      </>
    )
  }

  return (
    <>
      <ProjectHeader projectId={projectId} />

      <CompletionBasisSelector className="mt-8" />
      <dl className="mt-4 grid grid-cols-1 border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
        <div className="py-6 sm:pr-8">
          <dt className="t-label">Overall progress</dt>
          <dd className="t-metric mt-2">{percentText(overall)}{overall.percent !== null && <span className="text-2xl text-muted">%</span>}</dd>
          <div className="mt-3 h-px bg-line" role="progressbar" aria-label="Overall progress" aria-valuenow={overall.percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            <div className="-mt-px h-0.5 bg-ink" style={{ width: `${overall.percent ?? 0}%` }} />
          </div>
          <BasisFigures result={overall} className="mt-2" />
        </div>
        <div className="border-t border-line py-6 sm:border-t-0 sm:px-8">
          <dt className="t-label mb-2">Status</dt>
          <dd><StatusEditor project={project} /></dd>
        </div>
        <div className="border-t border-line py-6 sm:border-t-0 sm:pl-8">
          <dt className="t-label">Critical issues</dt>
          <dd className="t-metric mt-2">{critical}</dd>
        </div>
      </dl>

      {!cfg.usesAreas && hidden ? (
        <>
          <Section title="Project progress"><PackageDashboard idx={idx} projectId={projectId} areaId={hidden.id} /></Section>
          <Section title="Foundations"><FoundationRegister projectId={projectId} /></Section>
        </>
      ) : (
      <Section title="Progress by area">
        <ul className="border-t border-line">
          {areas.map(({ area, progress, status }) => (
            <li key={area.id} className="border-b border-line">
              <Link to={paths.area(projectId, area.id)} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-x-4 py-4 transition-colors hover:bg-hover sm:grid-cols-[12rem_minmax(0,1fr)_4rem] sm:gap-x-6">
                <span>
                  <span className="block text-[13px] font-medium">{area.name}</span>
                  <span className="block text-xs text-muted">{status.label}</span>
                  <span className="mt-0.5 block text-xs tabular-nums text-muted">{basisFigures(progress)}</span>
                </span>
                <span className="h-3 bg-line" role="progressbar" aria-label={`${area.name} progress`} aria-valuenow={progress.percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full bg-ink transition-[width]" style={{ width: `${progress.percent ?? 0}%` }} />
                </span>
                <span className="text-right text-xl font-light tabular-nums tracking-tight">{percentText(progress)}{progress.percent !== null && '%'}{progress.missing && <span className="text-xs text-muted" title={basisWarning(progress) ?? ''} aria-label={basisWarning(progress) ?? ''}> *</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      )}

      <Section title="Needs attention" actions={<Link to={paths.issues(projectId)} className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">All issues</Link>}>
        <ExceptionList items={exceptions} />
      </Section>

      <div className="mt-12 border-t border-line">
        <Disclosure summary={<span className="text-xs text-muted">How progress is calculated</span>}>
          <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            {PROGRESS_BASIS.map((line) => <li key={line}>{line}</li>)}
            <li>The Completion basis selector changes only how elements are weighted: by element (the default, as described above), by how many individual foundations each type represents, or by concrete volume. Where concrete has been recorded as poured, count and volume credit what was actually placed.</li>
          </ul>
        </Disclosure>
      </div>
    </>
  )
}

/** A project without activity-level tracking: recorded status, reported progress and recorded issues only. */
export function SummaryProject() {
  const { projectId = '' } = useParams()
  const { state, today } = useConstruction()
  const run = useRun()
  const project = state.projects.find((p) => p.id === projectId)!
  const issues = state.projectIssues.filter((i) => i.projectId === projectId)
  const open = issues.filter((i) => i.status === 'open')
  const [progress, setProgress] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<'critical' | 'moderate'>('moderate')
  const value = project.reportedProgress ?? 0

  return (
    <>
      <ProjectHeader projectId={projectId} />
      <dl className="mt-8 grid grid-cols-1 border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
        <div className="py-6 sm:pr-8">
          <dt className="t-label">Reported progress</dt>
          <dd className="t-metric mt-2">{value}<span className="text-2xl text-muted">%</span></dd>
          <div className="mt-3 h-px bg-line"><div className="-mt-px h-0.5 bg-ink" style={{ width: `${value}%` }} /></div>
          <div className="mt-3 flex items-center gap-2">
            <Input className="h-8 w-20" type="number" min={0} max={100} aria-label="Reported progress" value={progress ?? value} onChange={(e) => setProgress(e.target.value)} />
            <Button className="h-8" disabled={progress === null} onClick={() => run(setReportedProgress(projectId, Number(progress))) === null && setProgress(null)}>Update</Button>
          </div>
        </div>
        <div className="border-t border-line py-6 sm:border-t-0 sm:px-8"><dt className="t-label mb-2">Status</dt><dd><StatusEditor project={project} /></dd></div>
        <div className="border-t border-line py-6 sm:border-t-0 sm:pl-8"><dt className="t-label">Open issues</dt><dd className="t-metric mt-2">{open.length}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-muted">Detailed activity tracking is not set up for this project. Progress is a figure reported by the project team; status is recorded, not calculated.</p>

      <Section title="Issues">
        <ul className="border-t border-line">
          {issues.map((i) => (
            <li key={i.id} className="flex items-start gap-3 border-b border-line py-3">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i.status === 'closed' ? 'bg-neutral-300' : i.severity === 'critical' ? 'bg-bad' : 'bg-warn'}`} />
              <span className={`min-w-0 flex-1 text-[13px] ${i.status === 'closed' ? 'text-muted line-through' : ''}`}>{i.title}<span className="block text-xs text-muted no-underline">{i.severity} · recorded {formatShortDate(i.recorded)}</span></span>
              <button className="shrink-0 text-xs text-muted hover:text-ink" onClick={() => run(setProjectIssueStatus(i.id, i.status === 'open' ? 'closed' : 'open'))}>{i.status === 'open' ? 'Close' : 'Reopen'}</button>
            </li>
          ))}
          {!issues.length && <li className="border-b border-line py-4 text-[13px] text-muted">No issues recorded.</li>}
        </ul>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (run(addProjectIssue(projectId, title, severity, today)) === null) setTitle('') }}>
          <Textarea rows={1} className="max-w-md" placeholder="Record an issue" aria-label="Issue description" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select className="w-32" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as 'critical' | 'moderate')}><option value="moderate">Moderate</option><option value="critical">Critical</option></Select>
          <Button type="submit">Add</Button>
        </form>
      </Section>
    </>
  )
}

export function ProjectHome() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  return state.projects.find((p) => p.id === projectId)?.tracking === 'summary' ? <SummaryProject /> : <ProjectDashboard />
}
