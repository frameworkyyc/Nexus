import { ArrowDown, ArrowUp, Download, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CompactInput, CompactSelect } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { Stat } from '@/components/ui/Stat'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { useAccess } from '@/lib/access'
import { formatDate } from '@/lib/format'
import { archiveMaterials, bulkEditMaterials, editMaterial } from '../commands'
import { ImportButton } from '../ImportModal'
import { LineModal } from '../LineModal'
import {
  areaBreakdown, CATEGORY_LABEL, CATEGORY_ORDER, dashboardCounts, DELIVERY_LABEL, distinct, filterLines, groupLabel, sortLines,
  type DeliveryState, type GroupKey, type LineFilter, type LineView, type SortKey,
} from '../selectors'
import { lineProgress, materialsModel } from '../model'
import { MATERIAL_STATUS_LABEL } from '../procurement'
import { useConstruction } from '../../store'
import { StageBadge } from './MaterialsByArea'
import { useTracker, useTrackerCommand } from '../store'
import type { MaterialRefs } from './useMaterialRefs'
import type { ComponentCategory, TrackerLine } from '../types'
import { anchorageFor, foundationsOfArea, legacyIssues } from '../catalog'
import { AddMaterialModal, blankMaterial } from './AddMaterialModal'
import { ReconcileModal } from './ReconcileModal'
import { SupplierSettings } from './SupplierSettings'
import { useMaterialRefs } from './useMaterialRefs'
import { downloadMaterialsCsv } from './csv'

const TONE: Record<DeliveryState, Tone> = { received: 'ok', 'over-received': 'warn', partial: 'warn', 'none-received': 'muted' }
const STATUS_FILTER: DeliveryState[] = ['none-received', 'partial', 'received', 'over-received']
const num = (n: number | null) => (n === null ? <span className="text-muted">—</span> : <span className="tabular-nums">{n.toLocaleString('en-CA')}</span>)

/**
 * The Materials dashboard: counts, area breakdown, search and filters, a sortable spreadsheet-style table (cards on a phone) with
 * inline editing, and bulk tools. What each control does depends on the role; the server enforces the same rules.
 */
