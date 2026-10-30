import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConstruction } from '../../store'
import { paths } from '../../paths'
import { Button } from '@/components/ui/Button'
import { useAccess } from '@/lib/access'
import { archiveMaterials, editMaterial } from '../commands'
import { areaTree, consolidate, entryNotes, materialLabel, type Consolidated } from '../consolidate'
import { trackerStore, useTracker } from '../store'

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
export function Contributions({ g, all }: { g: Consolidated; all?: Consolidated[] }) {
  const access = useAccess()
  const { state: construction } = useConstruction()
  const notes = entryNotes(g, construction, all)
  const [error, setError] = useState('')
  const act = async (r: Promise<string | null>) => { setError((await r) ?? '') }
  const calc = g.lines.filter((l) => l.origin === 'anchorage').map((l) => l.calc.expression).filter(Boolean)
  const rows = [...g.contributions].sort((a, b) => a.foundation.localeCompare(b.foundation, 'en', { numeric: true }) || a.anchorage.localeCompare(b.anchorage, 'en', { numeric: true }))
  return (
    <div className="space-y-3 py-3 text-[13px]">
      {rows.length === 0 ? <p className="text-muted">Nothing currently requires this material.</p> : (
        <table data-table="free" className="w-full max-w-3xl" aria-label={`Where the ${fmt(g.required)} comes from`}>
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
      {calc.length > 0 && <p className="max-w-3xl text-xs text-muted">{calc.join('; ')}</p>}
      {notes.map((x) => (
        <div key={x.lineId} role="note" className="max-w-3xl space-y-2 border-l-2 border-warn pl-3">
          <p>{x.foundation}: {fmt(x.entered)} was entered as a fixed total{x.footings > 1 ? `, but the foundation has ${fmt(x.footings)} footings (${fmt(x.perFooting)} if counted on every footing)` : ''}.{x.calculated > 0 ? ` The Anchorage Library already calculates ${fmt(x.calculated)} for it, so entering it as well counts it twice.` : ''}</p>
          {access.can('materials.edit') && (
            <div className="flex flex-wrap gap-2">
              {x.footings > 1 && x.calculated === 0 && <Button onClick={() => void act(trackerStore.run(editMaterial(x.lineId, { basis: 'per-footing', requiredQty: x.entered })))}>Count on every footing ({fmt(x.perFooting)})</Button>}
              {x.calculated > 0 && access.can('materials.archive') && <Button onClick={() => { if (window.confirm('Archive the entered line? It is hidden and kept on record; the calculated quantity stays.')) void act(trackerStore.run(archiveMaterials([x.lineId], true))) }}>Use the calculated quantity</Button>}
            </div>
          )}
        </div>
      ))}
      {error && <p role="alert" className="max-w-3xl border-l-2 border-bad pl-3">{error}</p>}
    </div>
  )
}

/**
 * Materials: pick an area, see what it needs. Materials are grouped by category, identical specifications are one line with the total across
 * every foundation in the area, and a line opens to the foundations that make up its total.
 */
export function MaterialsByArea({ areaId }: { areaId?: string }) {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { state } = useTracker()
  const { state: construction } = useConstruction()
  const groups = useMemo(() => {
    const mine = new Set(construction.areas.filter((a) => a.projectId === projectId).map((a) => a.id))
    return consolidate(state, construction).filter((g) => (areaId ? g.areaId === areaId : g.areaId ? mine.has(g.areaId) : true) && !(g.removed && g.required === 0))
  }, [state, construction, projectId, areaId])
  const tree = useMemo(() => areaTree(groups), [groups])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const area = tree.find((a) => a.areaKey === params.get('area')) ?? tree[0]
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const toggleCat = (k: string) => setOpenCats((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })

  if (tree.length === 0) return <EmptyState title="No materials required yet" description="Configure anchorage types in the Anchorage Library and assign them to foundations, and each area's materials appear here." action={<Link to={paths.anchorage(projectId)} className="text-[13px] underline underline-offset-4">Anchorage types</Link>} />
  return (
    <div className="space-y-8">
      {!areaId && <Chips label="Area" value={area.areaKey} onChange={(v) => setParams({ area: v }, { replace: true })} items={tree.map((a) => ({ id: a.areaKey, label: a.name }))} />}
      <div className="divide-y divide-line border-y border-line">
        {area.categories.map((cat) => {
          const catKey = `${area.areaKey}|${cat.category}`
          const catOpen = openCats.has(catKey)
          return (
            <section key={cat.category} aria-label={cat.label}>
              <h3>
                <button type="button" aria-expanded={catOpen} onClick={() => toggleCat(catKey)} className="flex w-full items-center gap-3 py-4 text-left">
                  <ChevronRight size={14} strokeWidth={1.5} className={`shrink-0 text-muted transition-transform ${catOpen ? 'rotate-90' : ''}`} />
                  <span className="flex-1 text-[15px] font-medium">{cat.label}</span>
                  <span className="text-[13px] font-normal tabular-nums text-muted" aria-label={`${cat.groups.length} specification${cat.groups.length === 1 ? '' : 's'}`}>{cat.groups.length}</span>
                </button>
              </h3>
              {catOpen && (
                <table className="mb-4 w-full table-fixed text-left text-[13px]">
                  <colgroup><col className="w-10" /><col /><col className="w-28" /></colgroup>
                  <thead className="sr-only"><tr><th scope="col">Expand</th><th scope="col">Material</th><th scope="col">Required</th></tr></thead>
                  <tbody>
                    {cat.groups.map((g) => {
                      const isOpen = open.has(g.key)
                      const label = materialLabel(g)
                      return [
                        <tr key={g.key} className="border-t border-line transition-colors hover:bg-hover">
                          <td className="pr-0"><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} what makes up ${label.title} ${label.sub}`} onClick={() => toggle(g.key)} className="grid h-8 w-8 place-items-center text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                          <td><button type="button" onClick={() => toggle(g.key)} className="block w-full text-left"><span className="block truncate font-medium" title={label.title}>{label.title}</span><span className="block truncate text-xs text-muted" title={label.sub}>{label.sub}</span></button></td>
                          <td className="text-right font-medium">{fmt(g.required)}{g.unit && g.unit !== 'ea' && <span className="ml-1 text-xs font-normal text-muted">{g.unit}</span>}</td>
                        </tr>,
                        isOpen && <tr key={`${g.key}-detail`}><td colSpan={3} data-wrap className="border-t border-line bg-hover px-3"><Contributions g={g} all={groups} /></td></tr>,
                      ]
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
