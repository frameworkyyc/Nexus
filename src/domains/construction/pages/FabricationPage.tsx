import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CompactSelect, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { formatDate, formatShortDate } from '@/lib/format'
import { addFabricationNote, createFabrication, setFabricationPlinths, updateFabrication, type FabricationPatch } from '../actions'
import { APPROVAL_LABEL, AUTH_LABEL, FAB_LABEL, PICKUP_LABEL, REUSE_LABEL, SITE_LABEL } from '../config'
import { DocumentModal } from '../DocumentModal'
import { useConstruction, useRun } from '../store'
import type { ApprovalStatus, AuthStatus, FabricationRequest, FabStatus, PickupStatus, SiteReceiptStatus, TemplateReuse } from '../types'

/** The ten-step real-world workflow, derived from the request's separate status fields. */
export function fabSteps(r: FabricationRequest): { label: string; done: boolean }[] {
  const authorized = r.authorization === 'authorized' || r.authorization === 'paid' || r.authorization === 'not-required'
  return [
    { label: 'Original design prepared', done: !!r.originalDesignDocId },
    { label: 'Sent to supplier for quotation', done: r.approval !== 'not-submitted' },
    { label: 'Supplier proposal and quotation received', done: !!r.supplierDrawingDocId && !!r.quotation.reference },
    { label: 'Supplier design reviewed', done: r.approval === 'approved' || r.approval === 'revisions-requested' },
    { label: r.approval === 'revisions-requested' ? 'Revisions requested from supplier' : 'Design approved', done: r.approval === 'approved' },
    { label: 'Purchase authorization / payment', done: r.approval === 'approved' && authorized },
    { label: 'Supplier CNC-cuts templates', done: r.fabrication === 'complete' },
    { label: 'Ready for pickup', done: r.pickup === 'ready' || r.pickup === 'collected' },
    { label: 'Collected and transported to site', done: r.pickup === 'collected' },
    { label: 'Received on site and available', done: r.siteReceipt === 'received' },
  ]
}
const currentStep = (r: FabricationRequest) => fabSteps(r).find((s) => !s.done)?.label ?? 'Complete'
const tone = (ok: boolean, active: boolean): Tone => (ok ? 'ok' : active ? 'info' : 'muted')

