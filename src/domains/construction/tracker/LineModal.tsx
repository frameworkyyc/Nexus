import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/format'
import { useAccess } from '@/lib/access'
import { addReceipt, archiveMaterials, confirmNoReceipts, editMaterial, removeReceipt, setOrdered } from './commands'
import { AddMaterialModal, duplicateOf } from './manage/AddMaterialModal'
import { allLines, CATEGORY_LABEL, CATEGORY_ORDER, deliveryLabelOf, distinct, isVerified, receivedOf, remainingOf } from './selectors'
import { useTracker, useTrackerCommand } from './store'
import type { ComponentCategory, ImportFlag, TrackerLine } from './types'
import { UNITS } from './templates'

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 border-b border-line py-2.5"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>
)
const dash = (v?: string | null) => (v ? v : <span className="text-muted">—</span>)

/** One material: its facts, quantities, deliveries and history. Editing and recording depend on the role. */
export function LineModal({ lineId, onClose }: { lineId: string; onClose: () => void }) {
  const { state, today } = useTracker()
  const { run, saving } = useTrackerCommand()
  const access = useAccess()
  const line = allLines(state).find((l) => l.id === lineId)
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(today)
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [edit, setEdit] = useState(false)
  const [dup, setDup] = useState(false)
  if (!line) return null
  if (dup) {
    const lines = allLines(state)
    return <AddMaterialModal title="Duplicate material" duplicate initial={duplicateOf(line)} areas={lines.map((l) => l.area)} locations={lines.map((l) => l.footingType)} onClose={() => { setDup(false); onClose() }} />
  }
  const manual = line.origin === 'manual'
  const flags: ImportFlag[] = state.flags.filter((f) => f.lineId === line.id)
  const remaining = remainingOf(line)
  const got = receivedOf(line)
  const unit = line.unit || 'ea'
  const history = (state.history ?? []).filter((h) => h.materialId === line.id).slice().reverse()
  const canEdit = access.can('materials.edit')
  const save = () => run(addReceipt(line.id, { date, qty: Number(qty), reference: ref, note }, today), () => { setQty(''); setRef(''); setNote('') })
  return (
    <Modal title={line.component} onClose={onClose} wide>
      <div className="space-y-8 p-6 text-[13px]">
        {line.archived && <p role="status" className="border-l-2 border-warn pl-3">Archived. It is hidden from the working list and totals; receipts and history are kept.</p>}
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button onClick={() => setEdit(!edit)}>{edit ? 'Close editor' : 'Edit details'}</Button>}
          {access.can('materials.add') && <Button onClick={() => setDup(true)}>Duplicate</Button>}
          {access.can('materials.archive') && <Button variant="ghost" disabled={saving} onClick={() => (line.archived || window.confirm(`Archive “${line.component}”? It leaves the working list and totals. Receipts and history are kept and it can be restored.`)) && run(archiveMaterials([line.id], !line.archived))}>{line.archived ? 'Restore' : 'Archive'}</Button>}
        </div>

        {edit && canEdit && <EditForm line={line} manual={manual} locations={distinct(allLines(state).map((l) => l.footingType))} areas={distinct(allLines(state).map((l) => l.area))} onDone={() => setEdit(false)} />}

        <dl className="border-t border-line">
          <Row k="Area">{line.area}</Row>
          <Row k="Foundation / location">{dash(line.footingType)}</Row>
          <Row k="Anchorage ref.">{dash(line.anchorageType)}</Row>
          <Row k="Category">{CATEGORY_LABEL[line.category]}</Row>
          {manual && <Row k="Description">{dash(line.description)}</Row>}
          <Row k="Specification">{dash(line.specification)}</Row>
          <Row k="Size / dimensions">{dash(line.size)}</Row>
          {!manual && <Row k="Counts">{line.footings} footings · {line.plinths} plinths · {line.bolts} bolts</Row>}
          <Row k="Required">{line.requiredQty.toLocaleString('en-CA')} {unit}{!manual && <span className="text-muted"> = {line.calc.expression}{line.calc.recomputed !== null && line.calc.recomputed !== line.requiredQty ? ` (formula gives ${line.calc.recomputed})` : ''}</span>}</Row>
          <Row k="Supplier">{dash(line.supplier)}</Row>
          <Row k="PO / reference">{dash(line.poRef)}</Row>
          <Row k="Expected delivery">{line.expectedDate ? formatDate(line.expectedDate) : <span className="text-muted">—</span>}</Row>
          <Row k={manual ? 'Delivery status note' : 'Workbook status'}>{line.sourceStatus || '—'} <span className="text-muted">(a stated status, not a receipt)</span></Row>
          <Row k="Source">{manual ? <>Entered in Nexus{line.createdAt ? ` on ${formatDate(line.createdAt.slice(0, 10))}` : ''}{line.createdBy ? ` by ${line.createdBy}` : ''}</> : `${line.source.sheet}, row ${line.source.row}`}</Row>
          <Row k="Record ID"><span className="font-mono text-xs">{line.id}</span></Row>
        </dl>

        {line.sourceNotes.length > 0 && <section><h3 className="t-label mb-2">Workbook comments</h3>{line.sourceNotes.map((n, i) => <p key={i} className="whitespace-pre-line border-l-2 border-line pl-3 text-muted">{n}</p>)}</section>}
        {flags.length > 0 && <section><h3 className="t-label mb-2">Flagged for review</h3><ul className="space-y-1.5">{flags.map((f) => <li key={f.id} className="text-muted">{f.message}</li>)}</ul></section>}

        <section>
          <h3 className="t-label mb-2">Quantities · {deliveryLabelOf(line)}</h3>
          <dl className="border-t border-line">
            <Row k="Required">{line.requiredQty.toLocaleString('en-CA')} {unit}</Row>
            <Row k="Received (verified)">{isVerified(line) ? `${got.toLocaleString('en-CA')} ${unit}` : <span className="text-muted">Not verified</span>}</Row>
            <Row k="Outstanding">{remaining === null ? <span className="text-muted">Unknown until a receipt is recorded or “nothing received” is confirmed</span> : `${remaining.toLocaleString('en-CA')} ${unit}${got > line.requiredQty ? ` (over-received by ${got - line.requiredQty})` : ''}`}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted">Outstanding = required − total verified received. A “Delivered” status without receipts is never counted as received.</p>
          {line.receipts.length > 0 && (
            <ul className="mt-2">
              {line.receipts.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                  <span>{formatDate(r.date)} · <span className="tabular-nums">{r.qty.toLocaleString('en-CA')}</span>{r.reference && <span className="text-muted"> · {r.reference}</span>}{r.note && <span className="text-muted"> · {r.note}</span>}{r.by && <span className="text-muted"> · recorded by {r.by}</span>}</span>
                  {access.can('materials.void-receipt') && <button className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => window.confirm('Void this receipt? It stays in the history.') && run(removeReceipt(line.id, r.id))}>Void</button>}
                </li>
              ))}
            </ul>
          )}
          {access.can('materials.receive') && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Quantity received"><Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
                <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Delivery ref. (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={saving || !qty} onClick={save}>{saving ? 'Saving…' : 'Record receipt'}</Button>
                {!line.receipts.length && <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={line.confirmedNoReceipts} onChange={(e) => run(confirmNoReceipts(line.id, e.target.checked))} />Confirm nothing has been received yet</label>}
              </div>
            </>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Ordered quantity (optional)">
            <Input key={String(line.orderedQty)} inputMode="numeric" placeholder="Not recorded" disabled={!canEdit} defaultValue={line.orderedQty === null ? '' : String(line.orderedQty)}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (line.orderedQty === null ? '' : String(line.orderedQty))) run(setOrdered(line.id, v === '' ? null : Number(v))) }} />
          </Field>
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

