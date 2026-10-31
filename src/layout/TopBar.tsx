import { Link, NavLink, useLocation, useMatches, type Params } from 'react-router-dom'
import { PRIMARY_NAV, activePrimary } from '@/app/primaryNav'
import { useProjectContext } from '@/app/projectContext'
import { useTenant } from '@/app/tenant'
import type { ComponentType } from 'react'
import { MoreMenu } from './MoreMenu'
import { ProjectSwitcher } from './ProjectSwitcher'
import { SyncIndicator } from './SyncIndicator'

/** Routes declare `handle: { crumb: Component }`; the header renders the chain. */
export interface CrumbHandle {
  /** Receives the route's own params: a crumb must not rely on useParams(), which depends on where the header is rendered. */
  crumb?: ComponentType<{ params: Params<string> }>
  /** The crumb's own path only redirects elsewhere (a project opens on Progress, Management on Materials), so show it as text and never use it as a back target. */
  noLink?: boolean
}

/**
 * Desktop and iPad header: Nexus · project selector · the four primary sections · More. Below it a thin breadcrumb line shows where you
 * are. Section names are shortened below the `xl` breakpoint so everything fits on an iPad held upright.
 */
export function TopBar() {
  const tenant = useTenant()
  const { projectId } = useProjectContext()
  const { pathname } = useLocation()
  const active = activePrimary(pathname)
  const crumbs = useMatches().filter((m) => (m.handle as CrumbHandle | undefined)?.crumb)
  return (
    <header className="shrink-0 border-b border-line bg-surface">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:gap-6">
        <Link to="/" aria-label="Nexus home" className="shrink-0 leading-none"><span className="block text-[15px] font-semibold tracking-[0.28em]">NEXUS</span><span className="mt-1 block text-micro tracking-wide text-muted">by Framework</span></Link>
        <ProjectSwitcher />
        <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:gap-1">
          {PRIMARY_NAV.map((s) => {
            const on = active === s.id
            return (
              <NavLink key={s.id} to={s.to(projectId)} aria-current={on ? 'page' : undefined} className={`relative flex h-14 shrink-0 items-center px-2.5 text-[13px] transition-colors lg:px-3.5 ${on ? 'font-medium text-ink after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-ink' : 'text-muted hover:text-ink'}`}>
                <span className="hidden xl:inline">{s.label}</span><span className="xl:hidden">{s.short}</span>
              </NavLink>
            )
          })}
        </nav>
        <MoreMenu />
        <div className="flex shrink-0 items-center gap-3">
          <SyncIndicator />
          <span className="hidden text-[13px] text-muted 2xl:inline">{tenant.organization || 'Nexus'}</span>
          <div aria-label="User avatar placeholder" className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-micro font-medium text-white">{tenant.userInitials}</div>
        </div>
      </div>
      {crumbs.length > 1 && (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-line/60 bg-canvas px-4 py-2 text-[12.5px] sm:px-6">
          {crumbs.map((m, i) => {
            const Crumb = (m.handle as CrumbHandle).crumb!
            const last = i === crumbs.length - 1
            return (
              <span key={m.id} className="flex items-center gap-2">
                {i > 0 && <span className="text-neutral-300">/</span>}
                {last || (m.handle as CrumbHandle).noLink ? <span className={last ? 'font-medium' : 'text-muted'}><Crumb params={m.params} /></span> : <Link to={m.pathname} className="text-muted transition-colors hover:text-ink"><Crumb params={m.params} /></Link>}
              </span>
            )
          })}
        </nav>
      )}
    </header>
  )
}
