import { ChevronRight } from 'lucide-react'
import { GAUGE_GRID, GaugeCaption, GaugeCard, ProgressGauge } from '@/components/ui/ProgressGauge'
import { useIsPhone } from '@/lib/useMedia'
import { Input } from '@/components/ui/Field'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConstruction } from '../../store'
import { paths } from '../../paths'
import { Button } from '@/components/ui/Button'
import { useAccess } from '@/lib/access'
import { archiveMaterials, editMaterial, recordInstallation, voidInstallation } from '../commands'
import { CATEGORY_ORDER } from '../selectors'
import { CATEGORY_TITLE, entryNotes, materialLabel, type Consolidated } from '../consolidate'
import { MATERIAL_STATUS_LABEL, mergeAcrossAreas, procurementRows, progressCounts, type MaterialStatus, type MergedRow, type ProcRow } from '../procurement'
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

const STATUS_TONE: Record<MaterialStatus, Tone> = { pending: 'muted', 'partially-ordered': 'info', ordered: 'info', 'partially-delivered': 'warn', delivered: 'neutral', 'partially-installed': 'warn', installed: 'ok' }
export const StageBadge = ({ stage }: { stage: MaterialStatus }) => <StatusBadge tone={STATUS_TONE[stage]} label={MATERIAL_STATUS_LABEL[stage]} />
const when = (at: string) => (at ? new Date(at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '')

/** Four rings counted in requirements (lines), not units, laid out exactly like the Area Overview gauges. */
function Gauges({ rows }: { rows: { required: number; ordered: number; received: number; allocated: number }[] }) {
  const phone = useIsPhone()
  const c = progressCounts(rows)
  const items = [
    { label: 'Ordered', n: c.ordered, sub: 'Fully ordered' }, { label: 'Delivered', n: c.delivered, sub: 'Fully received' },
    { label: 'Allocated', n: c.allocated, sub: 'Fully allocated' }, { label: 'Outstanding', n: c.outstanding, sub: 'Not yet fully ordered' },
  ]
  return (
    <section aria-label="Progress">
      <ul className={phone ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : GAUGE_GRID}>
        {items.map((i) => (
          <li key={i.label}>
            {phone
              ? <GaugeCard title={i.label} count={i.n} of={c.total}><p className="mt-1.5 text-[14px] tabular-nums">{i.n} of {c.total}</p><p className="text-[12.5px] leading-snug text-muted">{i.sub}</p></GaugeCard>
              : <ProgressGauge title={i.label} count={i.n} of={c.total}><GaugeCaption>{i.sub}</GaugeCaption></ProgressGauge>}
          </li>
        ))}
      </ul>
    </section>
  )
}

const Q = ({ k, v }: { k: string; v: number }) => <div><dt className="t-label">{k}</dt><dd className="mt-1 text-lg font-medium tabular-nums">{fmt(v)}</dd></div>

/** Record and review installation for one requirement. It is separate from delivery and allocation. */
function Installation({ row, today }: { row: ProcRow; today: string }) {
  const access = useAccess()
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true); setError('')
    const e = await trackerStore.run(recordInstallation({ key: row.key, qty: Number(qty), date, note }, today))
    setSaving(false)
    if (e) setError(e); else { setQty(''); setNote('') }
  }
  return (
    <div className="max-w-3xl space-y-3">
      <p className="t-label">Installation</p>
      {row.installations.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {row.installations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{formatDate(i.date)}{i.note ? ` · ${i.note}` : ''} · recorded by {i.by || 'user not recorded'}{i.at ? ` on ${when(i.at)}` : ''}</span>
              <span className="flex items-center gap-3"><span className="tabular-nums">{fmt(i.qty)} {row.unit}</span>{access.can('materials.void-receipt') && <button type="button" className="text-xs text-muted underline underline-offset-4 hover:text-ink" onClick={() => { if (window.confirm('Void this installation record? It stays in the history.')) void trackerStore.run(voidInstallation(i.id)).then((e) => setError(e ?? '')) }}>Void</button>}</span>
            </li>
          ))}
        </ul>
      )}
      {access.can('materials.receive') && (row.installed >= row.required ? <p className="text-muted">The full {fmt(row.required)} is installed.</p> : row.installable === 0 ? <p className="text-muted">Nothing received is waiting to be installed. Receive material in Procurement first.</p> : (
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[8rem_9rem_1fr_auto]">
          <label className="block"><span className="t-label mb-1.5 block">Installed now</span><Input aria-label="Quantity installed" inputMode="numeric" value={qty} placeholder={String(row.installable)} onChange={(e) => { setQty(e.target.value); setError('') }} /></label>
          <label className="block"><span className="t-label mb-1.5 block">Date</span><Input aria-label="Installation date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="col-span-2 block sm:col-span-1"><span className="t-label mb-1.5 block">Note (optional)</span><Input aria-label="Installation note" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <Button variant="primary" className="col-span-2 sm:col-span-1" disabled={saving || qty.trim() === ''} onClick={() => void save()}>{saving ? 'Saving…' : 'Record installation'}</Button>
        </div>
      ))}
      {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
    </div>
  )
}

