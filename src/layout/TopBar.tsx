import { Menu } from 'lucide-react'
import { Link, useMatches } from 'react-router-dom'
import { tenant } from '@/app/tenant'
import type { ComponentType } from 'react'
import { SyncIndicator } from './SyncIndicator'

/** Routes declare `handle: { crumb: Component }`; the top bar renders the chain. */
export interface CrumbHandle {
  crumb?: ComponentType
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const crumbs = useMatches().filter((m) => (m.handle as CrumbHandle | undefined)?.crumb)
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onMenu} aria-label="Open navigation" className="text-muted hover:text-ink xl:hidden">
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[13px]">
          {crumbs.map((m, i) => {
            const Crumb = (m.handle as CrumbHandle).crumb!
            const last = i === crumbs.length - 1
            return (
              <span key={m.id} className="flex items-center gap-2">
                {i > 0 && <span className="text-neutral-300">/</span>}
                {last ? <span className="font-medium"><Crumb /></span> : <Link to={m.pathname} className="text-muted transition-colors hover:text-ink"><Crumb /></Link>}
              </span>
            )
          })}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <SyncIndicator />
        <span className="hidden text-[13px] text-muted sm:inline">{tenant.organization}</span>
        <div aria-label="User avatar placeholder" className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-micro font-medium text-white">
          {tenant.userInitials}
        </div>
      </div>
    </header>
  )
}
