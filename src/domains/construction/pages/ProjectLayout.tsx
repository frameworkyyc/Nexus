import { RotateCcw } from 'lucide-react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { NavTabs } from '@/components/ui/Tabs'
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

export function ProjectLayout() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <EmptyState title="Project not found" />
  const company = state.company
  const tabs = [
    { to: paths.project(projectId), label: 'Dashboard', end: true },
    { to: paths.register(projectId), label: 'Foundation register' },
    { to: paths.materials(projectId), label: 'Materials' },
    { to: paths.fabrication(projectId), label: 'Fabrication' },
    { to: paths.anchorage(projectId), label: 'Anchorage types' },
    { to: paths.handover(projectId), label: 'Handover' },
  ]
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <p className="text-[13px] text-muted">
          <span className="font-medium text-ink">{project.name}</span> · Job {project.jobNumber} · {company.name} · {project.location} · {project.scope}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">Demonstration data — fictional, not for construction</span>
          <ResetDemoButton />
        </div>
      </div>
      <NavTabs items={tabs} />
      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]">
        <span className="t-label mr-2">Areas</span>
        {state.areas.map((a) => (
          <NavLink key={a.id} to={paths.area(projectId, a.id)} className={({ isActive }) => `rounded-nx px-2 py-1 transition-colors ${isActive ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink'}`}>
            {a.name}
          </NavLink>
        ))}
      </div>
      <div className="pt-6">
        <Outlet />
      </div>
    </>
  )
}
