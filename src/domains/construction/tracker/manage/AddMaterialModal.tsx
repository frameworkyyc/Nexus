import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Segmented } from '@/components/mobile/Cards'
import { useToast } from '@/components/ui/Toast'
import { addMaterials } from '../commands'
import { validateMaterial, type MaterialInput } from '../materialModel'
import { CATEGORY_LABEL, CATEGORY_ORDER, distinct } from '../selectors'
import { MATERIAL_TEMPLATES, UNITS } from '../templates'
import { trackerStore } from '../store'
import type { ComponentCategory, TrackerLine } from '../types'

export const blankMaterial = (over: Partial<MaterialInput> = {}): MaterialInput => ({
  area: '', location: '', anchorageRef: '', category: 'bolt', name: '', description: '', specification: '', size: '', requiredQty: 0, unit: 'ea', supplier: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '', ...over,
})

/** Pre-fills a new material from an existing one (Duplicate). Quantities, receipts and history are not copied. */
export const duplicateOf = (l: TrackerLine): MaterialInput => blankMaterial({
  area: l.area, location: l.footingType, anchorageRef: l.anchorageType, category: l.category, name: l.component, description: l.description ?? '', specification: l.specification ?? '', size: l.size ?? '',
  requiredQty: l.requiredQty, unit: l.unit || 'ea', supplier: l.supplier ?? '', poRef: l.poRef ?? '',
})

type Mode = 'one' | 'quick'
interface QuickRow { name: string; specification: string; size: string; qty: string }
const emptyRow = (): QuickRow => ({ name: '', specification: '', size: '', qty: '' })

/**
 * Add Material. One form for a single record (with "Add another", which keeps area, foundation and category), or Quick Add: one area
 * and foundation with many rows, so a whole foundation can be entered in one go. Possible duplicates are stopped and can be
 * added deliberately.
 */
