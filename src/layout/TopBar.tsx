import { Link, useMatches, type Params } from 'react-router-dom'
import { useTenant } from '@/app/tenant'
import type { ComponentType } from 'react'
import { ProjectSwitcher } from './ProjectSwitcher'
import { SyncIndicator } from './SyncIndicator'

/** Routes declare `handle: { crumb: Component }`; the header renders the chain. */
export interface CrumbHandle {
  /** Receives the route's own params: a crumb must not rely on useParams(), which depends on where the header is rendered. */
  crumb?: ComponentType<{ params: Params<string> }>
  /** The crumb's own path only redirects elsewhere (a project opens on Progress, Management on Materials), so show it as text and never use it as a back target. */
  noLink?: boolean
}

/** Header: the project selector and breadcrumbs on the left, sync status and the user on the right. The sections themselves are in the sidebar. */
export function TopBar() {
  const tenant = useTenant()
  const crumbs = useMatches().filter((m) => (m.handle as CrumbHandle | undefined)?.crumb)
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="shrink-0"><ProjectSwitcher /></div>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap text-[13px]">
          {crumbs.map((m, i) => {
            const Crumb = (m.handle as CrumbHandle).crumb!
            const last = i === crumbs.length - 1
            return (
              <span key={m.id} className={`flex min-w-0 items-center gap-2 ${last ? '' : 'shrink-[2]'}`}>
                {i > 0 && <span className="shrink-0 text-neutral-300">/</span>}
                {last || (m.handle as CrumbHandle).noLink ? <span className={`min-w-0 truncate ${last ? 'font-medium' : 'text-muted'}`}><Crumb params={m.params} /></span> : <Link to={m.pathname} className="min-w-0 truncate text-muted transition-colors hover:text-ink"><Crumb params={m.params} /></Link>}
              </span>
            )
          })}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <SyncIndicator />
        <span className="hidden max-w-[10rem] truncate text-[13px] text-muted xl:inline">{tenant.organization || 'Nexus'}</span>
        <div aria-label="User avatar placeholder" className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-micro font-medium text-white">{tenant.userInitials}</div>
      </div>
    </header>
  )
}
