import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

/** A compact dropdown of route links, used where a row of links would crowd the layout. */
export function NavMenu({ label, items, active }: { label: string; items: { to: string; label: string; divider?: boolean }[]; active: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()

  useEffect(() => setOpen(false), [pathname, search])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`relative inline-flex items-center gap-1 whitespace-nowrap pb-3 text-[13px] transition-colors ${active ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-ink' : 'text-muted hover:text-ink'}`}
      >
        {label}
        <ChevronDown size={13} strokeWidth={1.5} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-px min-w-48 border border-line bg-surface py-1">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end role="menuitem" className={({ isActive }) => `block px-4 py-2 text-[13px] transition-colors hover:bg-hover ${i.divider ? 'mt-1 border-t border-line pt-3' : ''} ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              {i.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