export function AddMaterialModal({ initial, duplicate, title = 'Add material', areas, locations, onClose }: { initial?: MaterialInput; /** The form was pre-filled from an existing material. */ duplicate?: boolean; title?: string; areas: string[]; locations: string[]; onClose: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('one')
  const [m, setM] = useState<MaterialInput>(initial ?? blankMaterial())
  const [qty, setQty] = useState(initial && initial.requiredQty ? String(initial.requiredQty) : '')
  const [rows, setRows] = useState<QuickRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [error, setError] = useState<string | null>(null)
  const [dup, setDup] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<MaterialInput>) => { setM((x) => ({ ...x, ...patch })); setError(null); setDup(false) }
  const areaOptions = useMemo(() => distinct(areas), [areas])
  const locationOptions = useMemo(() => distinct(locations), [locations])

  const single = (): MaterialInput => ({ ...m, requiredQty: qty.trim() === '' ? NaN : Number(qty) })
  const quick = (): MaterialInput[] => rows.filter((r) => r.name || r.qty || r.specification || r.size).map((r) => ({ ...m, name: r.name, specification: r.specification, size: r.size, requiredQty: r.qty.trim() === '' ? NaN : Number(r.qty), description: '', claimedStatus: '', notes: '' }))

  const submit = async (another: boolean, allowDuplicate = false) => {
    const items = mode === 'one' ? [single()] : quick()
    if (items.length === 0) { setError('Enter at least one row.'); return }
    const bad = items.map((it, i) => validateMaterial(it) && `${items.length > 1 ? `Row ${i + 1}: ` : ''}${validateMaterial(it)}`).find(Boolean)
    if (bad) { setError(bad); return }
    setSaving(true)
    const err = await trackerStore.run(addMaterials(items, allowDuplicate))
    setSaving(false)
    if (err !== null) { setError(err); setDup(/already exists|duplicate/i.test(err)); return }
    toast(items.length === 1 ? `Added “${items[0].name}” to ${items[0].area}${items[0].location ? ` · ${items[0].location}` : ''}.` : `Added ${items.length} materials to ${m.area}${m.location ? ` · ${m.location}` : ''}.`)
    if (!another) { onClose(); return }
    // Keep the working context; clear what is specific to the item just entered.
    setM((x) => ({ ...x, name: '', description: '', specification: mode === 'one' ? '' : x.specification, size: '', requiredQty: 0, poRef: x.poRef, notes: '', claimedStatus: '' }))
    setQty(''); setRows([emptyRow(), emptyRow(), emptyRow()]); setError(null); setDup(false)
  }

  const applyTemplate = (id: string) => {
    const t = MATERIAL_TEMPLATES.find((x) => x.id === id)
    if (t) set({ category: t.category, unit: t.unit, name: m.name || t.name, specification: m.specification || t.specification })
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="space-y-5 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); void submit(false) }} noValidate>
        {!duplicate && <Segmented<Mode> label="Entry mode" value={mode} onChange={setMode} items={[{ id: 'one', label: 'Single material' }, { id: 'quick', label: 'Quick add (several)' }]} />}
        <datalist id="mm-areas">{areaOptions.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="mm-locations">{locationOptions.map((a) => <option key={a} value={a} />)}</datalist>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Area *"><Input list="mm-areas" value={m.area} onChange={(e) => set({ area: e.target.value })} autoComplete="off" /></Field>
          <Field label="Foundation / location"><Input list="mm-locations" value={m.location} onChange={(e) => set({ location: e.target.value })} autoComplete="off" placeholder="e.g. F-1101" /></Field>
          <Field label="Anchorage ref."><Input value={m.anchorageRef} onChange={(e) => set({ anchorageRef: e.target.value })} /></Field>
        </div>

        {mode === 'one' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Start from a template"><Select aria-label="Template" value="" onChange={(e) => applyTemplate(e.target.value)}><option value="">Choose…</option>{MATERIAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
              <Field label="Category *"><Select value={m.category} onChange={(e) => set({ category: e.target.value as ComponentCategory })}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
              <Field label="Material name *"><Input value={m.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Specification"><Input value={m.specification} onChange={(e) => set({ specification: e.target.value })} placeholder="e.g. ASTM F1554 Gr.36" /></Field>
              <Field label="Size / dimensions"><Input value={m.size} onChange={(e) => set({ size: e.target.value })} placeholder={'e.g. 3/4" x 460 mm'} /></Field>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field label="Qty required *"><Input inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setError(null); setDup(false) }} /></Field>
                <Field label="Unit"><Select value={m.unit} onChange={(e) => set({ unit: e.target.value })}>{[...new Set([m.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}</Select></Field>
              </div>
            </div>
            <Field label="Description"><Input value={m.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Supplier"><Input value={m.supplier} onChange={(e) => set({ supplier: e.target.value })} /></Field>
              <Field label="PO / reference"><Input value={m.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
              <Field label="Expected delivery"><Input type="date" value={m.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
              <Field label="Delivery status"><Select value={m.claimedStatus} onChange={(e) => set({ claimedStatus: e.target.value })}><option value="">Not verified</option><option>Pending</option><option>Delivered</option></Select></Field>
            </div>
            <p className="-mt-2 text-xs text-muted">Delivery status is a note, not a receipt. Quantity received only counts once a delivery is recorded on the material.</p>
            <Field label="Notes"><Textarea rows={2} value={m.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Category *"><Select value={m.category} onChange={(e) => set({ category: e.target.value as ComponentCategory })}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
              <Field label="Supplier"><Input value={m.supplier} onChange={(e) => set({ supplier: e.target.value })} /></Field>
              <Field label="PO / reference"><Input value={m.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
            </div>
            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 border-t border-line pt-3 sm:grid-cols-[2fr_2fr_1.2fr_1fr_auto]">
                  <div className="col-span-2 sm:col-span-1"><Field label={i === 0 ? 'Material name *' : 'Material name'}><Input aria-label={`Row ${i + 1} name`} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field></div>
                  <Field label="Specification"><Input aria-label={`Row ${i + 1} specification`} value={r.specification} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, specification: e.target.value } : x)))} /></Field>
                  <Field label="Size"><Input aria-label={`Row ${i + 1} size`} value={r.size} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))} /></Field>
                  <Field label="Qty *"><Input aria-label={`Row ${i + 1} quantity`} inputMode="numeric" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></Field>
                  <div className="flex items-end"><Button variant="ghost" aria-label={`Remove row ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} strokeWidth={1.5} /></Button></div>
                </div>
              ))}
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