export function MaterialsManager({ lines, scopeName, hideArea, projectId, defaultAreaId }: { lines: TrackerLine[]; scopeName: string; hideArea?: boolean; projectId?: string; defaultAreaId?: string }) {
  const access = useAccess()
  const refs = useMaterialRefs(projectId)
  const [settings, setSettings] = useState(false)
  const [reconcile, setReconcile] = useState(false)
  const issues = useMemo(() => lines.filter((l) => !l.archived).flatMap((l) => legacyIssues(l, refs.catalog, refs.suppliers)), [lines, refs])
  const { run } = useTrackerCommand()
  const [filter, setFilter] = useState<LineFilter>({})
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'area', dir: 'asc' })
  const [group, setGroup] = useState<GroupKey>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)

  // Every figure on this page comes from the unified materials model, so Material records agree with Materials, Procurement and the Area Overview.
  const { state: tracker } = useTracker()
  const { state: construction } = useConstruction()
  const model = useMemo(() => materialsModel(tracker, construction), [tracker, construction])
  const progress = useCallback((l: TrackerLine) => lineProgress(model, l), [model])
  const view = useCallback((l: TrackerLine): LineView => { const p = progress(l); return { received: p.received, outstanding: p.outstanding, state: p.state, label: p.stage ? MATERIAL_STATUS_LABEL[p.stage] : DELIVERY_LABEL[p.state] } }, [progress])
  const active = useMemo(() => lines.filter((l) => !l.archived), [lines])
  const archivedCount = lines.length - active.length
  const counts = useMemo(() => dashboardCounts(active, (l) => progress(l).state), [active, progress])
  const breakdown = useMemo(() => areaBreakdown(active, progress), [active, progress])
  const rows = useMemo(() => sortLines(filterLines(lines, filter, (l) => progress(l).state), sort.key, sort.dir, view), [lines, filter, sort, progress, view])
  const set = (patch: Partial<LineFilter>) => setFilter((f) => ({ ...f, ...patch }))
  const canAdd = access.can('materials.add'), canEdit = access.can('materials.edit'), canBulk = access.can('materials.bulk'), canArchive = access.can('materials.archive')
  const chosen = rows.filter((l) => selected.has(l.id))
  const groups = useMemo(() => {
    if (!group) return [{ label: '', rows }]
    const m = new Map<string, TrackerLine[]>()
    for (const l of rows) { const k = groupLabel(l, group, view); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m].map(([label, r]) => ({ label, rows: r }))
  }, [rows, group, view])
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const filtered = Object.values(filter).some((v) => v && v !== 'active')

  const Th = ({ k, children, right, hide }: { k: SortKey; children: string; right?: boolean; hide?: boolean }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`t-label py-3 pr-4 font-medium ${right ? 'text-right' : ''} ${hide ? 'hidden md:table-cell' : ''}`}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-ink">{children}{sort.key === k && (sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}</button>
    </th>
  )

  const supplierCell = (l: TrackerLine) => {
    if (!canEdit || l.archived) return l.supplier ? <span>{l.supplier}</span> : <span className="text-muted">—</span>
    const legacy = !l.supplierId && !!l.supplier
    return (
      <CompactSelect aria-label={`Supplier for ${l.component}`} className="w-44" value={l.supplierId ?? (legacy ? '__legacy' : '')} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { if (e.target.value !== '__legacy') run(editMaterial(l.id, { supplierId: e.target.value }), () => undefined) }}>
        <option value="">—</option>
        {legacy && <option value="__legacy" disabled>{l.supplier} (not linked)</option>}
        {refs.suppliers.filter((x) => !x.archived || x.id === l.supplierId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </CompactSelect>
    )
  }
  const inline = (l: TrackerLine, field: 'poRef' | 'expectedDate' | 'requiredQty', value: string, props: { type?: string; label: string }) => {
    const manualOnly = field === 'requiredQty'
    const editable = canEdit && (!manualOnly || l.origin === 'manual') && !l.archived
    if (!editable) return value ? <span className="tabular-nums">{field === 'expectedDate' ? formatDate(value) : value}</span> : <span className="text-muted">—</span>
    return (
      <CompactInput key={`${l.id}-${value}`} aria-label={`${props.label} for ${l.component}`} type={props.type} inputMode={field === 'requiredQty' ? 'numeric' : undefined} defaultValue={value}
        className={field === 'requiredQty' ? 'w-20 text-right tabular-nums' : field === 'expectedDate' ? 'w-36' : 'w-40'}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = value; (e.target as HTMLInputElement).blur() } }}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v === value) return
          run(editMaterial(l.id, { [field]: field === 'requiredQty' ? Number(v) : v }), () => undefined)
        }} />
    )
  }

  return (
    <div>
      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        <Stat label="Line items" value={counts.total} sub={archivedCount ? `${archivedCount} archived hidden` : scopeName} />
        <Stat label="Delivered" value={counts.delivered} sub="Received, checked and confirmed" />
        <Stat label="Partially delivered" value={counts.partial} sub="Some confirmed, some outstanding" />
        <Stat label="Not delivered" value={counts.pending} sub="Nothing confirmed yet" />
      </dl>

      {!hideArea && breakdown.length > 1 && (
        <section aria-label="Area breakdown" className="mt-6">
          <h3 className="t-label mb-2">By area</h3>
          <ul className="divide-y divide-line border-y border-line">
            {breakdown.map((a) => (
              <li key={a.area}>
                <button type="button" onClick={() => set({ area: filter.area === a.area ? '' : a.area })} aria-pressed={filter.area === a.area}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 text-left text-[13px] hover:bg-hover md:grid-cols-[14rem_minmax(0,1fr)_auto] ${filter.area === a.area ? 'bg-hover' : ''}`}>
                  <span className="font-medium">{a.area}</span>
                  <span className="order-3 col-span-2 md:order-none md:col-span-1" aria-hidden><span className="block h-1 w-full bg-line"><span className="block h-1 bg-ok" style={{ width: `${a.required ? Math.round((a.received / a.required) * 100) : 0}%` }} /></span></span>
                  <span className="text-xs text-muted">{a.total} items · {a.delivered} delivered · {a.partial} partial · {a.pending} not delivered</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {canAdd && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} strokeWidth={1.5} />Add material</Button>}
        {access.can('materials.import') && <ImportButton label="Import workbook" />}
        <Button variant="ghost" onClick={() => setSettings(true)}>Suppliers &amp; defaults</Button>
        <Button onClick={() => downloadMaterialsCsv(chosen.length ? chosen : rows, 'materials', view)} disabled={rows.length === 0}><Download size={14} strokeWidth={1.5} />Export {chosen.length ? `${chosen.length} selected` : filtered ? 'filtered' : 'all'}</Button>
      </div>

      {issues.length > 0 && (
        <p role="status" className="mt-4 border-l-2 border-warn pl-3 text-[13px]">{issues.length} value{issues.length === 1 ? '' : 's'} on materials {issues.length === 1 ? 'isn’t' : 'aren’t'} linked to a project record yet (kept exactly as written). <button className="underline underline-offset-4" onClick={() => setReconcile(true)}>Review</button></p>
      )}
      <div className="mb-3 mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <div className="col-span-2 md:col-span-4 xl:col-span-2"><Input type="search" aria-label="Search materials" placeholder="Search name, specification, supplier, PO, notes…" value={filter.search ?? ''} onChange={(e) => set({ search: e.target.value })} data-search /></div>
        {!hideArea && <Select aria-label="Area" value={filter.area ?? ''} onChange={(e) => set({ area: e.target.value })}><option value="">All areas</option>{distinct(lines.map((l) => l.area)).map((a) => <option key={a}>{a}</option>)}</Select>}
        <Select aria-label="Foundation" value={filter.footingType ?? ''} onChange={(e) => set({ footingType: e.target.value })}><option value="">All foundations</option>{distinct(lines.filter((l) => !filter.area || l.area === filter.area).map((l) => l.footingType)).map((a) => <option key={a} value={a}>{a || '(none)'}</option>)}</Select>
        <Select aria-label="Category" value={filter.category ?? ''} onChange={(e) => set({ category: e.target.value as ComponentCategory | '' })}><option value="">All categories</option>{CATEGORY_ORDER.filter((c) => lines.some((l) => l.category === c)).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>
        <Select aria-label="Specification" value={filter.specification ?? ''} onChange={(e) => set({ specification: e.target.value })}><option value="">All specifications</option>{distinct(lines.map((l) => l.specification ?? '').filter(Boolean)).map((a) => <option key={a}>{a}</option>)}</Select>
        <Select aria-label="Supplier" value={filter.supplier ?? ''} onChange={(e) => set({ supplier: e.target.value })}><option value="">All suppliers</option>{distinct(lines.map((l) => l.supplier ?? '').filter(Boolean)).map((a) => <option key={a}>{a}</option>)}</Select>
        <Select aria-label="Delivery status" value={filter.delivery ?? ''} onChange={(e) => set({ delivery: e.target.value as DeliveryState | '' })}><option value="">Any delivery status</option>{STATUS_FILTER.map((d) => <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}</Select>
        <Select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}><option value="">No grouping</option><option value="area">Group by area</option><option value="location">Group by foundation</option><option value="category">Group by category</option><option value="specification">Group by specification</option><option value="supplier">Group by supplier</option><option value="status">Group by delivery status</option></Select>
        <Select aria-label="Show" value={filter.archived ?? 'active'} onChange={(e) => set({ archived: e.target.value as LineFilter['archived'] })}><option value="active">Active materials</option><option value="archived">Archived only</option><option value="all">Active and archived</option></Select>
      </div>
      <p className="mb-2 text-xs text-muted" aria-live="polite">{rows.length} of {lines.length} line{lines.length === 1 ? '' : 's'}{filtered && <> · <button className="underline underline-offset-4" onClick={() => setFilter({})}>Clear filters</button></>}</p>

      {canBulk && selected.size > 0 && (
        <div role="region" aria-label="Selected materials" className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 border border-ink bg-surface px-3 py-2 text-[13px]">
          <span className="mr-2 font-medium">{chosen.length} selected</span>
          <Button onClick={() => setBulk(true)}>Edit selected</Button>
          {canArchive && <Button onClick={() => window.confirm(`Archive ${chosen.length} material${chosen.length === 1 ? '' : 's'}? They leave the working list and totals; receipts and history are kept and they can be restored.`) && run(archiveMaterials(chosen.map((l) => l.id), true), () => setSelected(new Set()))}>Archive</Button>}
          {canArchive && chosen.some((l) => l.archived) && <Button onClick={() => run(archiveMaterials(chosen.filter((l) => l.archived).map((l) => l.id), false), () => setSelected(new Set()))}>Restore</Button>}
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title={lines.length ? 'No materials match these filters' : 'No materials yet'} description={lines.length ? undefined : canAdd ? 'Add the first material or import the workbook.' : 'Nothing has been entered.'} action={lines.length ? undefined : canAdd ? <Button variant="primary" onClick={() => setAdding(true)}>Add material</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="card-table w-full min-w-[1180px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th k="name">Material</Th>
                {!hideArea && <Th k="area">Area</Th>}
                <Th k="location">Foundation</Th>
                <Th k="category" hide>Category</Th>
                <Th k="required" right>Required</Th>
                <Th k="received" right>Received</Th>
                <Th k="outstanding" right>Outstanding</Th>
                <Th k="status">Delivery</Th>
                <Th k="supplier">Supplier</Th>
                <Th k="expected" hide>Expected</Th>
                <th scope="col" className="t-label hidden py-3 pr-4 font-medium md:table-cell">PO / ref.</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.label || 'all'}>
                {g.label && <tr data-wide><td colSpan={11} className="border-b border-line bg-hover px-2 py-2 text-xs font-medium">{g.label} <span className="font-normal text-muted">· {g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span></td></tr>}
                {g.rows.map((l) => {
                  const pr = progress(l)
                  return (
                    <tr key={l.id} className={`border-b border-line transition-colors hover:bg-hover ${l.archived ? 'opacity-60' : ''}`}>
                      <td className="min-w-[17rem] py-2.5 pr-4 align-middle">
                        <span className="flex items-start gap-2">
                          {canBulk && <input type="checkbox" aria-label={`Select ${l.component}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="mt-1 h-4 w-4 phone:h-6 phone:w-6" />}
                          <button type="button" onClick={() => setOpen(l.id)} className="min-w-0 text-left">
                            <span className="font-medium underline-offset-4 hover:underline">{l.component}</span>{l.origin === 'anchorage' && <span className="ml-2 rounded-nx border border-line px-1.5 py-0.5 text-[11px] font-normal text-muted">Calculated</span>}{l.requirementRemoved && <span className="ml-2 text-xs font-normal text-warn">No longer required</span>}
                            <span className="block text-xs text-muted">{[l.specification, l.size].filter(Boolean).join(' · ') || (l.origin === 'manual' ? CATEGORY_LABEL[l.category] : `${l.anchorageType || CATEGORY_LABEL[l.category]} · ${l.source.sheet} row ${l.source.row}`)}{l.archived ? ' · archived' : ''}</span>
                          </button>
                        </span>
                      </td>
                      {!hideArea && <td className="py-2.5 pr-4">{l.area}</td>}
                      <td className="py-2.5 pr-4">{l.footingType || <span className="text-muted">—</span>}</td>
                      <td className="hidden py-2.5 pr-4 md:table-cell">{CATEGORY_LABEL[l.category]}</td>
                      <td className="py-2.5 pr-4 text-right">{l.origin === 'anchorage' || (l.basis && l.basis !== 'fixed') ? <span className="tabular-nums">{l.requiredQty.toLocaleString('en-CA')}</span> : inline(l, 'requiredQty', String(l.requiredQty), { type: 'text', label: 'Required' })}{l.unit && l.unit !== 'ea' && <span className="ml-1 text-xs text-muted">{l.unit}</span>}{(l.origin === 'anchorage' || (l.basis && l.basis !== 'fixed')) && <span className="block max-w-[16rem] text-xs text-muted" title={l.calc.expression}>{l.calc.expression}</span>}</td>
                      <td className="py-2.5 pr-4 text-right" title={pr.shared ? 'Received for the whole requirement (all lines of this specification in the area)' : undefined}>{num(pr.received)}</td>
                      <td className="py-2.5 pr-4 text-right" title={pr.shared ? 'Outstanding for the whole requirement (all lines of this specification in the area)' : undefined}>{num(pr.outstanding)}</td>
                      <td className="py-2.5 pr-4">{pr.stage ? <StageBadge stage={pr.stage} /> : <StatusBadge tone={TONE[pr.state]} label={DELIVERY_LABEL[pr.state]} />}</td>
                      <td className="py-2.5 pr-4">{supplierCell(l)}</td>
                      <td className="hidden py-2.5 pr-4 md:table-cell">{inline(l, 'expectedDate', l.expectedDate ?? '', { type: 'date', label: 'Expected delivery' })}</td>
                      <td className="hidden py-2.5 pr-4 md:table-cell">{inline(l, 'poRef', l.poRef ?? '', { label: 'PO / reference' })}</td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {adding && <AddMaterialModal projectId={projectId} initial={blankMaterial({ areaId: refs.catalog.areas.find((x) => x.name === filter.area)?.id ?? defaultAreaId ?? '', foundationId: refs.catalog.foundations.find((x) => x.number === filter.footingType && x.areaId === (refs.catalog.areas.find((y) => y.name === filter.area)?.id ?? defaultAreaId))?.id ?? '' })} title="Add material" onClose={() => setAdding(false)} />}
      {bulk && <BulkModal lines={chosen} refs={refs} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setSelected(new Set()) }} />}
      {open && <LineModal lineId={open} onClose={() => setOpen(null)} />}
      {settings && <SupplierSettings onClose={() => setSettings(false)} />}
      {reconcile && <ReconcileModal lines={lines} refs={refs} onClose={() => setReconcile(false)} />}
    </div>
  )
}

function BulkModal({ lines, refs, onClose, onDone }: { lines: TrackerLine[]; refs: MaterialRefs; onClose: () => void; onDone: () => void }) {
  const { run, saving } = useTrackerCommand()
  const [f, setF] = useState({ supplierId: null as string | null, poRef: '', expectedDate: '', unit: '', areaId: null as string | null, foundationId: null as string | null, anchorageTypeId: null as string | null })
  const [error, setError] = useState<string | null>(null)
  const hasWorkbook = lines.some((l) => l.origin !== 'manual')
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setError(null) }
  const patch: Record<string, string> = {}
  for (const [k, v] of Object.entries(f)) if (v !== null && v !== '') patch[k] = v
  // A deliberate "none" (empty string) is a change too, for the choices that allow clearing.
  for (const k of ['supplierId', 'foundationId', 'anchorageTypeId'] as const) if (f[k] === '') patch[k] = ''
  const apply = () => {
    if (Object.keys(patch).length === 0) { setError('Choose at least one thing to change.'); return }
    run(bulkEditMaterials(lines.map((l) => l.id), patch), onDone)
  }
  const area = f.areaId
  const foundations = area ? foundationsOfArea(refs.catalog, area) : []
  return (
    <Modal title={`Edit ${lines.length} selected`} onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Only what you change is applied; everything else is left as it is. All selected materials are updated together, or none are.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier"><SearchSelect label="Supplier" value={f.supplierId ?? ''} options={refs.activeSuppliers.map((x) => ({ value: x.id, label: x.name }))} emptyLabel="Clear the supplier" placeholder={f.supplierId === '' ? 'Supplier will be cleared' : 'Leave unchanged'} onChange={(id) => set({ supplierId: id })} /></Field>
          <Field label="PO / reference"><Input value={f.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
          <Field label="Expected delivery"><Input type="date" value={f.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
          <Field label="Unit"><Input value={f.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>
        </div>
        <fieldset disabled={hasWorkbook} className="space-y-3 border-t border-line pt-3 disabled:opacity-50">
          <legend className="t-label">Move or restate (materials entered in Nexus only)</legend>
          {hasWorkbook && <p className="text-xs text-muted">Not available: the selection includes workbook lines, whose area and foundation stay as imported.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reassign to area"><SearchSelect label="Reassign to area" value={f.areaId ?? ''} options={refs.catalog.areas.map((a) => ({ value: a.id, label: a.name }))} placeholder="Leave unchanged" onChange={(id) => set({ areaId: id || null, foundationId: null })} /></Field>
            <Field label="Reassign to foundation"><SearchSelect label="Reassign to foundation" value={f.foundationId ?? ''} disabled={!area} options={foundations.map((x) => ({ value: x.id, label: x.number, hint: x.description || undefined }))} emptyLabel="No foundation (clear)" placeholder={f.foundationId === '' ? 'Foundation will be cleared' : area ? 'Choose a foundation' : 'Choose an area first'} onChange={(id) => set({ foundationId: id })} /></Field>
            <Field label="Anchorage type"><SearchSelect label="Anchorage type" value={f.anchorageTypeId ?? ''} options={anchorageFor(refs.catalog, f.foundationId || null).map((a) => ({ value: a.id, label: a.code, hint: a.description || undefined }))} emptyLabel="Clear the anchorage type" placeholder={f.anchorageTypeId === '' ? 'Anchorage will be cleared' : 'Leave unchanged'} onChange={(id) => set({ anchorageTypeId: id })} /></Field>
          </div>
          <p className="text-xs text-muted">Moving to another area needs a foundation in that area (or “none”).</p>
        </fieldset>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex gap-2"><Button variant="primary" disabled={saving} onClick={apply}>{saving ? 'Saving…' : `Apply to ${lines.length}`}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  )
}
