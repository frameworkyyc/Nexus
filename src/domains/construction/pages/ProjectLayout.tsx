import { RotateCcw } from 'lucide-react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { NavMenu } from '@/components/ui/Menu'
import { paths } from '../paths'
import { resetDemoData, useConstruction } from '../store'

export function ResetDemoButton() {
  const reset = () => {
    if (window.confirm('Reset all REEF demonstration data to its original state? Your edits will be lost.')) resetDemoData()
  }
  return (
    <Button variant="ghost" onClick={reset} className="h-8 whitespace-nowrap px-2">
      <RotateCcw size={13} strokeWidth={1.5} />
      Reset demo data
    </Button>
  )
}

const tab = 'relative shrink-0 whitespace-nowrap pb-3 text-[13px] transition-colors'
const on = 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-ink'
const off = 'text-muted hover:text-ink'

/**
 * One navigation row: Overview · Areas ▾ · Register · Materials · Fabrication · Anchorage · Handover.
 * Areas live in a menu (not a second row); full labels appear when there is room.
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const { pathname } = useLocation()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <EmptyState title="Project not found" />
  // Summary-tracked projects have no areas or foundations: show the project page only.
  if (project.tracking === 'summary') {
    return (
      <>
        {pathname === paths.project(projectId) ? <Outlet /> : <EmptyState title="No detailed tracking" description="This project does not have areas or foundations set up." />}
        <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <p className="text-xs text-muted">Demonstration data — fictional records.</p>
          <ResetDemoButton />
        </footer>
      </>
    )
  }
  const currentArea = state.areas.find((a) => pathname.includes(`/areas/${a.id}`))
  const sections = [
    { to: paths.project(projectId), full: `${project.name} overview`, short: 'Overview', end: true },
    { to: paths.register(projectId), full: 'Foundation register', short: 'Register' },
    { to: paths.materials(projectId), full: 'Materials', short: 'Materials' },
    { to: paths.fabrication(projectId), full: 'Fabrication', short: 'Fabrication' },
    { to: paths.anchorage(projectId), full: 'Anchorage types', short: 'Anchorage' },
    { to: paths.handover(projectId), full: 'Handover', short: 'Handover' },
  ]
  const areaItems = state.areas.map((a) => ({ to: paths.area(projectId, a.id), label: a.name }))
  const current = currentArea?.name ?? (pathname.endsWith('/issues') ? 'Issues' : sections.find((s) => (s.end ? pathname === s.to : pathname.startsWith(s.to)))?.full ?? `${project.name} overview`)
  const link = (s: (typeof sections)[number]) => (
    <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `${tab} ${isActive ? on : off}`}>
      <span className="hidden lg:inline">{s.full}</span>
      <span className="lg:hidden">{s.short}</span>
    </NavLink>
  )
  return (
    <>
      {/* Phones: one menu holds every destination. */}
      <nav aria-label="Project sections" className="border-b border-line md:hidden">
        <NavMenu label={current} active items={[...sections.map((s) => ({ to: s.to, label: s.full })), ...areaItems.map((i, n) => ({ ...i, divider: n === 0 }))]} />
      </nav>
      <nav aria-label="Project sections" className="hidden gap-6 border-b border-line md:flex">
        {link(sections[0])}
        <NavMenu label={currentArea ? currentArea.name : 'Areas'} active={!!currentArea} items={areaItems} />
        {sections.slice(1).map(link)}
      </nav>
      <div className="pt-8">
        <Outlet />
      </div>
      <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <p className="text-xs text-muted">Demonstration data — fictional records, not for construction.</p>
        <ResetDemoButton />
      </footer>
    </>
  )
}
