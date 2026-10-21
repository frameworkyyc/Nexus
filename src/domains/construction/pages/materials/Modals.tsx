import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { addPOLine, allocate, orderOnNewPO, receiveDelivery, type AllocationRequest } from '../../actions'
import { boltRows, bulkRows, lineLabel, poLineReceived, plinthHardware, areaOfPlinth, specLabel } from '../../selectors'
import { useConstruction, useRun } from '../../store'
import { formatDate } from '@/lib/format'
import type { POLine } from '../../types'

interface Target {
  plinthId: string
  label: string
  required: number
  allocated: number
  formedPlanned: string
}

/* ── Allocation ─────────────────────────────────────────────────────────── */

export function AllocateModal({ kind, itemId, onClose }: { kind: 'bolt' | 'bulk'; itemId: string; onClose: () => void }) {
  const { idx, today } = useConstruction()
  const run = useRun()
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { title, available, targets } = useMemo(() => {
    const planned = (plinthId: string) => idx.activitiesByOwner.get(plinthId)?.find((a) => a.key === 'formed')?.plannedDate ?? '9999'
    if (kind === 'bolt') {
      const row = boltRows(idx).find((r) => r.spec.id === itemId)!
      return {
        title: `Allocate ${specLabel(row.spec)} anchor bolts`,
        available: row.available,
        targets: row.lines.filter((l) => l.allocated < l.qty).map((l): Target => ({ plinthId: l.plinth.id, label: `${l.area.name} · ${l.foundation.number} · P${l.plinth.index} (${l.anchorageTypeId})`, required: l.qty, allocated: l.allocated, formedPlanned: planned(l.plinth.id) })),
      }
    }
    const row = bulkRows(idx).find((r) => r.item.id === itemId)!
    const list = idx.state.plinths
      .filter((p) => areaOfPlinth(idx, p) === row.item.areaId)
      .flatMap((p): Target[] => {
        const need = plinthHardware(idx, p, row.item.areaId).filter((h) => h.item?.id === itemId)
        const required = need.reduce((s, h) => s + h.demand, 0)
        const allocated = need.reduce((s, h) => s + h.allocated, 0)
        const f = idx.foundation.get(p.foundationId)!
        return required > allocated ? [{ plinthId: p.id, label: `${f.number} · P${p.index} (${p.anchorageTypeId})`, required, allocated, formedPlanned: planned(p.id) }] : []
      })
    return { title: `Allocate ${row.item.description}`, available: row.available, targets: list }
  }, [idx, kind, itemId])

  const sorted = [...targets].sort((a, b) => a.formedPlanned.localeCompare(b.formedPlanned))
  const entered = (id: string) => Math.max(0, Math.floor(Number(qtys[id] || 0)))
  const total = sorted.reduce((s, t) => s + entered(t.plinthId), 0)

  const autoFill = () => {
    let left = available
    const next: Record<string, string> = {}
    for (const t of sorted) {
      const take = Math.min(t.required - t.allocated, left)
      if (take > 0) next[t.plinthId] = String(take)
      left -= Math.max(0, take)
    }
    setQtys(next)
  }

  const submit = () => {
    const requests: AllocationRequest[] = sorted.map((t) => ({ itemType: kind, itemId, plinthId: t.plinthId, qty: entered(t.plinthId) }))
    const err = run(allocate(requests, today))
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px]"><span className="font-medium">{available}</span> available in received stock · <span className={total > available ? 'text-bad' : ''}>{total} entered</span></p>
          <Button onClick={autoFill} disabled={available === 0}>Fill by planned forming date</Button>
        </div>
        <p className="mb-3 text-xs text-muted">Allocation commits received stock to a plinth. Stock already allocated cannot be allocated again.</p>
        {available === 0 && <p className="mb-3 text-[13px] text-warn">No received stock is available to allocate. Receive a delivery first.</p>}
        <table className="w-full border-collapse text-left text-[13px]">
          <thead><tr className="border-b border-line">{['Plinth', 'Forming planned', 'Required', 'Allocated', 'Allocate now'].map((h) => <th key={h} className="t-label py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.plinthId} className="border-b border-line">
                <td className="py-2 pr-3">{t.label}</td>
                <td className="pr-3 text-muted">{t.formedPlanned === '9999' ? '—' : formatDate(t.formedPlanned)}</td>
                <td className="pr-3">{t.required}</td>
                <td className="pr-3">{t.allocated}</td>
                <td><Input className="h-8 w-20" type="number" min={0} max={t.required - t.allocated} aria-label={`Allocate to ${t.label}`} value={qtys[t.plinthId] ?? ''} onChange={(e) => { setQtys({ ...qtys, [t.plinthId]: e.target.value }); setError(null) }} /></td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={5} className="py-4 text-muted">Every plinth requirement is fully allocated.</td></tr>}
          </tbody>
        </table>
        {error && <p role="alert" className="mt-3 text-[13px] text-bad">{error}</p>}
        <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={total === 0} onClick={submit}>Allocate {total || ''}</Button></div>
      </div>
    </Modal>
  )
}

/* ── Ordering ───────────────────────────────────────────────────────────── */

