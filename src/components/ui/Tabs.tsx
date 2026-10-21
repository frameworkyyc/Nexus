import { NavLink } from 'react-router-dom'

const base = 'relative shrink-0 whitespace-nowrap pb-3 text-[13px] transition-colors'
const on = 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-ink'
const off = 'text-muted hover:text-ink'

interface TabItem<T extends string> {
  id: T
  label: string
  count?: number
}

export function Tabs<T extends string>({ items, value, onChange }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-line" role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={`${base} ${value === t.id ? on : off}`}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function NavTabs({ items }: { items: { to: string; label: string; end?: boolean }[] }) {
  return (
    <nav className="flex gap-6 overflow-x-auto border-b border-line" aria-label="Sections">
      {items.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `${base} ${isActive ? on : off}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
