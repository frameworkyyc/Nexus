import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConstruction } from '../../store'
import { paths } from '../../paths'
import { areaTree, consolidate, specText, type Consolidated } from '../consolidate'
import { useTracker } from '../store'

const fmt = (n: number) => n.toLocaleString('en-CA')
const SOURCE = { calculated: 'Calculated', entered: 'Entered', workbook: 'Workbook' } as const

/** Chips for choosing one thing from a short list (areas). Wraps on iPad, scrolls on a phone. */
export function Chips<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2" data-compact>
      {items.map((i) => (
        <button key={i.id} type="button" aria-pressed={value === i.id} onClick={() => onChange(i.id)}
          className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[13px] transition-colors phone:h-11 phone:text-[15px] ${value === i.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:border-ink'}`}>
          {i.label}{i.count !== undefined && <span className={value === i.id ? 'text-white/70' : 'text-muted'}>{i.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** The foundations and anchorage types behind one consolidated total. */
export function Contributions({ g }: { g: Consolidated }) {
  const calc = g.lines.filter((l) => l.origin === 'anchorage').map((l) => l.calc.expression).filter(Boolean)
  const rows = [...g.contributions].sort((a, b) => a.foundation.localeCompare(b.foundation, 'en', { numeric: true }) || a.anchorage.localeCompare(b.anchorage, 'en', { numeric: true }))
  return (
    <div className="space-y-3 py-3 text-[13px]">
      {rows.length === 0 ? <p className="text-muted">Nothing currently requires this material.</p> : (
        <table className="w-full max-w-3xl" aria-label={`Where the ${fmt(g.required)} comes from`}>
          <thead><tr className="border-b border-line"><th scope="col" className="t-label py-2 font-medium">Foundation</th><th scope="col" className="t-label py-2 font-medium">Anchorage type</th><th scope="col" className="t-label py-2 font-medium">Source</th><th scope="col" className="t-label py-2 font-medium">Quantity</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.lineId}-${r.foundationId}-${r.anchorageTypeId}-${i}`} className="border-b border-line">
                <td className="py-2">{r.foundation || <span className="text-muted">—</span>}</td>
                <td className="py-2">{r.anchorage || <span className="text-muted">—</span>}</td>
                <td className="py-2 text-muted">{SOURCE[r.source]}</td>
                <td className="py-2 text-right">{fmt(r.qty)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="py-2 font-medium">Total required</td><td className="py-2 text-right font-medium">{fmt(g.required)}</td></tr></tfoot>
        </table>
      )}
      {calc.length > 0 && <p className="max-w-3xl text-xs text-muted">Calculated from the Anchorage Library and the Foundation Register: {calc.join('; ')}.</p>}
    </div>
  )
}

/**
 * Materials as a consolidated overview: pick an area, then see its materials by category and specification, each as one line with the total
 * required across every foundation in that area. A line opens to show which foundations and anchorage types make up the total.
 */
export function MaterialsByArea({ areaId }: { areaId?: string }) {
  const { projectId = '' } = useParams()
  const { state } = useTracker()
  const { state: construction } = useConstruction()
  const groups = useMemo(() => {
    const mine = new Set(construction.areas.filter((a) => a.projectId === projectId).map((a) => a.id))
    return consolidate(state, construction).filter((g) => (areaId ? g.areaId === areaId : g.areaId ? mine.has(g.areaId) : true) && !(g.removed && g.required === 0))
  }, [state, construction, projectId, areaId])
  const tree = useMemo(() => areaTree(groups), [groups])
  const [areaKey, setAreaKey] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const area = tree.find((a) => a.areaKey === areaKey) ?? tree[0]
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })

  if (tree.length === 0) return <EmptyState title="No requirements yet" description="Requirements appear here once an anchorage type is configured in the Anchorage Library and assigned to foundations, or materials are added. Identical materials in an area are totalled into one line." />
  return (
    <div className="space-y-6">
      {!areaId && (
        <div className="space-y-2">
          <p className="t-label">Area</p>
          <Chips label="Area" value={area.areaKey} onChange={setAreaKey} items={tree.map((a) => ({ id: a.areaKey, label: a.name, count: a.groups.length }))} />
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-muted">{area.name}: {area.groups.length} material{area.groups.length === 1 ? '' : 's'} in {area.categories.length} categor{area.categories.length === 1 ? 'y' : 'ies'}. Totals are across every foundation in the area and update when foundations or anchorage types change.</p>
        {area.areaId && <Link to={`${paths.procurement(projectId)}?area=${area.areaId}`} className="text-[13px] underline underline-offset-4">Order and receive in Procurement</Link>}
      </div>
      {area.categories.map((cat) => (
        <section key={cat.category} aria-label={cat.label}>
          <h3 className="t-label mb-1 flex items-baseline gap-2">{cat.label}<span className="font-normal normal-case tracking-normal">{cat.groups.length}</span></h3>
          <table className="card-table w-full table-fixed text-left text-[13px]">
            <colgroup><col className="w-10" /><col className="w-[26%]" /><col /><col className="w-28" /><col className="w-16" /><col className="w-36" /></colgroup>
            <thead><tr className="border-b border-line"><th scope="col" className="t-label w-8 font-medium"><span className="sr-only">Expand</span></th><th scope="col" className="t-label font-medium">Material</th><th scope="col" className="t-label font-medium">Specification</th><th scope="col" className="t-label text-right font-medium">Required</th><th scope="col" className="t-label font-medium">Unit</th><th scope="col" className="t-label font-medium">From</th></tr></thead>
            <tbody>
              {cat.groups.map((g) => {
                const isOpen = open.has(g.key)
                const foundations = new Set(g.contributions.map((c) => c.foundationId ?? c.foundation).filter(Boolean)).size
                return [
                  <tr key={g.key} className="border-b border-line transition-colors hover:bg-hover">
                    <td className="pr-0"><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} what makes up ${g.name} ${specText(g)}`} onClick={() => toggle(g.key)} className="grid h-8 w-8 place-items-center text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                    <td className="font-medium"><button type="button" onClick={() => toggle(g.key)} className="text-left">{g.name}</button></td>
                    <td className="text-muted" title={specText(g)}>{specText(g) || '—'}</td>
                    <td className="text-right font-medium">{fmt(g.required)}</td>
                    <td className="text-muted">{g.unit}</td>
                    <td className="text-muted">{foundations > 0 ? `${foundations} foundation${foundations === 1 ? '' : 's'}` : '—'}</td>
                  </tr>,
                  isOpen && <tr key={`${g.key}-detail`} data-wide><td colSpan={6} className="border-b border-line bg-hover px-3"><Contributions g={g} /></td></tr>,
                ]
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
