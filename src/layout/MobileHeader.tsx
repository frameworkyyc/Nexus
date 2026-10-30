import { ChevronLeft, Menu, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useMatches } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { useTenant } from '@/app/tenant'
import { PRIMARY_NAV, activePrimary } from '@/app/primaryNav'
import type { CrumbHandle } from './TopBar'

/**
 * Compact phone header: a back arrow on detail screens (otherwise the Nexus mark), the screen title with its context (the project, or
 * the organization), a search button on screens that have a search field, and the menu. Safe-area aware and sticky.
 */
export function MobileHeader({ onMenu }: { onMenu: () => void }) {
  const tenant = useTenant()
  const { pathname } = useLocation()
  const crumbs = useMatches().filter((m) => (m.handle as CrumbHandle | undefined)?.crumb)
  const [hasSearch, setHasSearch] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setHasSearch(!!document.querySelector('[data-search]')), 50)
    return () => window.clearTimeout(t)
  }, [pathname])

  const section = PRIMARY_NAV.find((d) => d.id === activePrimary(pathname))
  const last = crumbs[crumbs.length - 1]
  const Title = (last?.handle as CrumbHandle | undefined)?.crumb
  const Context = crumbs.length >= 3 && pathname.startsWith('/projects/') ? (crumbs[1].handle as CrumbHandle).crumb : undefined
  const back = crumbs.length >= 2 ? crumbs[crumbs.length - 2].pathname : null
  const focusSearch = () => {
    const el = document.querySelector<HTMLInputElement>('[data-search]')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.focus()
  }
  return (
    <header className="pt-safe pl-safe pr-safe sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="flex min-h-14 items-center gap-1 px-2">
        {back ? (
          <>
            <Link to={back} aria-label="Back" className="grid h-11 w-11 shrink-0 place-items-center text-ink"><ChevronLeft size={26} strokeWidth={1.75} /></Link>
            <div className="min-w-0 flex-1 px-1 leading-tight">
              <p className="truncate text-[17px] font-semibold">{Title ? <Title params={last.params} /> : section?.label ?? 'Nexus'}</p>
              <p className="truncate text-[12.5px] text-muted">{Context ? <Context params={crumbs[1].params} /> : tenant.organization}</p>
            </div>
          </>
        ) : (
          <>
            <Link to="/" aria-label="Nexus home" className="grid h-11 w-11 shrink-0 place-items-center"><span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-[15px] font-semibold text-white">N</span></Link>
            <div className="min-w-0 flex-1 px-1 leading-tight">
              <p className="text-[15px] font-semibold tracking-[0.26em]">NEXUS</p>
              <p className="truncate text-[12.5px] text-muted">{tenant.organization || 'Nexus'}</p>
            </div>
          </>
        )}
        {IS_PUBLIC_DEMO && <button type="button" onClick={onMenu} aria-label="Demo Environment: open menu to reset the demo" className="mr-1 inline-flex h-8 min-h-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12px] font-medium text-muted"><span className="h-1.5 w-1.5 rounded-full bg-[var(--nx-info)]" aria-hidden="true" />Demo</button>}
        {hasSearch && <button type="button" onClick={focusSearch} aria-label="Search" className="grid h-11 w-11 shrink-0 place-items-center text-ink"><Search size={21} strokeWidth={1.75} /></button>}
        <button type="button" onClick={onMenu} aria-label="Menu" className="grid h-11 w-11 shrink-0 place-items-center text-ink"><Menu size={23} strokeWidth={1.75} /></button>
      </div>
    </header>
  )
}
