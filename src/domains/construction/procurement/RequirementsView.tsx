import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { percentOf } from '@/lib/format'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { CATEGORY_TITLE, displayName, specText } from '../tracker/consolidate'
import { PROC_LABEL, type ProcRow, type ProcStatus } from '../tracker/procurement'
import { CATEGORY_ORDER } from '../tracker/selectors'
import { fmt } from './Dialogs'

export type RequirementsLayout = 'list' | 'blocks'
const TONE: Record<ProcStatus, Tone> = { pending: 'muted', ordered: 'info', partial: 'warn', received: 'ok' }

/** The requirements by material category, in the standard category order, with how many each holds and how much is still outstanding. */
export function groupByCategory(rows: ProcRow[]) {
  return CATEGORY_ORDER.filter((c) => rows.some((r) => r.category === c)).map((category) => {
    const items = rows.filter((r) => r.category === category)
    return { category, items, count: items.length, outstanding: items.reduce((a, r) => a + r.outstanding, 0) }
  })
}

export interface RequirementsViewProps {
  rows: ProcRow[]
  layout: RequirementsLayout
  onOpen: (key: string) => void
  /** Show which area each requirement belongs to (project-wide view). */
  showArea: boolean
  /** Open every category (a search or status filter is active, so matches are not hidden behind a collapsed heading). */
  expandAll: boolean
}

/**
 * The requirements grouped by material category. Categories start collapsed and show how many requirements they hold and how much is still
 * outstanding; opening one shows its requirements as list rows or as cards. Both layouts read the same rows and offer the same selection and actions.
 */
export function RequirementsView({ rows, layout, onOpen, showArea, expandAll }: RequirementsViewProps) {
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const cats = groupByCategory(rows)
  const toggle = (c: string) => setOpenCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n })
  return (
    <div className="divide-y divide-line border-y border-line" data-layout={layout}>
      {cats.map(({ category: cat, items, outstanding }) => {
        const isOpen = expandAll || openCats.has(cat)
        return (
          <section key={cat} aria-label={CATEGORY_TITLE[cat]}>
            <h3 className="flex items-center gap-3 py-3">
              <button type="button" aria-expanded={isOpen} onClick={() => toggle(cat)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <ChevronRight size={14} strokeWidth={1.5} className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-[15px] font-medium sm:flex-1">{CATEGORY_TITLE[cat]}</span>
                  <span className="text-xs font-normal tabular-nums text-muted sm:text-[13px]">{items.length} requirement{items.length === 1 ? '' : 's'} · {fmt(outstanding)} outstanding</span>
                </span>
              </button>
            </h3>
            {isOpen && (layout === 'list' ? <ListRows items={items} onOpen={onOpen} showArea={showArea} /> : <Cards items={items} onOpen={onOpen} showArea={showArea} />)}
          </section>
        )
      })}
    </div>
  )
}

type Part = Pick<RequirementsViewProps, 'onOpen' | 'showArea'> & { items: ProcRow[] }

function ListRows({ items, onOpen, showArea }: Part) {
  return (
    <table className="card-table mb-4 w-full text-left text-[13px]" aria-label="Requirements">
      <thead><tr className="border-b border-line">
        <th scope="col" className="t-label font-medium">Material</th>
        <th scope="col" className="t-label text-right font-medium">Required</th><th scope="col" className="t-label text-right font-medium">Ordered</th><th scope="col" className="t-label text-right font-medium">Received</th>
        <th scope="col" className="t-label text-right font-medium">Outstanding</th><th scope="col" className="t-label text-right font-medium">Allocated</th><th scope="col" className="t-label font-medium">Status</th>
      </tr></thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.key} className={`border-b border-line transition-colors hover:bg-hover ${r.orphan ? 'opacity-70' : ''}`}>
            <td data-wrap>
              <button type="button" onClick={() => onOpen(r.key)} className="block text-left"><span className="font-medium underline-offset-4 hover:underline">{displayName(r)}</span>{r.orphan && <span className="ml-2 text-xs text-warn">No longer required</span>}<span className="block text-xs text-muted" title={specText(r)}>{[showArea ? r.area : '', specText(r) || r.unit].filter(Boolean).join(' · ')}</span></button>
            </td>
            <td className="text-right font-medium">{fmt(r.required)}</td><td className="text-right">{fmt(r.ordered)}</td><td className="text-right">{fmt(r.received)}</td>
            <td className="text-right">{fmt(r.outstanding)}</td><td className="text-right" title={`${fmt(r.unallocated)} received and not yet allocated`}>{fmt(r.allocated)}</td>
            <td><StatusBadge tone={TONE[r.status]} label={PROC_LABEL[r.status]} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Essential figures as a card, in the square card style of the Foundations blocks; opening one shows the full details and actions. */
function Cards({ items, onOpen, showArea }: Part) {
  return (
    <ul className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Requirements">
      {items.map((r) => {
        const pct = percentOf(r.received, r.required) ?? 0
        return (
          <li key={r.key} className={`relative border border-line bg-surface p-3 transition-colors hover:border-ink ${r.orphan ? 'opacity-70' : ''}`}>
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => onOpen(r.key)} className="min-w-0 flex-1 text-left" aria-label={`Open ${displayName(r)} ${specText(r)}`}>
                <span className="block text-[14px] font-medium leading-snug">{displayName(r)}</span>
                <span className="mt-0.5 block text-xs text-muted">{[showArea ? r.area : '', specText(r) || r.unit].filter(Boolean).join(' · ')}</span>
                {r.orphan && <span className="block text-xs text-warn">No longer required</span>}
              </button>
              <StatusBadge tone={TONE[r.status]} label={PROC_LABEL[r.status]} />
            </div>
            <button type="button" tabIndex={-1} aria-hidden onClick={() => onOpen(r.key)} className="mt-3 block w-full text-left">
              <div className="h-0.5 w-full bg-line"><div className="h-full bg-ink" style={{ width: `${pct}%` }} /></div>
              <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                {([['Required', r.required], ['Ordered', r.ordered], ['Received', r.received], ['Outstanding', r.outstanding]] as const).map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="mt-0.5 text-[13px] font-medium tabular-nums">{fmt(v)}</dd></div>)}
              </dl>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
