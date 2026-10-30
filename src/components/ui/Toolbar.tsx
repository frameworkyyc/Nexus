import { SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from './Button'

/**
 * A register toolbar in two aligned rows. Row 1 is the search (widest) and the filters, laid out on a fixed grid so every control has the same
 * height and the dropdowns the same width; row 2 puts the quiet filtering controls on the left (archived toggle, result count) and the
 * view switch and actions on the right. On a phone the search is full width with one compact Filters button that reveals the filters, and
 * row 2 stacks. Controls are the shared Input / Select / Button, so heights (36px; 44px on touch screens) come from the design system.
 */
export interface FilterToolbarProps {
  search: ReactNode
  /** The filter dropdowns, in order. One to three are laid out in equal columns beside the search. */
  filters: ReactNode
  filterCount: 1 | 2 | 3
  /** How many filters are currently narrowing the list (shown on the phone Filters button). */
  activeFilters: number
  phone: boolean
  /** Row 2, left: archived toggle, result count. */
  secondaryStart: ReactNode
  /** Row 2, right: view switch and actions. */
  secondaryEnd: ReactNode
}

// Literal class names so Tailwind can see them. Search takes twice the width of each dropdown.
const COLS: Record<1 | 2 | 3, string> = {
  1: 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
  2: 'md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]',
  3: 'md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]',
}

export function FilterToolbar({ search, filters, filterCount, activeFilters, phone, secondaryStart, secondaryEnd }: FilterToolbarProps) {
  const [open, setOpen] = useState(false)
  if (phone) {
    return (
      <div className="mb-3 space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          {search}
          <Button aria-expanded={open} aria-controls="toolbar-filters" onClick={() => setOpen(!open)} className="relative">
            <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden />Filters{activeFilters > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-xs text-white">{activeFilters}</span>}
          </Button>
        </div>
        {open && <div id="toolbar-filters" className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">{filters}</div>}
        <div className="flex flex-col gap-3">
          <div className="flex min-h-11 items-center justify-between gap-3">{secondaryStart}</div>
          {secondaryEnd}
        </div>
      </div>
    )
  }
  return (
    <div className="mb-3 space-y-2">
      <div className={`grid grid-cols-2 gap-3 ${COLS[filterCount]}`}>
        <div className="col-span-2 md:col-span-1">{search}</div>
        {filters}
      </div>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-4">{secondaryStart}</div>
        <div className="flex items-center gap-2">{secondaryEnd}</div>
      </div>
    </div>
  )
}

/** Two-or-more way switch for a toolbar (Foundations | Plinths). Same height as the other controls. */
export function ViewToggle<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 items-center gap-0.5 rounded-nx border border-line p-0.5 text-[13px]">
      {items.map((i) => (
        <button key={i.id} type="button" aria-pressed={value === i.id} onClick={() => onChange(i.id)} className={`h-full rounded-[5px] px-3 transition-colors ${value === i.id ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink'}`}>{i.label}</button>
      ))}
    </div>
  )
}
