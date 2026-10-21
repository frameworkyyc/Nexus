import { Lock, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { MODULES } from '@/app/modules'

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

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink/50 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar text-sidebar-ink transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-line px-5">
          <div className="leading-none">
            <div className="text-[15px] font-semibold tracking-[0.28em]">NEXUS</div>
            <div className="mt-1.5 text-micro tracking-wide text-sidebar-muted">by Framework</div>
          </div>
          <button onClick={onClose} aria-label="Close navigation" className="text-sidebar-muted hover:text-sidebar-ink lg:hidden">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
          <ul className="space-y-0.5">
            {MODULES.map(({ id, label, icon: Icon, path }) =>
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
                </li>
              ) : (
                <DisabledItem key={id} label={label} Icon={Icon} />
              ),
            )}
          </ul>
        </nav>
        <div className="border-t border-sidebar-line px-5 py-4 text-micro text-sidebar-muted">Demonstration data · fictional records</div>
      </aside>
    </>
  )
}
