import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { SearchSelect, type SelectOption } from '@/components/ui/SearchSelect'
import { Segmented } from '@/components/mobile/Cards'
import { useToast } from '@/components/ui/Toast'
import { useAccess } from '@/lib/access'
import { paths } from '../../paths'
import { addMaterials, addSupplier } from '../commands'
import { anchorageFor, foundationsOfArea } from '../catalog'
import { effectiveSupplier, validateMaterial, type MaterialInput } from '../materialModel'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../selectors'
import { trackerStore } from '../store'
import { supplierId as idOfSupplier } from '../suppliers'
import { MATERIAL_TEMPLATES, UNITS } from '../templates'
import type { ComponentCategory, TrackerLine } from '../types'
import { useMaterialRefs } from './useMaterialRefs'

export const blankMaterial = (over: Partial<MaterialInput> = {}): MaterialInput => ({
  areaId: '', foundationId: '', anchorageTypeId: '', category: 'bolt', name: '', description: '', specification: '', size: '', requiredQty: 0, unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '', ...over,
})

/** Pre-fills a new material from an existing one (Duplicate). Quantities, receipts and history are not copied. */
export const duplicateOf = (l: TrackerLine): MaterialInput => blankMaterial({
  areaId: l.areaId ?? '', foundationId: l.foundationId ?? '', anchorageTypeId: l.anchorageTypeId ?? '', category: l.category, name: l.component, description: l.description ?? '', specification: l.specification ?? '', size: l.size ?? '',
  requiredQty: l.requiredQty, unit: l.unit || 'ea', supplierId: l.supplierId ?? '', poRef: l.poRef ?? '',
})

type Mode = 'one' | 'quick'
/** `null` on a row means "use the shared value"; a value (including '' for none) is that row's own, deliberate choice. */
interface QuickRow { name: string; specification: string; size: string; qty: string; category: ComponentCategory | null; anchorageTypeId: string | null; supplierId: string | null }
const emptyRow = (): QuickRow => ({ name: '', specification: '', size: '', qty: '', category: null, anchorageTypeId: null, supplierId: null })

/**
 * Add Material. Area, foundation and anchorage type are chosen from the project's own records; the supplier is suggested from the
 * category's preferred supplier and stays whatever the person picks. One form for a single record (with "Add another", which keeps the
 * area, foundation, anchorage and supplier choices), or Quick Add: one set of shared choices and many rows, any row able to use its own
 * category, anchorage type or supplier without disturbing the others.
 */
