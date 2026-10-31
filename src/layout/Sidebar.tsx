import { ChevronRight, Lock, MapPinned, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation, useMatch } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { MODULES, useModules } from '@/app/modules'
import { paths } from '@/domains/construction/paths'
import { useConstruction } from '@/domains/construction/store'
import { updatedLabel, useBackend } from '@/lib/dataSource'

function DisabledItem({ label, Icon }: { label: string; Icon: (typeof MODULES)[number]['icon'] }) {
  return (
    <li className="group relative">
      <span
        aria-disabled="true"
        tabIndex={0}
        className="flex h-9 cursor-not-allowed items-center gap-3 rounded-nx px-3 text-[13px] text-sidebar-muted/70"
      >
        <Icon size={16} strokeWidth={1.5} />
        <span className="flex-1">{label}</span>
        <Lock size={12} strokeWidth={1.5} />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-nx border border-sidebar-line bg-sidebar px-2.5 py-1.5 text-xs text-sidebar-ink group-hover:block group-focus-within:block"
      >
        {label} is a planned module — coming soon
      </span>
    </li>
  )
}

/**
 * Inside a project, Areas sits under Projects: the row opens the areas overview and the chevron expands a shortcut to each area. New and
 * renamed areas appear here at once because the list is read from the same area records every other page uses.
 */
function AreasNav({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { state } = useConstruction()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(true)
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived).sort((a, b) => a.sequence - b.sequence)
  const inAreas = pathname.startsWith(paths.areas(projectId))
  const row = (active: boolean) => `flex h-9 items-center gap-3 rounded-nx px-3 text-[13px] transition-colors ${active ? 'bg-white/10 text-sidebar-ink' : 'text-neutral-400 hover:bg-white/5 hover:text-sidebar-ink'}`
  return (
    <li>
      <div className="flex items-center">
        <NavLink to={paths.areas(projectId)} end onClick={onClose} className={({ isActive }) => `${row(isActive)} ml-3 flex-1`}><MapPinned size={15} strokeWidth={1.5} />Areas</NavLink>
        {areas.length > 0 && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} areas`} className="grid h-9 w-9 place-items-center text-sidebar-muted hover:text-sidebar-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${open || inAreas ? 'rotate-90' : ''}`} /></button>}
      </div>
      {(open || false) && areas.length > 0 && (
        <ul className="ml-[2.1rem] mt-0.5 space-y-0.5 border-l border-sidebar-line pl-2" aria-label="Area shortcuts">
          {areas.map((a) => (
            <li key={a.id}><NavLink to={paths.area(projectId, a.id)} onClick={onClose} title={a.name} className={({ isActive }) => `${row(isActive)} !h-8 !px-2 text-[12.5px]`}><span className="truncate">{a.name}</span></NavLink></li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode, environment, readOnly, asOf } = useBackend()
  const modules = useModules()
  const inProject = useMatch('/projects/:projectId/*')?.params.projectId
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink/50 xl:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar text-sidebar-ink transition-transform xl:static xl:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-line px-5">
          <div className="leading-none">
            <div className="text-[15px] font-semibold tracking-[0.28em]">NEXUS</div>
            <div className="mt-1.5 text-micro tracking-wide text-sidebar-muted">by Framework</div>
          </div>
          <button onClick={onClose} aria-label="Close navigation" className="text-sidebar-muted hover:text-sidebar-ink xl:hidden">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
          <ul className="space-y-0.5">
            {modules.map(({ id, label, icon: Icon, path }) =>
              path ? (
                <li key={id}>
                  <NavLink
                    to={path}
                    end={path === '/'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex h-9 items-center gap-3 rounded-nx px-3 text-[13px] transition-colors ${isActive ? 'bg-white/10 text-sidebar-ink' : 'text-neutral-400 hover:bg-white/5 hover:text-sidebar-ink'}`
                    }
                  >
                    <Icon size={16} strokeWidth={1.5} />
                    {label}
                  </NavLink>
                  {id === 'projects' && inProject && <ul className="mt-0.5"><AreasNav projectId={inProject} onClose={onClose} /></ul>}
                </li>
              ) : (
                <DisabledItem key={id} label={label} Icon={Icon} />
              ),
            )}
          </ul>
        </nav>
        <div className="border-t border-sidebar-line px-5 py-4 text-micro text-sidebar-muted">{readOnly ? `View only · project data${updatedLabel(asOf)}` : mode === 'server' ? `Saved project data${environment ? ` · ${environment}` : ''}` : IS_PUBLIC_DEMO ? 'Demo Environment · sample data only' : 'Demonstration data · fictional records'}</div>
      </aside>
    </>
  )
}