/** One area's requirement opened: its quantities, the foundations behind the total, and installation. */
function AreaDetail({ row, all, today }: { row: ProcRow; all: ProcRow[]; today: string }) {
  return (
    <div className="space-y-4 py-3 text-[13px]">
      <dl className="grid max-w-3xl grid-cols-3 gap-4 sm:grid-cols-5"><Q k="Required" v={row.required} /><Q k="Ordered" v={row.ordered} /><Q k="Delivered" v={row.received} /><Q k="Allocated" v={row.allocated} /><Q k="Installed" v={row.installed} /></dl>
      <Contributions g={row} all={all} />
      <Installation row={row} today={today} />
    </div>
  )
}

/** The same requirement in every area that needs it. */
function OverviewDetail({ m }: { m: MergedRow }) {
  return (
    <div className="space-y-3 py-3 text-[13px]">
      <table data-table="free" className="w-full max-w-3xl text-left" aria-label={`Areas needing ${m.name}`}>
        <thead><tr className="border-b border-line">{['Area', 'Required', 'Ordered', 'Delivered', 'Installed', 'Status'].map((h, i) => <th key={h} scope="col" className={`t-label py-2 font-medium ${i > 0 && i < 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>
          {m.areas.map((a) => (
            <tr key={a.key} className="border-b border-line"><td className="py-2">{a.area}</td><td className="py-2 text-right">{fmt(a.required)}</td><td className="py-2 text-right">{fmt(a.ordered)}</td><td className="py-2 text-right">{fmt(a.received)}</td><td className="py-2 text-right">{fmt(a.installed)}</td><td className="py-2 pl-3"><StageBadge stage={a.stage} /></td></tr>
          ))}
        </tbody>
        <tfoot><tr><td className="py-2 font-medium">All areas</td><td className="py-2 text-right font-medium">{fmt(m.required)}</td><td className="py-2 text-right font-medium">{fmt(m.ordered)}</td><td className="py-2 text-right font-medium">{fmt(m.received)}</td><td className="py-2 text-right font-medium">{fmt(m.installed)}</td><td /></tr></tfoot>
      </table>
      <p className="text-xs text-muted">Choose an area above to see the foundations behind its figure and to record installation.</p>
    </div>
  )
}

interface ListRow { key: string; category: ProcRow['category']; label: { title: string; sub: string }; required: number; unit: string; stage: MaterialStatus; detail: React.ReactNode }

/**
 * Materials: an Overview of every area, or one area, with progress gauges, materials by category and specification, each with its own status
 * (pending → ordered → delivered → installed), opening to what makes up its total. Counted in requirements; Procurement reads the same records.
 */
export function MaterialsByArea({ areaId }: { areaId?: string }) {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { state, today } = useTracker()
  const { state: construction } = useConstruction()
  const rows = useMemo(() => {
    const mine = new Set(construction.areas.filter((a) => a.projectId === projectId).map((a) => a.id))
    return procurementRows(state, construction).filter((r) => r.required > 0 && (areaId ? r.areaId === areaId : r.areaId ? mine.has(r.areaId) : true))
  }, [state, construction, projectId, areaId])
  // Every area of the project is offered (a new area appears at once, even before it needs any material), plus any area named only on a material.
  const areas = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of construction.areas.filter((x) => x.projectId === projectId && !x.archived && (!areaId || x.id === areaId)).sort((x, y) => x.sequence - y.sequence)) m.set(a.id, a.name)
    for (const r of rows) if (!m.has(r.areaId ?? `t:${r.area}`)) m.set(r.areaId ?? `t:${r.area}`, r.area)
    return [...m]
  }, [rows, construction.areas, projectId, areaId])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const picked = params.get('area') ?? ''
  const view = areaId ? areas[0]?.[0] ?? '' : areas.some(([id]) => id === picked) ? picked : ''
  const overview = !areaId && view === ''
  const shown = overview ? rows : rows.filter((r) => (r.areaId ?? `t:${r.area}`) === view)
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }

  if (rows.length === 0 && areas.length === 0) return <EmptyState title="No materials required yet" description="Configure anchorage types in the Anchorage Library and assign them to foundations, or add footing anchor bolts to a foundation, and each area's materials appear here." action={<Link to={paths.anchorage(projectId)} className="text-[13px] underline underline-offset-4">Anchorage types</Link>} />

  const merged = overview ? mergeAcrossAreas(rows) : []
  const list: ListRow[] = overview
    ? merged.map((m) => ({ key: m.specKey, category: m.category, label: materialLabel({ ...m, contributions: m.areas.flatMap((a) => a.contributions) } as unknown as Consolidated), required: m.required, unit: m.unit, stage: m.stage, detail: <OverviewDetail m={m} /> }))
    : shown.map((r) => ({ key: r.key, category: r.category, label: materialLabel(r), required: r.required, unit: r.unit, stage: r.stage, detail: <AreaDetail row={r} all={shown} today={today} /> }))
  const cats = CATEGORY_ORDER.filter((c) => list.some((l) => l.category === c))
  return (
    <div className="space-y-6">
      {!areaId && <Chips label="View" value={view} onChange={(v) => setParams(v ? { area: v } : {}, { replace: true })} items={[{ id: '', label: 'Overview' }, ...areas.map(([id, name]) => ({ id, label: name }))]} />}
      <Gauges rows={overview ? merged : shown} />
      {list.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No materials are required in this area yet. They appear once anchorage types are assigned to its foundations or footing anchor bolts are added.</p>}
      <div className="divide-y divide-line border-y border-line">
        {cats.map((cat) => {
          const items = list.filter((l) => l.category === cat)
          const catKey = `${view || 'all'}|${cat}`
          const catOpen = openCats.has(catKey)
          return (
            <section key={cat} aria-label={CATEGORY_TITLE[cat]}>
              <h3>
                <button type="button" aria-expanded={catOpen} onClick={() => setOpenCats(toggle(openCats, catKey))} className="flex w-full items-center gap-3 py-4 text-left">
                  <ChevronRight size={14} strokeWidth={1.5} className={`shrink-0 text-muted transition-transform ${catOpen ? 'rotate-90' : ''}`} />
                  <span className="flex-1 text-[15px] font-medium">{CATEGORY_TITLE[cat]}</span>
                  <span className="text-[13px] font-normal tabular-nums text-muted" aria-label={`${items.length} specification${items.length === 1 ? '' : 's'}`}>{items.length}</span>
                </button>
              </h3>
              {catOpen && (
                <table className="mb-4 w-full table-fixed text-left text-[13px]">
                  <colgroup><col className="w-10" /><col /><col className="w-44 phone:hidden" /><col className="w-28" /></colgroup>
                  <thead className="sr-only"><tr><th scope="col">Expand</th><th scope="col">Material</th><th scope="col">Status</th><th scope="col">Required</th></tr></thead>
                  <tbody>
                    {items.map((l) => {
                      const isOpen = open.has(`${view}|${l.key}`)
                      return [
                        <tr key={l.key} className="border-t border-line transition-colors hover:bg-hover">
                          <td className="pr-0"><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details of ${l.label.title} ${l.label.sub}`} onClick={() => setOpen(toggle(open, `${view}|${l.key}`))} className="grid h-8 w-8 place-items-center text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                          <td><button type="button" onClick={() => setOpen(toggle(open, `${view}|${l.key}`))} className="block w-full text-left"><span className="block truncate font-medium" title={l.label.title}>{l.label.title}</span><span className="block truncate text-xs text-muted" title={l.label.sub}>{l.label.sub}</span><span className="mt-0.5 hidden phone:block"><StageBadge stage={l.stage} /></span></button></td>
                          <td className="phone:hidden"><StageBadge stage={l.stage} /></td>
                          <td className="text-right font-medium">{fmt(l.required)}{l.unit && l.unit !== 'ea' && <span className="ml-1 text-xs font-normal text-muted">{l.unit}</span>}</td>
                        </tr>,
                        isOpen && <tr key={`${l.key}-detail`}><td colSpan={4} data-wrap className="border-t border-line bg-hover px-3">{l.detail}</td></tr>,
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
