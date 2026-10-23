import { Link, useLocation } from 'react-router-dom'
import { PRIMARY_NAV } from '@/app/primaryNav'

/** Fixed phone navigation: five primary destinations, always reachable, clear of the iPhone home indicator. */
export function BottomNav() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Primary" className="pb-safe pl-safe pr-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {PRIMARY_NAV.map(({ id, label, icon: Icon, to, matches }) => {
          const active = matches(pathname)
          return (
            <li key={id}>
              <Link to={to} aria-current={active ? 'page' : undefined}
                className={`relative flex h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-medium leading-none tracking-tight transition-colors [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:gap-2 ${active ? 'text-ink' : 'text-muted'}`}>
                {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-ink" aria-hidden="true" />}
                <Icon size={22} strokeWidth={active ? 2 : 1.5} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