function EditForm({ line, manual, areas, locations, onDone }: { line: TrackerLine; manual: boolean; areas: string[]; locations: string[]; onDone: () => void }) {
  const { run, saving } = useTrackerCommand()
  const initial = {
    area: line.area, location: line.footingType, anchorageRef: line.anchorageType, category: line.category, name: line.component, description: line.description ?? '', specification: line.specification ?? '', size: line.size ?? '',
    requiredQty: String(line.requiredQty), unit: line.unit || 'ea', supplier: line.supplier ?? '', poRef: line.poRef ?? '', expectedDate: line.expectedDate ?? '', claimedStatus: line.sourceStatus, notes: line.notes,
  }
  const [f, setF] = useState(initial)
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const submit = () => {
    const patch = manual
      ? { area: f.area, location: f.location, anchorageRef: f.anchorageRef, category: f.category, name: f.name, description: f.description, specification: f.specification, size: f.size, requiredQty: Number(f.requiredQty), unit: f.unit, supplier: f.supplier, poRef: f.poRef, expectedDate: f.expectedDate, claimedStatus: f.claimedStatus, notes: f.notes }
      : { unit: f.unit, supplier: f.supplier, poRef: f.poRef, expectedDate: f.expectedDate, notes: f.notes }
    // Only what actually changed is sent, so the history records real edits and not defaults being filled in.
    const key = (k: string): keyof typeof f => (k === 'requiredQty' ? 'requiredQty' : k) as keyof typeof f
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => String(v) !== String(initial[key(k)])))
    if (Object.keys(changed).length === 0) { onDone(); return }
    run(editMaterial(line.id, changed), onDone)
  }
  return (
    <section className="space-y-3 border border-line p-4">
      <h3 className="t-label">Edit details</h3>
      {!manual && <p className="text-xs text-muted">This line comes from the workbook: area, foundation, description and quantity stay as imported (change them in the workbook and re-import). Supplier, PO, expected delivery, unit and notes can be edited here.</p>}
      <datalist id="ed-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="ed-locations">{locations.map((a) => <option key={a} value={a} />)}</datalist>
      {manual && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Area *"><Input list="ed-areas" value={f.area} onChange={(e) => set({ area: e.target.value })} /></Field>
            <Field label="Foundation / location"><Input list="ed-locations" value={f.location} onChange={(e) => set({ location: e.target.value })} /></Field>
            <Field label="Anchorage ref."><Input value={f.anchorageRef} onChange={(e) => set({ anchorageRef: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Material name *"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Category"><Select value={f.category} onChange={(e) => set({ category: e.target.value as ComponentCategory })}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Qty required *"><Input inputMode="numeric" value={f.requiredQty} onChange={(e) => set({ requiredQty: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Specification"><Input value={f.specification} onChange={(e) => set({ specification: e.target.value })} /></Field>
            <Field label="Size / dimensions"><Input value={f.size} onChange={(e) => set({ size: e.target.value })} /></Field>
            <Field label="Delivery status note"><Select value={f.claimedStatus} onChange={(e) => set({ claimedStatus: e.target.value })}><option value="">Not verified</option><option>Pending</option><option>Delivered</option></Select></Field>
          </div>
          <Field label="Description"><Input value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Supplier"><Input value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} /></Field>
        <Field label="PO / reference"><Input value={f.poRef} onChange={(e) => set({ poRef: e.target.value })} /></Field>
        <Field label="Expected delivery"><Input type="date" value={f.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={(e) => set({ unit: e.target.value })}>{[...new Set([f.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}</Select></Field>
      </div>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <div className="flex gap-2"><Button variant="primary" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save changes'}</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </section>
  )
}
