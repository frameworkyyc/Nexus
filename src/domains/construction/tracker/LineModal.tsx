import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { formatDate } from '@/lib/format'
import { useAccess } from '@/lib/access'
import { archiveMaterials, editMaterial, removeReceipt } from './commands'
import { AddMaterialModal, duplicateOf } from './manage/AddMaterialModal'
import { anchorageFor, displayOf, foundationsOfArea, legacyIssues } from './catalog'
import { useMaterialRefs, type MaterialRefs } from './manage/useMaterialRefs'
import { allLines, CATEGORY_LABEL, CATEGORY_ORDER, deliveryLabelOf, receivedOf, remainingOf } from './selectors'
import { QuantityScope } from './manage/QuantityScope'
import { materialsModel } from './model'
import { MATERIAL_STATUS_LABEL } from './procurement'
import { useConstruction } from '../store'
import { useTracker, useTrackerCommand } from './store'
import type { ComponentCategory, ImportFlag, QtyBasis, TrackerLine } from './types'
import { UNITS } from './templates'

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 border-b border-line py-2.5"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>
)
const dash = (v?: string | null) => (v ? v : <span className="text-muted">—</span>)

/** One material: its facts, quantities, deliveries and history. Editing and recording depend on the role. */
export function LineModal({ lineId, onClose }: { lineId: string; onClose: () => void }) {
  const { state } = useTracker()
  const { state: construction } = useConstruction()
  const { run, saving } = useTrackerCommand()
  const access = useAccess()
  const { projectId } = useParams()
  const refs = useMaterialRefs(projectId)
  const line = allLines(state).find((l) => l.id === lineId)
  const [edit, setEdit] = useState(false)
  const [dup, setDup] = useState(false)
  if (!line) return null
  if (dup) {
    return <AddMaterialModal title="Duplicate material" duplicate initial={duplicateOf(line)} projectId={projectId} onClose={() => { setDup(false); onClose() }} />
  }
  const manual = line.origin === 'manual'
  const calculated = line.origin === 'anchorage'
  const showCalc = calculated || (manual && !!line.basis && line.basis !== 'fixed')
  const flags: ImportFlag[] = state.flags.filter((f) => f.lineId === line.id)
  // The quantities are the requirement's (the same unified figures as Materials and Procurement); a line that belongs to no requirement falls back to its own receipts.
  const row = materialsModel(state, construction).rowOfLine(line.id)
  const remaining = row ? row.outstanding : remainingOf(line)
  const got = row ? row.received : receivedOf(line)
  const required = row ? row.required : line.requiredQty
  const standing = row ? MATERIAL_STATUS_LABEL[row.stage] : deliveryLabelOf(line)
  const unit = line.unit || 'ea'
  const shown = displayOf(line, refs.catalog, refs.suppliers)
  const legacy = legacyIssues(line, refs.catalog, refs.suppliers)
  const history = (state.history ?? []).filter((h) => h.materialId === line.id).slice().reverse()
  const canEdit = access.can('materials.edit')
  return (
    <Modal title={line.component} onClose={onClose} wide>
      <div className="space-y-8 p-6 text-[13px]">
        {line.archived && <p role="status" className="border-l-2 border-warn pl-3">Archived. It is hidden from the working list and totals; receipts and history are kept.</p>}
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button onClick={() => setEdit(!edit)}>{edit ? 'Close editor' : 'Edit details'}</Button>}
          {access.can('materials.add') && <Button onClick={() => setDup(true)}>Duplicate</Button>}
          {access.can('materials.archive') && <Button variant="ghost" disabled={saving} onClick={() => (line.archived || window.confirm(`Archive “${line.component}”? It leaves the working list and totals. Receipts and history are kept and it can be restored.`)) && run(archiveMaterials([line.id], !line.archived))}>{line.archived ? 'Restore' : 'Archive'}</Button>}
        </div>

        {legacy.length > 0 && manual && <p role="status" className="border-l-2 border-warn pl-3 text-xs">Not linked to project records: {legacy.map((i) => `${i.field} “${i.value}”`).join(', ')}. The value is kept as written; use Edit details to select the matching record.</p>}
        {edit && canEdit && <EditForm line={line} manual={manual} calculated={calculated} refs={refs} onDone={() => setEdit(false)} />}

        <dl className="border-t border-line">
          <Row k="Area">{shown.area}</Row>
          <Row k="Foundation">{dash(shown.foundation)}</Row>
          <Row k="Anchorage type">{dash(shown.anchorage)}</Row>
          <Row k="Category">{CATEGORY_LABEL[line.category]}</Row>
          {manual && <Row k="Description">{dash(line.description)}</Row>}
          <Row k="Specification">{dash(line.specification)}</Row>
          <Row k="Size / dimensions">{dash(line.size)}</Row>
          {!manual && <Row k="Counts">{line.footings} footings · {line.plinths} plinths · {line.bolts} bolts</Row>}
          <Row k="Required">{line.requiredQty.toLocaleString('en-CA')} {unit}{showCalc && <span className="text-muted"> — {line.calc.expression}</span>}{!manual && !calculated && <span className="text-muted"> = {line.calc.expression}{line.calc.recomputed !== null && line.calc.recomputed !== line.requiredQty ? ` (formula gives ${line.calc.recomputed})` : ''}</span>}</Row>
          <Row k="Supplier">{dash(shown.supplier)}</Row>
          <Row k="PO / reference">{dash(line.poRef)}</Row>
          <Row k="Expected delivery">{line.expectedDate ? formatDate(line.expectedDate) : <span className="text-muted">—</span>}</Row>
          {!manual && !calculated && <Row k="Workbook status">{line.sourceStatus || '—'} <span className="text-muted">(for reference; a delivery counts once it is confirmed here)</span></Row>}
          {manual && !!line.sourceStatus && <Row k="Earlier status note">{line.sourceStatus} <span className="text-muted">(for reference; a delivery counts once it is confirmed here)</span></Row>}
          <Row k="Source">{calculated ? <>Calculated from the Anchorage Library and the foundations{line.requirementRemoved ? ' — no longer required' : ''}</> : manual ? <>Entered in Nexus{line.createdAt ? ` on ${formatDate(line.createdAt.slice(0, 10))}` : ''}{line.createdBy ? ` by ${line.createdBy}` : ''}</> : `${line.source.sheet}, row ${line.source.row}`}</Row>
          <Row k="Record ID"><span className="font-mono text-xs">{line.id}</span></Row>
        </dl>

        {line.sourceNotes.length > 0 && <section><h3 className="t-label mb-2">Workbook comments</h3>{line.sourceNotes.map((n, i) => <p key={i} className="whitespace-pre-line border-l-2 border-line pl-3 text-muted">{n}</p>)}</section>}
        {flags.length > 0 && <section><h3 className="t-label mb-2">Flagged for review</h3><ul className="space-y-1.5">{flags.map((f) => <li key={f.id} className="text-muted">{f.message}</li>)}</ul></section>}

        <section>
          <h3 className="t-label mb-2">Quantities · {standing}</h3>
          <dl className="border-t border-line">
            <Row k="Required">{required.toLocaleString('en-CA')} {unit}</Row>
            {row && <Row k="Ordered">{row.ordered.toLocaleString('en-CA')} {unit}</Row>}
            <Row k="Delivered">{got.toLocaleString('en-CA')} {unit}</Row>
            {row && <Row k="Allocated">{row.allocated.toLocaleString('en-CA')} {unit}</Row>}
            {row && <Row k="Installed">{row.installed.toLocaleString('en-CA')} {unit}</Row>}
            <Row k="Outstanding">{`${remaining.toLocaleString('en-CA')} ${unit}`}{got > required && <span className="text-muted"> (over-delivered by {(got - required).toLocaleString('en-CA')})</span>}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">{row && row.lines.length > 1 ? `These are the totals for the whole requirement: all ${row.lines.length} lines of this specification in ${row.area}. ` : ''}Delivered means the material was physically received, checked and confirmed. Outstanding = required − delivered. Orders and deliveries are managed in Procurement.</p>
          {line.requirementRemoved && <p role="status" className="mt-2 border-l-2 border-warn pl-3 text-xs">This requirement no longer applies (the anchorage configuration changed). Its orders and deliveries are kept.</p>}
          {line.receipts.length > 0 && (
            <ul className="mt-2">
              {line.receipts.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                  <span>{formatDate(r.date)} · <span className="tabular-nums">{r.qty.toLocaleString('en-CA')} {unit}</span>{r.reference && <span className="text-muted"> · {r.reference}</span>}{r.note && <span className="text-muted"> · {r.note}</span>}<span className="block text-xs text-muted">Confirmed{r.by ? ` by ${r.by}` : ' (user not recorded)'}{r.at ? ` on ${new Date(r.at).toLocaleString('en-CA')}` : ''}</span></span>
                  {access.can('materials.void-receipt') && <button className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => window.confirm('Void this delivery? It stays in the history.') && run(removeReceipt(line.id, r.id))}>Void</button>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Materials are received against a purchase order: create the order and record its delivery in Procurement. Receipts recorded earlier stay here and keep counting.</p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {line.orderedQty !== null && <div><p className="t-label mb-1.5">Ordered quantity entered earlier</p><p className="tabular-nums text-muted">{line.orderedQty.toLocaleString('en-CA')} {unit} <span className="text-xs">(ordered quantities now come from purchase orders)</span></p></div>}
          <div className="sm:col-span-2"><p className="t-label mb-1.5">Notes</p><p className="whitespace-pre-line text-muted">{line.notes || '—'}</p></div>
        </section>

        <section>
          <h3 className="t-label mb-2">History</h3>
          {history.length === 0 ? <p className="text-muted">No changes recorded in Nexus yet.</p> : (
            <ul className="border-t border-line">
              {history.map((h) => (
                <li key={h.id} className="border-b border-line py-2.5">
                  <p>{h.summary}</p>
                  <p className="text-xs text-muted">{new Date(h.at).toLocaleString('en-CA')} · {h.by || 'user not recorded'}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        {line.sourceRemoved && <p className="text-xs text-muted">This row is no longer in the latest imported workbook; it is kept because it holds entries made in Nexus.</p>}
      </div>
    </Modal>
  )
}

function EditForm({ line, manual, calculated, refs, onDone }: { line: TrackerLine; manual: boolean; calculated: boolean; refs: MaterialRefs; onDone: () => void }) {
  const { run, saving } = useTrackerCommand()
  const initial = {
    areaId: line.areaId ?? '', foundationId: line.foundationId ?? '', anchorageTypeId: line.anchorageTypeId ?? '', category: line.category, name: line.component, description: line.description ?? '', specification: line.specification ?? '', size: line.size ?? '',
    requiredQty: String(line.qtyEach ?? line.requiredQty), basis: (line.basis ?? 'fixed') as QtyBasis, unit: line.unit || 'ea', supplierId: line.supplierId ?? '', poRef: line.poRef ?? '', expectedDate: line.expectedDate ?? '', notes: line.notes,
  }
  const [f, setF] = useState(initial)
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const legacy = legacyIssues(line, refs.catalog, refs.suppliers)
  const legacyOf = (field: string) => legacy.find((i) => i.field === field)
  const foundations = foundationsOfArea(refs.catalog, f.areaId, false)
  const keepCurrent = line.foundationId && f.areaId === line.areaId && !foundations.some((x) => x.id === line.foundationId) ? refs.catalog.foundations.filter((x) => x.id === line.foundationId) : []
  const changeArea = (areaId: string) => set({ areaId, foundationId: refs.catalog.foundations.find((x) => x.id === f.foundationId)?.areaId === areaId ? f.foundationId : '' })
  const submit = () => {
    const all = { ...f, requiredQty: Number(f.requiredQty), basis: f.basis }
    const editable = manual ? Object.keys(all) : ['unit', 'supplierId', 'poRef', 'expectedDate', 'notes']
    // Only what actually changed is sent, so the history records real edits and not defaults being filled in. An unlinked legacy value
    // is left alone unless a record was chosen for it.
    const changed = Object.fromEntries(editable.filter((k) => String((all as Record<string, unknown>)[k]) !== String((initial as Record<string, unknown>)[k])).map((k) => [k, (all as Record<string, unknown>)[k]]))
    if (Object.keys(changed).length === 0) { onDone(); return }
    run(editMaterial(line.id, changed), onDone)
  }
  return (
    <section className="space-y-3 border border-line p-4">
      <h3 className="t-label">Edit details</h3>
      {calculated && <p className="text-xs text-muted">This requirement is calculated from the Anchorage Library and the foundations, so its quantity cannot be edited here. Supplier, PO, expected delivery, unit and notes can.</p>}
      {!manual && !calculated && <p className="text-xs text-muted">This line comes from the workbook: area, foundation, description and quantity stay as imported (change them in the workbook and re-import). Supplier, PO, expected delivery, unit and notes can be edited here.</p>}
      {manual && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Area *"><SearchSelect label="Area" value={f.areaId} options={refs.catalog.areas.map((a) => ({ value: a.id, label: a.name }))} onChange={changeArea} placeholder={legacyOf('area') ? `Not linked: “${legacyOf('area')!.value}”` : 'Select an area'} /></Field>
            <Field label="Foundation"><SearchSelect label="Foundation" value={f.foundationId} disabled={!f.areaId} emptyLabel="No foundation" placeholder={legacyOf('foundation') ? `Not linked: “${legacyOf('foundation')!.value}”` : 'Select a foundation'}
              options={[...keepCurrent, ...foundations].map((x) => ({ value: x.id, label: x.number, hint: x.archived ? 'Archived' : x.description || undefined }))} onChange={(id) => set({ foundationId: id })} /></Field>
            <Field label="Anchorage type"><SearchSelect label="Anchorage type" value={f.anchorageTypeId} emptyLabel="None" placeholder={legacyOf('anchorage') ? `Not linked: “${legacyOf('anchorage')!.value}”` : 'Search by code or description'}
              options={anchorageFor(refs.catalog, f.foundationId || null).map((a) => ({ value: a.id, label: a.code, hint: a.description || undefined, group: f.foundationId ? (a.onFoundation ? 'Used on this foundation' : 'Other anchorage types') : undefined }))} onChange={(id) => set({ anchorageTypeId: id })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Material name *"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Category"><Select aria-label="Category" value={f.category} onChange={(e) => set({ category: e.target.value as ComponentCategory })}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
          </div>
          <QuantityScope basis={f.basis} onBasis={(basis) => set({ basis })} qty={f.requiredQty} onQty={(requiredQty) => set({ requiredQty })} foundationId={f.foundationId} anchorageTypeId={f.anchorageTypeId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Specification"><Input value={f.specification} onChange={(e) => set({ specification: e.target.value })} /></Field>
            <Field label="Size / dimensions"><Input value={f.size} onChange={(e) => set({ size: e.target.value })} /></Field>
          </div>
          <Field label="Description"><Input value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Supplier"><SearchSelect label="Supplier" value={f.supplierId} emptyLabel="No supplier" placeholder={legacyOf('supplier') ? `Not linked: “${legacyOf('supplier')!.value}”` : 'Select a supplier'}
          options={refs.suppliers.filter((x) => !x.archived || x.id === f.supplierId).map((x) => ({ value: x.id, label: x.name }))} onChange={(id) => set({ supplierId: id })} /></Field>
        <Field label="PO / reference"><Input value={f.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
        <Field label="Expected delivery"><Input type="date" value={f.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
        <Field label="Unit"><Select aria-label="Unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })}>{[...new Set([f.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}</Select></Field>
      </div>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <div className="flex gap-2"><Button variant="primary" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save changes'}</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </section>
  )
}
