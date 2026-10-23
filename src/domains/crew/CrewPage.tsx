import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { MetricSummary, StatusMark } from '@/components/viz'
import { addDays, parseISO } from '@/lib/date'
import { ROTATION } from '@/domains/construction/config'
import { onSite } from '@/domains/construction/selectors'
import { useConstruction } from '@/domains/construction/store'
import type { Crew, Person, PersonRole } from '@/domains/construction/types'

const ROLE_LABEL: Record<PersonRole, string> = { superintendent: 'Superintendent', foreman: 'Foreman', carpenter: 'Carpenter', surveyor: 'Surveyor', 'qc-inspector': 'QC inspector', coordinator: 'Coordinator' }
const ROLE_ORDER: PersonRole[] = ['superintendent', 'foreman', 'carpenter', 'surveyor', 'qc-inspector', 'coordinator']
const DAYS = 21
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
const weekday = (iso: string) => parseISO(iso).toLocaleDateString('en-CA', { weekday: 'narrow' })

/**
 * Crew: who is on site today, manpower, and the rotation calendar, all derived from the crews, people and rotation anchor already in
 * the construction records (nothing is entered or invented here). Rotation is the recorded cycle: 14 days on, 7 off.
 */
export function CrewPage() {
  const { state, today } = useConstruction()
  if (!state.crews.length && !state.people.length) {
    return (
      <>
        <PageHeader title="Crew" description="Rotations, manpower and scheduling." />
        <EmptyState title="No crew records" description="Crews and personnel appear here once they are recorded." />
      </>
    )
  }
  const members = (c: Crew) => state.people.filter((p) => p.crewId === c.id)
  const crewOn = (c: Crew, date: string) => onSite(c.offsetDays, state.rotationAnchor, date)
  const supers = state.people.filter((p) => p.role === 'superintendent' && p.offsetDays !== null)
  const crewsToday = state.crews.filter((c) => crewOn(c, today))
  const supersToday = supers.filter((p) => onSite(p.offsetDays!, state.rotationAnchor, today))
  const manpower = crewsToday.reduce((n, c) => n + members(c).length, 0) + supersToday.length
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i))
  const byRole = ROLE_ORDER.map((role) => ({ role, people: state.people.filter((p) => p.role === role) })).filter((g) => g.people.length)
  const statusOf = (p: Person): boolean | null => (p.crewId ? crewOn(state.crews.find((c) => c.id === p.crewId)!, today) : p.offsetDays !== null ? onSite(p.offsetDays, state.rotationAnchor, today) : null)

  return (
    <>
      <PageHeader title="Crew" description={`Rotation: ${ROTATION.onDays} days on, ${ROTATION.offDays} days off.`} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4" aria-label="Crew summary">
        <MetricSummary label="Crews on site" value={String(crewsToday.length)} sub={`of ${state.crews.length} crews`} />
        <MetricSummary label="Manpower on site" value={String(manpower)} sub="Crew members and superintendents" />
        <MetricSummary label="Superintendents" value={String(supersToday.length)} sub={`on site of ${supers.length}`} />
        <MetricSummary label="Personnel" value={String(state.people.length)} sub="Recorded in total" />
      </div>

      <section className="mt-10" aria-label="Crews today">
        <h2 className="t-title">Crews today</h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {state.crews.map((c) => {
            const on = crewOn(c, today)
            const people = members(c)
            const foreman = people.find((p) => p.role === 'foreman')
            return (
              <li key={c.id} className="rounded-xl bg-surface p-4 shadow-[0_0_0_1px_var(--nx-line)]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[17px] font-medium">{c.name}</h3>
                  <StatusMark status={on ? 'ok' : 'unknown'} label={on ? 'On site' : 'Off rotation'} />
                </div>
                <p className="mt-1 text-[14px] text-muted">{foreman ? `Foreman ${foreman.name}` : 'No foreman recorded'} · {people.length} on crew</p>
                <details className="mt-2">
                  <summary className="flex cursor-pointer items-center text-[14px] text-muted">Crew members</summary>
                  <ul className="mt-1 divide-y divide-line">
                    {people.map((p) => <li key={p.id} className="flex min-h-11 items-center justify-between gap-3 text-[15px]"><span className="min-w-0 truncate">{p.name}</span><span className="shrink-0 text-[13px] text-muted">{ROLE_LABEL[p.role]}</span></li>)}
                  </ul>
                </details>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="mt-10" aria-label="Rotation schedule">
        <h2 className="t-title">Rotation schedule</h2>
        <p className="mt-0.5 text-[14px] text-muted">The next {DAYS} days. Filled = on site.</p>
        {/* Intentional horizontal scroll: a timeline needs its width. The name column stays put. */}
        <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-2" data-compact>
          <table className="border-separate border-spacing-y-1.5 text-[13px]" style={{ minWidth: 120 + DAYS * 30 }}>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-[120px] bg-canvas pr-2 text-left text-[12px] font-medium text-muted">Crew</th>
                {days.map((d, i) => <th key={d} scope="col" className="w-[30px] text-center text-[11px] font-normal text-muted" title={dayLabel(d)}>{i === 0 || parseISO(d).getDate() === 1 ? dayLabel(d).replace(' ', ' ') : weekday(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...state.crews.map((c) => ({ id: c.id, name: c.name, on: (d: string) => crewOn(c, d) })), ...supers.map((p) => ({ id: p.id, name: p.name, on: (d: string) => onSite(p.offsetDays!, state.rotationAnchor, d) }))].map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 z-10 w-[120px] truncate bg-canvas pr-2 text-left text-[14px] font-medium">{r.name}</th>
                  {days.map((d) => { const on = r.on(d); return <td key={d} className="p-0 text-center"><span role="img" aria-label={`${r.name} ${dayLabel(d)}: ${on ? 'on site' : 'off'}`} className={`mx-auto block h-7 w-6 rounded ${on ? 'bg-[var(--nx-ok)]' : 'bg-[var(--nx-track)]'}`} /></td> })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10" aria-label="Personnel">
        <h2 className="t-title">Personnel</h2>
        {byRole.map((g) => (
          <div key={g.role} className="mt-5">
            <h3 className="t-label">{ROLE_LABEL[g.role]}s <span className="text-muted">· {g.people.length}</span></h3>
            <ul className="mt-1 divide-y divide-line border-y border-line">
              {g.people.map((p) => {
                const st = statusOf(p)
                const crew = state.crews.find((c) => c.id === p.crewId)
                return (
                  <li key={p.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <span className="min-w-0"><span className="block truncate text-[16px]">{p.name}</span><span className="block truncate text-[13px] text-muted">{crew ? crew.name : p.role === 'superintendent' ? 'Individual rotation' : 'Not on a crew rotation'}</span></span>
                    {st !== null && <StatusMark status={st ? 'ok' : 'unknown'} label={st ? 'On site' : 'Off'} />}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>
      <p className="mt-8 text-[13px] text-muted">Scheduling of construction activities stays in each project. <Link to="/projects" className="underline underline-offset-4">Open projects</Link></p>
    </>
  )
}