export function FabricationPage() {
  const { state, idx } = useConstruction()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'received'>('all')
  const list = state.fabrication.filter((r) => (filter === 'all' ? true : filter === 'received' ? r.siteReceipt === 'received' : r.siteReceipt !== 'received'))
  const open = state.fabrication.find((r) => r.id === openId)
  return (
    <>
      <PageHeader title="Custom fabrication" description="Plywood anchor bolt templates: design, supplier quotation, approval, CNC cutting, pickup and site receipt." actions={<Button variant="primary" onClick={() => setCreating(true)}>New request</Button>} />
      <div className="mb-2 flex items-center gap-3">
        <Select className="w-44" aria-label="Filter requests" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All requests</option><option value="open">Not yet on site</option><option value="received">Received on site</option>
        </Select>
        <span className="text-xs text-muted">{list.length} request{list.length === 1 ? '' : 's'} · select a row to open</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse whitespace-nowrap text-left">
          <thead><tr className="border-b border-line">{['Request', 'Area · anchorage', 'Supplier', 'Qty', 'Current step', 'Approval', 'Authorization', 'Fabrication', 'Pickup', 'Site', 'Expected'].map((h) => <th key={h} className="t-label py-3 pr-4 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)} className="cursor-pointer border-b border-line transition-colors hover:bg-hover">
                <td className="py-3.5 pr-4 text-[13px] font-medium">{r.number}<span className="block text-xs font-normal text-muted">Rev {r.revision}</span></td>
                <td className="py-3.5 pr-4 text-[13px]">{idx.area.get(r.areaId)?.name}<span className="block text-xs text-muted">{r.anchorageTypeId} · {r.plinthIds.length} plinth{r.plinthIds.length === 1 ? '' : 's'}</span></td>
                <td className="py-3.5 pr-4 text-[13px] text-muted">{idx.supplier.get(r.supplierId)?.name}</td>
                <td className="py-3.5 pr-4 text-[13px] tabular-nums">{r.quantity}<span className="block text-xs text-muted">{REUSE_LABEL[r.reuse]}</span></td>
                <td className="py-3.5 pr-4 text-[13px]">{currentStep(r)}</td>
                <td className="py-3.5 pr-4"><StatusBadge tone={r.approval === 'approved' ? 'ok' : r.approval === 'revisions-requested' ? 'warn' : r.approval === 'not-submitted' ? 'muted' : 'info'} label={APPROVAL_LABEL[r.approval]} /></td>
                <td className="py-3.5 pr-4"><StatusBadge tone={r.authorization === 'authorized' || r.authorization === 'paid' ? 'ok' : r.authorization === 'pending' ? 'muted' : 'neutral'} label={AUTH_LABEL[r.authorization]} /></td>
                <td className="py-3.5 pr-4"><StatusBadge tone={tone(r.fabrication === 'complete', r.fabrication !== 'not-started')} label={FAB_LABEL[r.fabrication]} /></td>
                <td className="py-3.5 pr-4"><StatusBadge tone={tone(r.pickup === 'collected', r.pickup === 'ready')} label={PICKUP_LABEL[r.pickup]} /></td>
                <td className="py-3.5 pr-4"><StatusBadge tone={r.siteReceipt === 'received' ? 'ok' : 'muted'} label={SITE_LABEL[r.siteReceipt]} /></td>
                <td className="py-3.5 pr-4 text-[13px] text-muted">{formatShortDate(r.expectedDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">All suppliers, quotations and documents are fictional demonstration records. Drawing records are placeholders and are not approved for construction.</p>
      {open && <FabricationDetail key={open.id} request={open} onClose={() => setOpenId(null)} />}
      {creating && <NewRequest onClose={() => setCreating(false)} onCreated={setOpenId} />}
    </>
  )
}

function FabricationDetail({ request: r, onClose }: { request: FabricationRequest; onClose: () => void }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const [note, setNote] = useState('')
  const [revision, setRevision] = useState(r.revision)
  const [quote, setQuote] = useState({ ...r.quotation, amount: r.quotation.amount === null ? '' : String(r.quotation.amount) })
  const [docDialog, setDocDialog] = useState<'design' | 'drawing' | null>(null)
  const [assigning, setAssigning] = useState(false)
  const patch = (p: FabricationPatch) => run(updateFabrication(r.id, p, today))
  const steps = fabSteps(r)
  const firstOpen = steps.findIndex((s) => !s.done)
  const docs = (id: string | null) => state.documents.find((d) => d.id === id)
  const sel = <T extends string>(label: string, value: T, labels: Record<T, string>, set: (v: T) => void) => (
    <Field label={label}><Select value={value} onChange={(e) => set(e.target.value as T)}>{(Object.keys(labels) as T[]).map((k) => <option key={k} value={k}>{labels[k]}</option>)}</Select></Field>
  )
  const commitQuote = () => patch({ quotation: { reference: quote.reference, date: quote.date || null, amount: quote.amount === '' ? null : Number(quote.amount) } })

  return (
    <Modal title={`${r.number} — ${r.title}`} onClose={onClose} wide>
      <div className="space-y-8 px-6 py-6">
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.label} className={`flex items-start gap-2 text-[13px] ${s.done ? '' : i === firstOpen ? 'font-medium' : 'text-muted'}`}>
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${s.done ? 'bg-ok' : i === firstOpen ? 'bg-info' : 'border border-neutral-300'}`} />
              <span><span className="mr-1 tabular-nums text-muted">{i + 1}.</span>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="grid gap-5 sm:grid-cols-2">
          {sel<ApprovalStatus>('Approval status', r.approval, APPROVAL_LABEL, (v) => patch({ approval: v }))}
          {sel<AuthStatus>('Purchase authorization / payment', r.authorization, AUTH_LABEL, (v) => patch({ authorization: v }))}
          {sel<FabStatus>('Fabrication status', r.fabrication, FAB_LABEL, (v) => patch({ fabrication: v }))}
          {sel<PickupStatus>('Pickup status', r.pickup, PICKUP_LABEL, (v) => patch({ pickup: v }))}
          {sel<SiteReceiptStatus>('Site receipt', r.siteReceipt, SITE_LABEL, (v) => patch({ siteReceipt: v }))}
          <Field label="Expected completion"><Input type="date" value={r.expectedDate ?? ''} onChange={(e) => patch({ expectedDate: e.target.value || null })} /></Field>
        </div>
        <p className="-mt-4 text-xs text-muted">The workflow is enforced in order: approval and authorization before cutting, cutting before pickup, collection before site receipt. Every change is logged.</p>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Templates produced"><Input type="number" min={0} value={r.quantity} onChange={(e) => patch({ quantity: Number(e.target.value) })} /></Field>
          {sel<TemplateReuse>('Reuse', r.reuse, REUSE_LABEL, (v) => patch({ reuse: v }))}
          <Field label="Drawing revision"><Input value={revision} onChange={(e) => setRevision(e.target.value)} onBlur={() => revision !== r.revision && patch({ revision })} /></Field>
        </div>
        <p className="-mt-4 text-xs text-muted">Quantity and plinth assignments are independent: one reusable template can serve several plinths, and a single-use template serves one.</p>

        <div>
          <span className="t-label mb-2 block">Quotation (demonstration values)</span>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Reference"><Input value={quote.reference} onChange={(e) => setQuote({ ...quote, reference: e.target.value })} onBlur={commitQuote} /></Field>
            <Field label="Amount"><Input type="number" min={0} value={quote.amount} onChange={(e) => setQuote({ ...quote, amount: e.target.value })} onBlur={commitQuote} /></Field>
            <Field label="Quote date"><Input type="date" value={quote.date ?? ''} onChange={(e) => setQuote({ ...quote, date: e.target.value || null })} onBlur={commitQuote} /></Field>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {(['design', 'drawing'] as const).map((kind) => {
            const id = kind === 'design' ? r.originalDesignDocId : r.supplierDrawingDocId
            const set = (v: string | null) => patch(kind === 'design' ? { originalDesignDocId: v } : { supplierDrawingDocId: v })
            return (
              <div key={kind}>
                <span className="t-label mb-1.5 block">{kind === 'design' ? 'Original design' : 'Supplier drawing'}</span>
                <p className="text-[13px]">{docs(id)?.title ?? <span className="text-muted">None linked</span>}</p>
                <div className="mt-1 flex items-center gap-2">
                  <CompactSelect className="min-w-0 flex-1 truncate" aria-label={`Choose ${kind}`} value={id ?? ''} onChange={(e) => set(e.target.value || null)}>
                    <option value="">None</option>
                    {state.documents.filter((d) => d.kind === 'design' || d.kind === 'drawing').map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </CompactSelect>
                  <button className="shrink-0 whitespace-nowrap text-xs text-muted hover:text-ink" onClick={() => setDocDialog(kind)}>Add record</button>
                </div>
              </div>
            )
          })}
        </div>
        <p className="-mt-4 text-xs text-muted">Document records are placeholders. They are not engineering drawings and are not approved for construction.</p>

        <div>
          <div className="mb-2 flex items-center justify-between"><span className="t-label">Associated foundations / plinths ({r.plinthIds.length})</span><button className="text-xs text-muted hover:text-ink" onClick={() => setAssigning(true)}>Edit assignments</button></div>
          <p className="text-[13px] leading-relaxed">{r.plinthIds.map((id) => { const p = idx.plinth.get(id)!; return `${idx.foundation.get(p.foundationId)!.number} P${p.index}` }).join(' · ') || <span className="text-muted">None assigned</span>}</p>
        </div>

        <div>
          <span className="t-label mb-2 block">Notes and activity history</span>
          <ul className="mb-3">
            {[...r.history].reverse().map((h) => <li key={h.id} className="flex gap-4 border-b border-line py-2 text-[13px]"><span className="w-24 shrink-0 text-xs text-muted">{formatDate(h.date)}</span><span>{h.text}</span></li>)}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (run(addFabricationNote(r.id, note, today)) === null) setNote('') }}>
            <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the history" aria-label="Add a note" />
            <Button type="submit">Add</Button>
          </form>
        </div>
      </div>
      {docDialog && <DocumentModal defaultKind={docDialog === 'design' ? 'design' : 'drawing'} onClose={() => setDocDialog(null)} onCreated={(id) => patch(docDialog === 'design' ? { originalDesignDocId: id } : { supplierDrawingDocId: id })} />}
      {assigning && <Assign request={r} onClose={() => setAssigning(false)} />}
    </Modal>
  )
}

function Assign({ request: r, onClose }: { request: FabricationRequest; onClose: () => void }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const [sel, setSel] = useState(new Set(r.plinthIds))
  const [all, setAll] = useState(false)
  const candidates = state.plinths.filter((p) => idx.foundation.get(p.foundationId)!.areaId === r.areaId && (all || p.anchorageTypeId === r.anchorageTypeId || sel.has(p.id)))
  return (
    <Modal title="Plinth assignments" onClose={onClose}>
      <div className="space-y-4 px-6 py-6">
        <p className="text-xs text-muted">{r.number} · {r.anchorageTypeId}. Assignments do not change the number of templates produced.</p>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-ink" checked={all} onChange={(e) => setAll(e.target.checked)} />Show plinths with other anchorage types in this area</label>
        <ul className="max-h-96 overflow-y-auto">
          {candidates.map((p) => (
            <li key={p.id} className="border-b border-line"><label className="flex items-center gap-3 py-2 text-[13px]"><input type="checkbox" className="accent-ink" checked={sel.has(p.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })} />{idx.foundation.get(p.foundationId)!.number} · Plinth {p.index} <span className="text-muted">{p.anchorageTypeId}</span></label></li>
          ))}
        </ul>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => run(setFabricationPlinths(r.id, [...sel], today)) === null && onClose()}>Save assignments</Button></div>
      </div>
    </Modal>
  )
}

function NewRequest({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const [areaId, setAreaId] = useState(state.areas[0].id)
  const [typeId, setTypeId] = useState(state.anchorageTypes[0].id)
  const [supplierId, setSupplierId] = useState('sup-cnc')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const plinths = state.plinths.filter((p) => idx.foundation.get(p.foundationId)!.areaId === areaId && p.anchorageTypeId === typeId)
  const chosen = plinths.filter((p) => sel.has(p.id))
  const [quantity, setQuantity] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    let id = ''
    const err = run(createFabrication({ areaId, anchorageTypeId: typeId, supplierId, quantity: Number(quantity || chosen.length), plinthIds: chosen.map((p) => p.id) }, today, (x) => (id = x)))
    if (!err) { onClose(); onCreated(id) }
  }
  return (
    <Modal title="New fabrication request" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5 px-6 py-6">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Area"><Select value={areaId} onChange={(e) => { setAreaId(e.target.value); setSel(new Set()) }}>{state.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Anchorage type"><Select value={typeId} onChange={(e) => { setTypeId(e.target.value); setSel(new Set()) }}>{state.anchorageTypes.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</Select></Field>
        </div>
        <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{state.suppliers.filter((s) => s.category.includes('CNC')).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div>
          <span className="t-label mb-1 block">Plinths ({chosen.length} selected)</span>
          {plinths.length ? <ul className="max-h-60 overflow-y-auto">{plinths.map((p) => <li key={p.id} className="border-b border-line"><label className="flex items-center gap-3 py-2 text-[13px]"><input type="checkbox" className="accent-ink" checked={sel.has(p.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })} />{idx.foundation.get(p.foundationId)!.number} · Plinth {p.index}</label></li>)}</ul> : <p className="text-[13px] text-muted">No plinths in this area use {typeId}.</p>}
        </div>
        <Field label="Templates to produce"><Input type="number" min={0} placeholder={String(chosen.length)} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit">Create request</Button></div>
      </form>
    </Modal>
  )
}
