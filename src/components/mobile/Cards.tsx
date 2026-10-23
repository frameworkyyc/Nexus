import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Select } from '@/components/ui/Field'

/** The one card surface used for rows on phones: white, soft ring, rounded. No heavy borders. */
export const CARD = 'rounded-2xl bg-surface shadow-[0_0_0_1px_var(--nx-line)]'

/** A thick, readable progress bar for cards (blue = neutral progress, per the status system). */
export function MeterBar({ value, label, className = '' }: { value: number; label?: string; className?: string }) {
  const v = Math.min(100, Math.max(0, value))
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-[var(--nx-track)] ${className}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-[var(--nx-info)]" style={{ width: `${v}%` }} />
    </div>
  )
}

/** Sort control for card lists (the table header buttons do not exist on a phone). */
export function SortBar<K extends string>({ options, value, dir, onChange, onToggleDir }: { options: { key: K; label: string }[]; value: K; dir: 1 | -1; onChange: (k: K) => void; onToggleDir: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Select aria-label="Sort by" value={value} onChange={(e) => onChange(e.target.value as K)}>
        {options.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
      </Select>
      <button type="button" onClick={onToggleDir} aria-label={dir === 1 ? 'Ascending. Tap for descending' : 'Descending. Tap for ascending'} className="grid h-11 w-11 shrink-0 place-items-center rounded-nx border border-line bg-surface">
        {dir === 1 ? <ArrowUp size={18} strokeWidth={1.75} /> : <ArrowDown size={18} strokeWidth={1.75} />}
      </button>
    </div>
  )
}

/** Large two-way (or more) switch, e.g. Foundations | Plinths. */
export function Segmented<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[var(--nx-track)] p-1">
      {items.map((i) => (
        <button key={i.id} type="button" aria-pressed={value === i.id} onClick={() => onChange(i.id)} className={`h-11 rounded-lg text-[15px] font-medium transition-colors ${value === i.id ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>{i.label}</button>
      ))}
    </div>
  )
}

/** Horizontally scrollable chips: an intentional scroll area used for section tabs. */
export function ChipTabs({ children, label }: { children: ReactNode; label: string }) {
  return <nav aria-label={label} data-compact className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</nav>
}
