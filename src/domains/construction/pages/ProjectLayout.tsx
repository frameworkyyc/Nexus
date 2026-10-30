import { identity } from '@/app/identity'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { RotateCcw } from 'lucide-react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ChipTabs } from '@/components/mobile/Cards'
import { NavMenu } from '@/components/ui/Menu'
import { paths } from '../paths'
import { useIsServer } from '@/lib/dataSource'
import { resetDemoData, useConstruction } from '../store'

export function ResetDemoButton() {
  const reset = () => {
    if (window.confirm(`Reset all ${identity.trackerName} demonstration data to its original state? Your edits will be lost.`)) resetDemoData()
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
 * One navigation row: Overview · Areas ▾ · Register · Materials · Fabrication · Anchorage · Handover · Fleet.
 * Areas live in a menu (not a second row); full labels appear when there is room.
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const server = useIsServer()
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
  const allSections = [
    { to: paths.project(projectId), full: `${project.name} overview`, short: 'Overview', end: true },
    { to: paths.register(projectId), full: 'Foundation register', short: 'Register' },
    { to: paths.materials(projectId), full: 'Materials', short: 'Materials' },
    ...(IS_PUBLIC_DEMO ? [] : [{ to: paths.procurement(projectId), full: 'Procurement', short: 'Procurement' }]),
    { to: paths.pours(projectId), full: 'Concrete pours', short: 'Pours' },
    { to: paths.fabrication(projectId), full: 'Fabrication', short: 'Fabrication' },
    { to: paths.anchorage(projectId), full: 'Anchorage types', short: 'Anchorage' },
    { to: paths.handover(projectId), full: 'Handover', short: 'Handover' },
    { to: paths.fleet(projectId), full: 'Fleet', short: 'Fleet' },
  ]
  // Procurement, fabrication and handover have no saved records yet, so saved-data mode leaves them out rather than showing fiction.
  const sections = server ? allSections.filter((x) => ![paths.fabrication(projectId), paths.handover(projectId)].includes(x.to)) : allSections
  const areaItems = state.areas.filter((a) => a.projectId === projectId && !a.archived).map((a) => ({ to: paths.area(projectId, a.id), label: a.name }))
  const link = (s: (typeof sections)[number]) => (
    <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `${tab} ${isActive ? on : off}`}>
      <span className="hidden lg:inline">{s.full}</span>
      <span className="lg:hidden">{s.short}</span>
    </NavLink>
  )
  return (
    <>
      {/* Phones: one menu holds every destination. */}
      <div className="md:hidden">
        <ChipTabs label="Project sections">
          {([...sections.map((s) => ({ to: s.to, label: s.short, end: !!s.end })), ...areaItems.map((a) => ({ to: a.to, label: a.label, end: false }))]).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-[15px] font-medium ${isActive ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink'}`}>{i.label}</NavLink>
          ))}
        </ChipTabs>
      </div>
      <nav aria-label="Project sections" className="hidden gap-6 border-b border-line md:flex">
        {link(sections[0])}
        {areaItems.length ? <NavMenu label={currentArea ? currentArea.name : 'Areas'} active={!!currentArea} items={areaItems} /> : <NavLink to={paths.register(projectId)} className={`${tab} ${off}`}>Areas</NavLink>}
        {sections.slice(1).map(link)}
      </nav>
      <div className="pt-8">
        <Outlet />
      </div>
      <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {server ? <p className="text-xs text-muted">Saved project data. Changes are stored on the server and shown on every device.</p> : <p className="text-xs text-muted">Demonstration data — fictional records, not for construction.</p>}
        {!server && <ResetDemoButton />}
      </footer>
    </>
  )
}
