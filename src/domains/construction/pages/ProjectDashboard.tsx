import { Link, useParams } from 'react-router-dom'
import { Disclosure } from '@/components/ui/Disclosure'
import { Section } from '@/components/ui/Section'
import { HANDOVER_PHASES, PROGRESS_BASIS } from '../config'
import { deriveExceptions } from '../exceptions'
import { paths } from '../paths'
import { computeStats, evaluateHandover, foundationsOf, phaseIndex } from '../selectors'
import { useConstruction } from '../store'

const dot = { high: 'bg-bad', medium: 'bg-warn' }

export function ProjectDashboard() {
  const { projectId = '' } = useParams()
  const { state, idx, today } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId)!
  const overall = computeStats(idx, state.foundations)
  const areas = state.areas.map((area) => ({ area, progress: computeStats(idx, foundationsOf(idx, area.id)).progress, ev: evaluateHandover(idx, area.id) }))
  const exceptions = deriveExceptions(idx, today, projectId)
  const critical = exceptions.filter((e) => e.severity === 'high').length
  const handedOver = areas.filter((a) => a.ev.phase === 'handed-over').length

  return (
    <>
      <header>
        <h1 className="t-display">{project.name}</h1>
        <p className="mt-1 text-[13px] text-muted">Job {project.jobNumber} · {state.company.name} · {project.scope}</p>
        <p className="text-[13px] text-muted">{project.location}</p>
      </header>

      <dl className="mt-8 grid grid-cols-1 border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
        <div className="py-6 sm:pr-8">
          <dt className="t-label">Overall progress</dt>
          <dd className="t-metric mt-2">{overall.progress}<span className="text-2xl text-muted">%</span></dd>
          <div className="mt-3 h-px bg-line" role="progressbar" aria-label="Overall progress" aria-valuenow={overall.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="-mt-px h-0.5 bg-ink" style={{ width: `${overall.progress}%` }} />
          </div>
        </div>
        <div className="border-t border-line py-6 sm:border-t-0 sm:px-8">
          <dt className="t-label">Areas handed over</dt>
          <dd className="t-metric mt-2">{handedOver}<span className="text-2xl text-muted"> / {areas.length}</span></dd>
        </div>
        <div className="border-t border-line py-6 sm:border-t-0 sm:pl-8">
          <dt className="t-label">Critical issues</dt>
          <dd className="t-metric mt-2">{critical}</dd>
        </div>
      </dl>

      <Section title="Construction progress by area">
        <ul className="border-t border-line">
          {areas.map(({ area, progress }) => (
            <li key={area.id} className="border-b border-line">
              <Link to={paths.area(projectId, area.id)} className="group grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-x-4 py-5 transition-colors hover:bg-hover sm:grid-cols-[11rem_minmax(0,1fr)_4rem] sm:gap-x-6">
                <span className="text-[13px] font-medium">{area.name}</span>
                <span className="h-3 bg-line" role="progressbar" aria-label={`${area.name} progress`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full bg-ink transition-[width]" style={{ width: `${progress}%` }} />
                </span>
                <span className="text-right text-xl font-light tabular-nums tracking-tight">{progress}%</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid grid-cols-1 gap-x-14 lg:grid-cols-2">
        <Section title="Handover">
          <ul className="border-t border-line">
            {areas.map(({ area, ev }) => {
              const current = phaseIndex(ev.phase)
              return (
                <li key={area.id} className="border-b border-line">
                  <Link to={paths.area(projectId, area.id, 'handover')} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 transition-colors hover:bg-hover sm:flex-nowrap">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{area.name}</span>
                    <span className="order-3 flex w-full gap-0.5 sm:order-none sm:w-auto" aria-hidden>
                      {HANDOVER_PHASES.map((p, i) => <span key={p.id} className={`h-1 flex-1 sm:w-4 sm:flex-none ${i <= current ? 'bg-ink' : 'bg-line'}`} />)}
                    </span>
                    <span className="text-xs text-muted sm:w-40 sm:text-right">{ev.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section title="Needs attention" actions={<Link to={paths.issues(projectId)} className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">All issues</Link>}>
          {exceptions.length ? (
            <ul className="border-t border-line">
              {exceptions.slice(0, 6).map((e) => (
                <li key={e.id} className="border-b border-line">
                  <Link to={e.to} className="flex items-start gap-3 py-3 transition-colors hover:bg-hover">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot[e.severity]}`} title={e.severity === 'high' ? 'Critical' : 'Attention'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{e.title}</span>
                      <span className="block text-xs text-muted">{e.area}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{e.status}</span>
                  </Link>
                </li>
              ))}
              {exceptions.length > 6 && <li className="py-3 text-xs text-muted">+ {exceptions.length - 6} more</li>}
            </ul>
          ) : (
            <p className="border-t border-line py-6 text-[13px] text-muted">Nothing needs attention.</p>
          )}
        </Section>
      </div>

      <div className="mt-12 border-t border-line">
        <Disclosure summary={<span className="text-xs text-muted">How progress is calculated</span>}>
          <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            {PROGRESS_BASIS.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </Disclosure>
      </div>
    </>
  )
}