export function AddMaterialModal({ initial, duplicate, title = 'Add material', projectId, startQuick, onClose }: { initial?: MaterialInput; duplicate?: boolean; title?: string; projectId?: string; /** Open in Quick Add (several) mode. */ startQuick?: boolean; onClose: () => void }) {
  const toast = useToast()
  const access = useAccess()
  const refs = useMaterialRefs(projectId)
  const { catalog } = refs
  const start = initial ?? blankMaterial()
  const [mode, setMode] = useState<Mode>(startQuick ? 'quick' : 'one')
  const [m, setM] = useState<MaterialInput>(start)
  // Shared supplier: `manual` = the person chose it (or chose "none"), so changing the category never replaces it.
  const [supplier, setSupplier] = useState<{ id: string; manual: boolean }>({ id: start.supplierId, manual: !!start.supplierId })
  const [qty, setQty] = useState(start.requiredQty ? String(start.requiredQty) : '')
  const [rows, setRows] = useState<QuickRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [error, setError] = useState<string | null>(null)
  const [dup, setDup] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<MaterialInput>) => { setM((x) => ({ ...x, ...patch })); setError(null); setDup(false) }

  const foundations = useMemo(() => foundationsOfArea(catalog, m.areaId), [catalog, m.areaId])
  const supplierEffective = (category: ComponentCategory) => effectiveSupplier(supplier, null, refs.preferredFor(category))
  const sharedSupplier = supplierEffective(m.category)
  const supplierName = (id: string) => refs.suppliers.find((s) => s.id === id)?.name ?? ''

  const areaOptions: SelectOption[] = catalog.areas.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))
  const foundationOptions: SelectOption[] = foundations.map((f) => ({ value: f.id, label: f.number, hint: f.description || undefined }))
  const anchorageOptions: SelectOption[] = anchorageFor(catalog, m.foundationId).map((a) => ({ value: a.id, label: a.code, hint: a.description || undefined, group: m.foundationId ? (a.onFoundation ? 'Used on this foundation' : 'Other anchorage types') : undefined }))
  const supplierOptions: SelectOption[] = refs.activeSuppliers.map((s) => ({ value: s.id, label: s.name }))
  const canAddSupplier = access.can('suppliers.add')

  const changeArea = (areaId: string) => {
    // Foundations belong to one area, so a foundation chosen for another area is cleared instead of kept.
    const keep = catalog.foundations.find((f) => f.id === m.foundationId)?.areaId === areaId
    set({ areaId, foundationId: keep ? m.foundationId : '' })
  }
  const createSupplier = async (name: string): Promise<string | null> => {
    const err = await trackerStore.run(addSupplier(name))
    if (err !== null) { setError(err); return null }
    toast(`Added supplier “${name}”.`)
    return idOfSupplier(name)
  }

  const itemOf = (r?: QuickRow): MaterialInput => {
    const category = r?.category ?? m.category
    const base = { ...m, category, supplierId: effectiveSupplier(supplier, r?.supplierId ?? null, refs.preferredFor(category)) }
    return r
      ? { ...base, name: r.name, specification: r.specification, size: r.size, requiredQty: r.qty.trim() === '' ? NaN : Number(r.qty), anchorageTypeId: r.anchorageTypeId ?? m.anchorageTypeId, description: '', claimedStatus: '', notes: '' }
      : { ...base, requiredQty: qty.trim() === '' ? NaN : Number(qty) }
  }

  const submit = async (another: boolean, allowDuplicate = false) => {
    const used = rows.filter((r) => r.name || r.qty || r.specification || r.size)
    const items = mode === 'one' ? [itemOf()] : used.map(itemOf)
    if (items.length === 0) { setError('Enter at least one row.'); return }
    const env = { catalog, suppliers: refs.suppliers }
    for (const [i, it] of items.entries()) { const bad = validateMaterial(it, env); if (bad) { setError(`${items.length > 1 ? `Row ${i + 1}: ` : ''}${bad}`); return } }
    setSaving(true)
    const err = await trackerStore.run(addMaterials(items, allowDuplicate))
    setSaving(false)
    if (err !== null) { setError(err); setDup(/already exists|duplicate/i.test(err)); return }
    const where = `${catalog.areas.find((a) => a.id === m.areaId)?.name ?? ''}${m.foundationId ? ` · ${foundations.find((f) => f.id === m.foundationId)?.number}` : ''}`
    toast(items.length === 1 ? `Added “${items[0].name}” to ${where}.` : `Added ${items.length} materials to ${where}.`)
    if (!another) { onClose(); return }
    // Keep the working context (area, foundation, anchorage, supplier choice, category); clear what is specific to the item just entered.
    setM((x) => ({ ...x, name: '', description: '', specification: mode === 'one' ? '' : x.specification, size: '', requiredQty: 0, notes: '', claimedStatus: '' }))
    setQty(''); setRows([emptyRow(), emptyRow(), emptyRow()]); setError(null); setDup(false)
  }

  const applyTemplate = (id: string) => {
    const t = MATERIAL_TEMPLATES.find((x) => x.id === id)
    if (t) set({ category: t.category, unit: t.unit, name: m.name || t.name, specification: m.specification || t.specification })
  }
  const setRow = (i: number, patch: Partial<QuickRow>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setError(null); setDup(false) }

  const supplierField = (value: string, manual: boolean, onPick: (id: string) => void, onReset: (() => void) | null, label: string, hintCategory?: ComponentCategory) => (
    <>
      <SearchSelect label={label} value={value} options={supplierOptions} emptyLabel="No supplier" placeholder="Select a supplier" onChange={onPick}
        onCreate={canAddSupplier ? async (name) => { const id = await createSupplier(name); if (id) onPick(id) } : undefined} createLabel={(t) => `Add new supplier “${t}”`} />
      {hintCategory && !manual && value && <span className="mt-1 block text-xs text-muted">Preferred supplier for {CATEGORY_LABEL[hintCategory].toLowerCase()}. Pick another to override.</span>}
      {manual && onReset && <button type="button" className="mt-1 text-xs text-muted underline underline-offset-4 hover:text-ink" onClick={onReset}>Use the preferred supplier for the category</button>}
    </>
  )

  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="space-y-5 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); void submit(false) }} noValidate>
        {!duplicate && <Segmented<Mode> label="Entry mode" value={mode} onChange={setMode} items={[{ id: 'one', label: 'Single material' }, { id: 'quick', label: 'Quick add (several)' }]} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Area *"><SearchSelect label="Area" value={m.areaId} options={areaOptions} onChange={changeArea} placeholder="Select an area" /></Field>
          <Field label="Foundation"><SearchSelect label="Foundation" value={m.foundationId} options={foundationOptions} onChange={(id) => set({ foundationId: id })} disabled={!m.areaId} emptyLabel="No foundation (area-level)" placeholder={m.areaId ? (foundations.length ? 'Select a foundation' : 'No foundations in this area') : 'Select an area first'} /></Field>
          <Field label="Anchorage type"><SearchSelect label="Anchorage type" value={m.anchorageTypeId} options={anchorageOptions} onChange={(id) => set({ anchorageTypeId: id })} emptyLabel="None" placeholder="Search by code or description" /></Field>
        </div>
        {catalog.areas.filter((a) => !a.archived).length === 0 && (
          <p role="status" className="-mt-3 border-l-2 border-warn pl-3 text-xs">This project has no construction areas yet, so there is nothing to select. {access.can('structure.manage') ? <>Create an area in the <Link className="underline underline-offset-4" to={paths.register(projectId ?? '')} onClick={onClose}>Foundation Register</Link> first.</> : 'Ask an administrator to create the areas first.'}</p>
        )}
        {m.areaId && foundations.length === 0 && (
          <p className="-mt-3 text-xs text-muted">This area has no foundations yet. {access.can('structure.manage') ? <>Add them in the <Link className="underline underline-offset-4" to={paths.register(projectId ?? '')} onClick={onClose}>Foundation Register</Link>.</> : 'An administrator can add them in the Foundation Register.'}</p>
        )}
        {m.areaId && foundations.length > 0 && access.can('structure.manage') && <p className="-mt-3 text-xs text-muted">Foundation missing? Add it in the <Link className="underline underline-offset-4" to={paths.register(projectId ?? '')} onClick={onClose}>Foundation Register</Link>.</p>}

        {mode === 'one' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Start from a template"><Select aria-label="Template" value="" onChange={(e) => applyTemplate(e.target.value)}><option value="">Choose…</option>{MATERIAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
              <Field label="Category *"><Select aria-label="Category" value={m.category} onChange={(e) => set({ category: e.target.value as ComponentCategory })}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
              <Field label="Material name *"><Input value={m.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Specification"><Input value={m.specification} onChange={(e) => set({ specification: e.target.value })} placeholder="e.g. ASTM F1554 Gr.36" /></Field>
              <Field label="Size / dimensions"><Input value={m.size} onChange={(e) => set({ size: e.target.value })} placeholder={'e.g. 3/4" x 460 mm'} /></Field>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field label="Qty required *"><Input inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setError(null); setDup(false) }} /></Field>
                <Field label="Unit"><Select aria-label="Unit" value={m.unit} onChange={(e) => set({ unit: e.target.value })}>{[...new Set([m.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}</Select></Field>
              </div>
            </div>
            <Field label="Description"><Input value={m.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <div><Field label="Supplier">{supplierField(sharedSupplier, supplier.manual, (id) => { setSupplier({ id, manual: true }); setError(null) }, () => setSupplier({ id: '', manual: false }), 'Supplier', m.category)}</Field></div>
              <Field label="PO / reference"><Input value={m.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
              <Field label="Expected delivery"><Input type="date" value={m.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
              <Field label="Delivery status"><Select aria-label="Delivery status" value={m.claimedStatus} onChange={(e) => set({ claimedStatus: e.target.value })}><option value="">Not verified</option><option>Pending</option><option>Delivered</option></Select></Field>
            </div>
            <p className="-mt-2 text-xs text-muted">Delivery status is a note, not a receipt. Quantity received only counts once a delivery is recorded on the material.</p>
            <Field label="Notes"><Textarea rows={2} value={m.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Default category *"><Select aria-label="Default category" value={m.category} onChange={(e) => set({ category: e.target.value as ComponentCategory })}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
              <div><Field label="Default supplier">{supplierField(sharedSupplier, supplier.manual, (id) => { setSupplier({ id, manual: true }); setError(null) }, () => setSupplier({ id: '', manual: false }), 'Default supplier', m.category)}</Field></div>
              <Field label="PO / reference"><Input value={m.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
            </div>
            <p className="-mt-2 text-xs text-muted">Area, foundation, anchorage type and supplier apply to every row. A row can use its own category, anchorage type or supplier; changing a default never replaces a row’s own choice.</p>
            <div className="space-y-4">
              {rows.map((r, i) => {
                const cat = r.category ?? m.category
                const effSupplier = r.supplierId ?? supplierEffective(cat)
                return (
                  <fieldset key={i} className="space-y-2 border-t border-line pt-3">
                    <legend className="sr-only">Row {i + 1}</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_2fr_1.2fr_1fr_auto]">
                      <div className="col-span-2 sm:col-span-1"><Field label={i === 0 ? 'Material name *' : 'Material name'}><Input aria-label={`Row ${i + 1} name`} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} /></Field></div>
                      <Field label="Specification"><Input aria-label={`Row ${i + 1} specification`} value={r.specification} onChange={(e) => setRow(i, { specification: e.target.value })} /></Field>
                      <Field label="Size"><Input aria-label={`Row ${i + 1} size`} value={r.size} onChange={(e) => setRow(i, { size: e.target.value })} /></Field>
                      <Field label="Qty *"><Input aria-label={`Row ${i + 1} quantity`} inputMode="numeric" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} /></Field>
                      <div className="flex items-end"><Button variant="ghost" aria-label={`Remove row ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} strokeWidth={1.5} /></Button></div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Field label={`Row ${i + 1} category`}><Select aria-label={`Row ${i + 1} category`} value={r.category ?? ''} onChange={(e) => setRow(i, { category: (e.target.value || null) as ComponentCategory | null })}><option value="">Default ({CATEGORY_LABEL[m.category]})</option>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
                      <Field label={`Row ${i + 1} anchorage type`}><SearchSelect label={`Row ${i + 1} anchorage type`} value={r.anchorageTypeId ?? ''} options={anchorageOptions} emptyLabel={r.anchorageTypeId !== null ? 'Use the shared anchorage type' : undefined} placeholder={m.anchorageTypeId ? `Shared: ${catalog.anchorage.find((a) => a.id === m.anchorageTypeId)?.code ?? ''}` : 'Shared: none'} onChange={(id) => setRow(i, { anchorageTypeId: id || null })} /></Field>
                      <Field label={`Row ${i + 1} supplier`}><SearchSelect label={`Row ${i + 1} supplier`} value={r.supplierId ?? ''} options={supplierOptions} emptyLabel={r.supplierId !== null ? 'Use the default supplier' : undefined} placeholder={effSupplier ? `Default: ${supplierName(effSupplier)}` : 'Default: none'} onChange={(id) => setRow(i, { supplierId: id || null })}
                        onCreate={canAddSupplier ? async (name) => { const id = await createSupplier(name); if (id) setRow(i, { supplierId: id }) } : undefined} createLabel={(t) => `Add new supplier “${t}”`} /></Field>
                    </div>
                  </fieldset>
                )
              })}
              <Button onClick={() => setRows([...rows, emptyRow()])}><Plus size={14} strokeWidth={1.5} />Add row</Button>
            </div>
          </>
        )}

        {error && (
          <div role="alert" className="border-l-2 border-bad pl-3">
            <p>{error}</p>
            {dup && <Button className="mt-2" onClick={() => void submit(false, true)} disabled={saving}>Add anyway</Button>}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'quick' ? 'Add materials' : duplicate ? 'Add duplicate' : 'Add material'}</Button>
          <Button disabled={saving} onClick={() => void submit(true)}>Add &amp; add another</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}
