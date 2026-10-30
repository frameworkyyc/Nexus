import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/format'
import { useAccess } from '@/lib/access'
import { addOrderLines, createPurchaseOrder, recordDelivery, setAllocations } from '../tracker/commands'
import { specText } from '../tracker/consolidate'
import { orderProgress, PROC_LABEL, type ProcRow } from '../tracker/procurement'
import { trackerStore } from '../tracker/store'
import type { GroupRef, PurchaseOrder, TrackerState } from '../tracker/types'
import { CATEGORY_LABEL } from '../tracker/selectors'

export const fmt = (n: number) => n.toLocaleString('en-CA')
export const when = (at: string) => (at ? new Date(at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '')
export const who = (by: string) => by || 'user not recorded'
const name = (r: { name: string; specification: string; size: string }) => `${r.name}${specText(r) ? ` · ${specText(r)}` : ''}`

/** One row of "material, quantity" in an order or delivery form. */
function LineList({ rows, lines, set, hint, label }: { rows: Map<string, { area: string; name: string; specification: string; size: string; unit: string }>; lines: { key: string; qty: string }[]; set: (l: { key: string; qty: string }[]) => void; hint: (key: string) => string; label: string }) {
  return (
    <div role="group" aria-label="Materials" className="divide-y divide-line border-y border-line text-[13px]">
      {lines.map((l, i) => {
        const r = rows.get(l.key)
        if (!r) return null
        return (
          <div key={l.key} className="grid grid-cols-[1fr_7rem_2.5rem] items-center gap-3 py-2 phone:grid-cols-[1fr_6rem_2.75rem]">
            <div className="min-w-0"><p className="truncate font-medium" title={name(r)}>{name(r)}</p><p className="truncate text-xs text-muted">{r.area} · {hint(l.key)}</p></div>
            <Input aria-label={`${label}: ${name(r)}`} inputMode="numeric" value={l.qty} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <button type="button" aria-label={`Remove ${name(r)}`} onClick={() => set(lines.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center text-muted hover:text-ink"><Trash2 size={15} strokeWidth={1.5} /></button>
          </div>
        )
      })}
    </div>
  )
}

function AddMaterial({ rows, taken, onAdd, label, qtyOf }: { rows: ProcRow[]; taken: Set<string>; onAdd: (key: string, qty: number) => void; label: string; qtyOf: (r: ProcRow) => number }) {
  const left = rows.filter((r) => !taken.has(r.key))
  const areas = [...new Set(left.map((r) => r.area))]
  if (left.length === 0) return null
  return (
    <Field label={label}>
      <Select aria-label={label} value="" onChange={(e) => { const r = rows.find((x) => x.key === e.target.value); if (r) onAdd(r.key, qtyOf(r)) }}>
        <option value="">Choose a material…</option>
        {areas.map((a) => <optgroup key={a} label={a}>{left.filter((r) => r.area === a).map((r) => <option key={r.key} value={r.key}>{name(r)} ({PROC_LABEL[r.status].toLowerCase()})</option>)}</optgroup>)}
      </Select>
    </Field>
  )
}

const toQty = (t: string) => (t.trim() === '' ? NaN : Number(t))

/** Places one purchase order covering any number of materials, in one area or several. */
export function OrderModal({ rows, initialKeys, state, today, onClose, order }: { rows: ProcRow[]; initialKeys: string[]; state: TrackerState; today: string; onClose: () => void; order?: PurchaseOrder }) {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const first = byKey.get(initialKeys[0])
  const preferred = first ? state.preferredSuppliers?.[first.category] : undefined
  const suppliers = (state.suppliers ?? []).filter((s) => !s.archived)
  const [number, setNumber] = useState('')
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? (preferred && suppliers.some((s) => s.id === preferred) ? preferred : ''))
  const [other, setOther] = useState('')
  const [date, setDate] = useState(today)
  const [expected, setExpected] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState(initialKeys.filter((k) => byKey.has(k)).map((k) => ({ key: k, qty: String(Math.max(1, byKey.get(k)!.toOrder)) })))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const total = lines.reduce((a, l) => a + (Number.isFinite(toQty(l.qty)) ? toQty(l.qty) : 0), 0)
  const save = async () => {
    setSaving(true); setError('')
    const payload = lines.map((l) => ({ key: l.key, qty: toQty(l.qty) }))
    const e = await trackerStore.run(order ? addOrderLines(order.id, payload) : createPurchaseOrder({ number, supplierId: supplierId && supplierId !== '__other' ? supplierId : null, supplier: supplierId === '__other' ? other : '', date, expectedDate: expected || null, notes, lines: payload }, today))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title={order ? `Add materials to ${order.number}` : 'New purchase order'} onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        {!order && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="PO number *"><Input aria-label="PO number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 1706734-00" /></Field>
            <Field label="Supplier *">
              <Select aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__other">Another supplier…</option>
              </Select>
            </Field>
            <Field label="Order date *"><Input aria-label="Order date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Expected delivery"><Input aria-label="Expected delivery" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            {supplierId === '__other' && <Field label="Supplier name *"><Input aria-label="Supplier name" value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
          </div>
        )}
        <p className="text-muted">{order ? 'Add materials to this order.' : 'One order can cover several materials and areas. Quantities start at what is still to be ordered.'}</p>
        {lines.length === 0 ? <p className="border-l-2 border-line pl-3 text-muted">No materials yet. Choose one below.</p> : (
          <LineList rows={byKey} lines={lines} set={setLines} label="Quantity to order" hint={(k) => { const r = byKey.get(k)!; return `required ${fmt(r.required)} · ordered ${fmt(r.ordered)} · still to order ${fmt(r.toOrder)}` }} />
        )}
        <AddMaterial rows={rows} taken={new Set(lines.map((l) => l.key).concat(order ? (state.orderLines ?? []).filter((l) => l.orderId === order.id).map((l) => l.key) : []))} label="Add a material" qtyOf={(r) => Math.max(1, r.toOrder)} onAdd={(key, qty) => setLines([...lines, { key, qty: String(qty) }])} />
        {!order && <Field label="Notes"><Textarea aria-label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={saving || lines.length === 0} onClick={() => void save()}>{saving ? 'Saving…' : order ? 'Add to order' : `Place order · ${fmt(total)} items`}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

/** Records one delivery (a shipment) for any number of materials, optionally against a purchase order. Who confirmed it and when are recorded with it. */
export function ReceiveModal({ rows, initialKeys, state, today, onClose, order }: { rows: ProcRow[]; initialKeys: string[]; state: TrackerState; today: string; onClose: () => void; order?: PurchaseOrder }) {
  const progress = order ? orderProgress(state, order.id) : null
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const dueOf = (k: string) => progress?.lines.find((x) => x.line.key === k)?.due ?? byKey.get(k)?.outstanding ?? 0
  const start = order ? progress!.lines.filter((x) => x.due > 0).map((x) => x.line.key) : initialKeys.filter((k) => byKey.has(k))
  const [lines, setLines] = useState(start.map((k) => ({ key: k, qty: String(Math.max(1, dueOf(k))) })))
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const choices = order ? rows.filter((r) => progress!.lines.some((x) => x.line.key === r.key)) : rows
  const lookup = new Map<string, GroupRef>([...byKey, ...(progress?.lines.map((x) => [x.line.key, x.line] as [string, GroupRef]) ?? [])])
  const total = lines.reduce((a, l) => a + (Number.isFinite(toQty(l.qty)) ? toQty(l.qty) : 0), 0)
  const save = async () => {
    const payload = lines.map((l) => ({ key: l.key, qty: toQty(l.qty) }))
    const over = payload.filter((l) => l.qty > dueOf(l.key))
    if (over.length && !window.confirm(`${over.length} line${over.length === 1 ? '' : 's'} exceed${over.length === 1 ? 's' : ''} what is still due. Confirm that the full quantities were physically received and checked?`)) return
    if (!over.length && !window.confirm(`Confirm that ${fmt(payload.reduce((a, l) => a + l.qty, 0))} items were physically received and checked?`)) return
    setSaving(true); setError('')
    const e = await trackerStore.run(recordDelivery({ orderId: order?.id ?? null, date, reference, note, lines: payload }, today))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title={order ? `Receive delivery · ${order.number}` : 'Receive delivery'} onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        <p className="text-muted">Enter what was physically received and checked. It is recorded once for the area’s material, not against each foundation. Partial deliveries are fine: record the rest when it arrives.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Date received *"><Input aria-label="Date received" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Delivery note / reference"><Input aria-label="Delivery reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. DN-1042" /></Field>
          <div className="col-span-2"><Field label="Note"><Input aria-label="Delivery note" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        </div>
        {lines.length === 0 ? <p className="border-l-2 border-line pl-3 text-muted">{order ? 'Everything on this order has been received.' : 'No materials yet. Choose one below.'}</p> : (
          <LineList rows={lookup} lines={lines} set={setLines} label="Quantity received" hint={(k) => { const r = byKey.get(k); return order ? `ordered ${fmt(progress!.lines.find((x) => x.line.key === k)?.line.qty ?? 0)} · due ${fmt(dueOf(k))}` : `required ${fmt(r?.required ?? 0)} · received ${fmt(r?.received ?? 0)} · outstanding ${fmt(dueOf(k))}` }} />
        )}
        <AddMaterial rows={choices} taken={new Set(lines.map((l) => l.key))} label="Add a material" qtyOf={(r) => Math.max(1, dueOf(r.key))} onAdd={(key, qty) => setLines([...lines, { key, qty: String(qty) }])} />
        <p className="text-xs text-muted">Recorded as confirmed by you, with the time, when you save.</p>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={saving || lines.length === 0} onClick={() => void save()}>{saving ? 'Saving…' : `Confirm delivery · ${fmt(total)} items`}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

/** One consolidated material: its quantities, the orders and deliveries behind them, and how what has arrived is allocated to foundations. */
export function RowModal({ row, state, foundationName, onClose, onOrder, onReceive }: { row: ProcRow; state: TrackerState; foundationName: (id: string) => string; onClose: () => void; onOrder: () => void; onReceive: () => void }) {
  const access = useAccess()
  const orders = new Map((state.orders ?? []).map((o) => [o.id, o]))
  const deliveries = new Map((state.deliveries ?? []).map((d) => [d.id, d]))
  const need = new Map<string, number>()
  for (const c of row.contributions) if (c.foundationId) need.set(c.foundationId, (need.get(c.foundationId) ?? 0) + c.qty)
  const legacy = new Map<string, number>()
  for (const l of row.lines) if (l.foundationId) legacy.set(l.foundationId, (legacy.get(l.foundationId) ?? 0) + l.receipts.reduce((a, r) => a + r.qty, 0))
  const [alloc, setAlloc] = useState<Record<string, string>>(Object.fromEntries([...need.keys()].map((f) => [f, String(row.allocations.find((a) => a.foundationId === f)?.qty ?? 0)])))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const draft = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0)
  const available = row.received - row.allocatedOnLines - draft
  const save = async () => {
    setSaving(true); setError('')
    const e = await trackerStore.run(setAllocations(row.key, Object.entries(alloc).map(([foundationId, v]) => ({ foundationId, qty: Number(v) }))))
    setSaving(false)
    if (e) setError(e)
  }
  const Q = ({ k, v, sub }: { k: string; v: number; sub?: string }) => <div><dt className="t-label">{k}</dt><dd className="mt-1 text-lg font-medium tabular-nums">{fmt(v)}</dd>{sub && <p className="text-xs text-muted">{sub}</p>}</div>
  return (
    <Modal title={row.name} onClose={onClose} wide>
      <div className="space-y-6 p-6 text-[13px]">
        <div>
          <p className="text-muted">{row.area} · {CATEGORY_LABEL[row.category]}{specText(row) ? ` · ${specText(row)}` : ''}</p>
          <p className="mt-1 font-medium">{PROC_LABEL[row.status]}{row.orphan && <span className="font-normal text-warn"> · no longer required by the current configuration; orders and deliveries are kept</span>}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          <Q k="Required" v={row.required} /><Q k="Ordered" v={row.ordered} sub={row.toOrder > 0 ? `${fmt(row.toOrder)} to order` : undefined} /><Q k="Received" v={row.received} />
          <Q k="Outstanding" v={row.outstanding} /><Q k="Allocated" v={row.allocated} /><Q k="Unallocated" v={row.unallocated} />
        </dl>
        <div className="flex flex-wrap gap-2">
          {access.can('materials.edit') && <Button variant="primary" onClick={onOrder}>Order</Button>}
          {access.can('materials.receive') && <Button onClick={onReceive}>Receive delivery</Button>}
        </div>

        <section aria-label="Orders">
          <h3 className="t-label mb-2">Orders</h3>
          {row.orderLines.length === 0 && row.orderedOnLines === 0 ? <p className="text-muted">Not ordered yet.</p> : (
            <ul className="divide-y divide-line border-y border-line">
              {row.orderLines.map((l) => { const o = orders.get(l.orderId); return <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{o?.number} · {o?.supplier} · {formatDate(o?.date)}</span><span className="tabular-nums">{fmt(l.qty)} {row.unit}</span></li> })}
              {row.orderedOnLines > 0 && <li className="flex flex-wrap justify-between gap-2 py-2 text-muted"><span>Ordered on individual material lines (earlier records)</span><span className="tabular-nums">{fmt(row.orderedOnLines)} {row.unit}</span></li>}
            </ul>
          )}
        </section>

        <section aria-label="Deliveries">
          <h3 className="t-label mb-2">Deliveries</h3>
          {row.deliveryLines.length === 0 && row.receivedOnLines === 0 ? <p className="text-muted">Nothing received yet.</p> : (
            <ul className="divide-y divide-line border-y border-line">
              {row.deliveryLines.map((l) => { const d = deliveries.get(l.deliveryId); return <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{formatDate(d?.date)}{d?.reference ? ` · ${d.reference}` : ''} · confirmed by {who(d?.by ?? '')}{d?.at ? ` on ${when(d.at)}` : ''}</span><span className="tabular-nums">{fmt(l.qty)} {row.unit}</span></li> })}
              {row.receivedOnLines > 0 && <li className="flex flex-wrap justify-between gap-2 py-2 text-muted"><span>Received on individual material lines (earlier records)</span><span className="tabular-nums">{fmt(row.receivedOnLines)} {row.unit}</span></li>}
            </ul>
          )}
        </section>

        <section aria-label="Allocation to foundations">
          <h3 className="t-label mb-1">Allocation to foundations</h3>
          <p className="mb-2 text-muted">Received is what has arrived; allocated is what is set aside for a particular foundation. Receiving a delivery never allocates it.</p>
          {need.size === 0 ? <p className="text-muted">No foundation uses this material, so there is nothing to allocate it to.</p> : (
            <>
              <table className="w-full max-w-2xl text-left" aria-label="Allocation">
                <thead><tr className="border-b border-line"><th scope="col" className="t-label font-medium">Foundation</th><th scope="col" className="t-label text-right font-medium">Needs</th><th scope="col" className="t-label text-right font-medium">Allocated</th></tr></thead>
                <tbody>
                  {[...need.entries()].sort((a, b) => foundationName(a[0]).localeCompare(foundationName(b[0]), 'en', { numeric: true })).map(([f, n]) => (
                    <tr key={f} className="border-b border-line">
                      <td>{foundationName(f)}{(legacy.get(f) ?? 0) > 0 && <span className="text-xs text-muted"> · {fmt(legacy.get(f) ?? 0)} received on its own line</span>}</td>
                      <td className="text-right">{fmt(n)}</td>
                      <td className="text-right"><Input aria-label={`Allocate to ${foundationName(f)}`} className="!w-24 text-right" inputMode="numeric" disabled={!access.can('materials.receive')} value={alloc[f] ?? '0'} onChange={(e) => { setAlloc({ ...alloc, [f]: e.target.value }); setError('') }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`mt-2 ${available < 0 ? 'text-bad' : 'text-muted'}`}>{fmt(row.received)} received · {fmt(Math.max(0, draft + row.allocatedOnLines))} allocated · {fmt(available)} available to allocate</p>
              {error && <p role="alert" className="mt-2 border-l-2 border-bad pl-3">{error}</p>}
              {access.can('materials.receive') && <div className="mt-3"><Button disabled={saving || available < 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save allocation'}</Button></div>}
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}
