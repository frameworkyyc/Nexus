import { NavLink } from 'react-router-dom'

// Desktop: underlined text tabs (unchanged). Phone: large pill chips that scroll sideways (an intentional scroll area).
const base = 'relative shrink-0 whitespace-nowrap pb-3 text-[13px] transition-colors phone:inline-flex phone:h-11 phone:items-center phone:rounded-full phone:border phone:px-4 phone:pb-0 phone:text-[15px]'
const on = 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-ink phone:border-ink phone:bg-ink phone:text-white phone:after:hidden'
const off = 'text-muted hover:text-ink phone:border-line phone:bg-surface phone:text-ink'
const row = 'flex gap-6 overflow-x-auto border-b border-line phone:-mx-4 phone:gap-2 phone:border-b-0 phone:px-4 phone:pb-1 phone:[scrollbar-width:none] phone:[&::-webkit-scrollbar]:hidden'

interface TabItem<T extends string> {
  id: T
  label: string
  count?: number
}

export function Tabs<T extends string>({ items, value, onChange }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={row} role="tablist" data-compact>
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
    <nav className={row} aria-label="Sections" data-compact>
      {items.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `${base} ${isActive ? on : off}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