export function OrderModal({ kind, itemId, onClose }: { kind: POLine['kind']; itemId: string; onClose: () => void }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const shortfall = kind === 'bolt' ? boltRows(idx).find((r) => r.spec.id === itemId)!.toOrder : bulkRows(idx).find((r) => r.item.id === itemId)!.toOrder
  const label = lineLabel(idx, { id: '', kind, itemId, qtyOrdered: 0 })
  const drafts = state.purchaseOrders.filter((p) => p.status === 'draft')
  const [target, setTarget] = useState('new')
  const [supplierId, setSupplierId] = useState(kind === 'bolt' ? 'sup-steel' : 'sup-hw')
  const [expected, setExpected] = useState('')
  const [quantity, setQuantity] = useState(String(shortfall || ''))
  const [issue, setIssue] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const qty = Number(quantity)
    const err = target === 'new'
      ? run(orderOnNewPO({ supplierId, expectedDate: expected || null, notes: 'Created from the materials register (demonstration)', kind, itemId, qty, issue }, today))
      : run(addPOLine(target, kind, itemId, qty))
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title="Order material" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5 px-6 py-6">
        <div><span className="t-label block">Item</span><p className="mt-1 text-[13px]">{label}</p><p className="text-xs text-muted">Identical specifications are consolidated into one purchase line; each foundation requirement stays on record.</p></div>
        <Field label="Purchase order">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">New draft purchase order</option>
            {drafts.map((p) => <option key={p.id} value={p.id}>{p.number} (draft) — {idx.supplier.get(p.supplierId)?.name}</option>)}
          </Select>
        </Field>
        {target === 'new' && (
          <>
            <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{state.suppliers.filter((s) => !s.category.includes('CNC')).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Expected delivery"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} className="accent-ink" />Issue to supplier now</label>
          </>
        )}
        <Field label={`Quantity${shortfall ? ` (shortfall ${shortfall})` : ''}`}><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></Field>
        {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit">Add to order</Button></div>
      </form>
    </Modal>
  )
}

/* ── Receiving ──────────────────────────────────────────────────────────── */

export function ReceiveModal({ poId, onClose }: { poId?: string; onClose: () => void }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const open = state.purchaseOrders.filter((p) => p.status === 'issued')
  const [selected, setSelected] = useState(poId ?? open[0]?.id ?? '')
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<Record<string, { shipped: string; got: string; note: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const po = idx.po.get(selected)
  const cell = (id: string) => lines[id] ?? { shipped: '', got: '', note: '' }
  const set = (id: string, patch: Partial<{ shipped: string; got: string; note: string }>) => { setLines({ ...lines, [id]: { ...cell(id), ...patch } }); setError(null) }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!po) return
    const err = run(receiveDelivery(po.id, {
      date, reference, receivedBy: 'Project Coordinator', notes: '',
      lines: po.lines.map((l) => { const c = cell(l.id); const got = Number(c.got || 0); return { poLineId: l.id, qtyReceived: got, qtyShipped: c.shipped === '' ? got : Number(c.shipped), note: c.note } }),
    }))
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title="Receive delivery" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5 px-6 py-6">
        <p className="text-xs leading-relaxed text-muted">Receiving records what arrived on site (for example a skid of anchor bolts). It does not allocate stock to foundations — sort and allocate separately. Record partial receipts, shortages and damaged items by entering what was counted.</p>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Purchase order"><Select value={selected} onChange={(e) => { setSelected(e.target.value); setLines({}) }}>{open.map((p) => <option key={p.id} value={p.id}>{p.number} — {idx.supplier.get(p.supplierId)?.name}</option>)}</Select></Field>
          <Field label="Date received"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Skid / packing slip ref."><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. SKID-0500" /></Field>
        </div>
        {po ? (
          <table className="w-full border-collapse text-left text-[13px]">
            <thead><tr className="border-b border-line">{['Item', 'Ordered', 'Already received', 'Slip qty', 'Counted', 'Note'].map((h) => <th key={h} className="t-label py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b border-line align-top">
                  <td className="py-2 pr-3">{lineLabel(idx, l)}</td>
                  <td className="pr-3">{l.qtyOrdered}</td>
                  <td className="pr-3">{poLineReceived(idx, l.id)}</td>
                  <td className="pr-3"><Input className="h-8 w-20" type="number" min={0} aria-label="Quantity per packing slip" value={cell(l.id).shipped} placeholder={cell(l.id).got} onChange={(e) => set(l.id, { shipped: e.target.value })} /></td>
                  <td className="pr-3"><Input className="h-8 w-20" type="number" min={0} aria-label={`Counted quantity for ${lineLabel(idx, l)}`} value={cell(l.id).got} onChange={(e) => set(l.id, { got: e.target.value })} /></td>
                  <td><Input className="h-8" aria-label="Line note" value={cell(l.id).note} onChange={(e) => set(l.id, { note: e.target.value })} placeholder="Shortage, damage…" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-[13px] text-muted">No issued purchase orders are awaiting delivery.</p>}
        {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={!po}>Record delivery</Button></div>
      </form>
    </Modal>
  )
}
