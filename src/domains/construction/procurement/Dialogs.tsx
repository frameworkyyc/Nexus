import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/format'
import { useAccess } from '@/lib/access'
import { addOrderLines, createPurchaseOrder, recordDelivery, setAllocations, correctDelivery, editPurchaseOrder } from '../tracker/commands'
import { displayName, specText } from '../tracker/consolidate'
import { orderProgress, orderTitle, PROC_LABEL, receivableOrders, type ProcRow } from '../tracker/procurement'
import { trackerStore } from '../tracker/store'
import type { Delivery, PurchaseOrder, TrackerState } from '../tracker/types'
import { CATEGORY_LABEL } from '../tracker/selectors'

export const fmt = (n: number) => n.toLocaleString('en-CA')
export const when = (at: string) => (at ? new Date(at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '')
export const who = (by: string) => by || 'user not recorded'
const name = (r: { name: string; designation?: string; specification: string; size: string }) => `${displayName(r)}${specText(r) ? ` · ${specText(r)}` : ''}`

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
  const [name, setName] = useState('')
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
    const e = await trackerStore.run(order ? addOrderLines(order.id, payload) : createPurchaseOrder({ name, number, supplierId: supplierId && supplierId !== '__other' ? supplierId : null, supplier: supplierId === '__other' ? other : '', date, expectedDate: expected || null, notes, lines: payload }, today))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title={order ? `Add materials to ${orderTitle(state, order)}` : 'New order'} onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        {!order && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-4"><Field label="Order name"><Input aria-label="Order name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="A short name for this order (optional)" /></Field></div>
            <Field label="PO number (optional)"><Input aria-label="PO number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Add later if not yet known" /></Field>
            <Field label="Supplier">
              <Select aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Not assigned</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__other">Another supplier…</option>
              </Select>
            </Field>
            <Field label="Order date *"><Input aria-label="Order date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Expected delivery"><Input aria-label="Expected delivery" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            {supplierId === '__other' && <Field label="Supplier name"><Input aria-label="Supplier name" value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
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

/** Where an order stands, for the order picker. */
const orderState = (received: number) => (received > 0 ? 'Partially received' : 'Open')

/**
 * The delivery form, without its panel: choose an eligible purchase order, choose which of its lines arrived and how many, then record it.
 * Opened from an order, that order is already chosen; opened from Materials or Orders, the user chooses it. Only orders with something still
 * outstanding are offered, and only that order's lines can be received, each up to what is still outstanding on it.
 */
export function ReceiveForm({ state, today, onClose, orderId, focusKeys = [], onNewOrder, inProject }: { state: TrackerState; today: string; onClose: () => void; orderId?: string; focusKeys?: string[]; onNewOrder?: () => void; inProject?: (orderId: string) => boolean }) {
  const inScope = (id: string) => !inProject || inProject(id)
  const eligible = receivableOrders(state, orderId ? [] : focusKeys).filter((x) => inScope(x.order.id))
  const [chosen, setChosen] = useState(orderId ?? (eligible.length === 1 ? eligible[0].order.id : ''))
  const [search, setSearch] = useState('')
  const entry = chosen && inScope(chosen) ? receivableOrders(state).find((x) => x.order.id === chosen) : undefined
  // Which lines are in this delivery, and how many of each. Re-set whenever the order changes.
  const initial = (id: string): Record<string, string> => {
    const p = receivableOrders(state).find((x) => x.order.id === id)?.progress
    if (!p || !inScope(id)) return {}
    const wanted = focusKeys.length ? p.lines.filter((l) => l.due > 0 && focusKeys.includes(l.line.key)) : p.lines.filter((l) => l.due > 0)
    return Object.fromEntries(wanted.map((l) => [l.line.id, String(l.due)]))
  }
  const [picked, setPicked] = useState<Record<string, string>>(() => (chosen ? initial(chosen) : {}))
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const choose = (id: string) => { setChosen(id); setPicked(id ? initial(id) : {}); setError('') }
  const q = search.trim().toLowerCase()
  const shown = eligible.filter(({ order }) => !q || `${orderTitle(state, order)} ${order.number} ${order.supplier}`.toLowerCase().includes(q) || order.id === chosen)
  const lines = entry?.progress.lines ?? []
  const problem = (id: string, due: number) => {
    const t = picked[id]
    if (t === undefined) return ''
    const n = Number(t)
    if (t.trim() === '' || !Number.isInteger(n) || n < 1) return 'Enter a whole number of 1 or more.'
    if (n > due) return `Only ${fmt(due)} outstanding.`
    return ''
  }
  const included = lines.filter((l) => picked[l.line.id] !== undefined)
  const invalid = included.some((l) => problem(l.line.id, l.due))
  const total = included.reduce((a, l) => a + (Number.isFinite(Number(picked[l.line.id])) ? Number(picked[l.line.id]) : 0), 0)
  const toggle = (id: string, due: number, on: boolean) => setPicked((p) => { const n = { ...p }; if (on) n[id] = String(due); else delete n[id]; return n })
  const save = async () => {
    if (!entry || saving) return
    const payload = included.map((l) => ({ key: l.line.key, qty: Number(picked[l.line.id]) }))
    if (!window.confirm(`Confirm that ${fmt(total)} items against ${orderTitle(state, entry.order)} were physically received and checked?`)) return
    setSaving(true); setError('')
    const e = await trackerStore.run(recordDelivery({ orderId: entry.order.id, date, reference, note, lines: payload }, today))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  if (eligible.length === 0 && !entry && !orderId) {
    return (
      <div className="space-y-4 p-6 text-[13px]">
        <p role="status" className="border-l-2 border-line pl-3 text-muted">{focusKeys.length ? 'None of the open purchase orders is waiting on this material.' : 'There is no purchase order with materials still to receive.'} Materials are received against an order: create one first, then record its delivery here.</p>
        <div className="flex flex-wrap gap-2">{onNewOrder && <Button variant="primary" onClick={onNewOrder}>New order</Button>}<Button variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
    )
  }
  return (
    <div className="space-y-5 p-6 text-[13px]">
      <p className="text-muted">Choose the purchase order the delivery is against, then the items that arrived. Partial deliveries are fine: record the rest when it arrives.</p>
      {!orderId && (
        <Field label="Purchase order *">
          {eligible.length > 6 && <Input aria-label="Search purchase orders" className="mb-2" placeholder="Search by name, PO number or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />}
          <Select aria-label="Purchase order" value={chosen} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose a purchase order…</option>
            {shown.map(({ order, progress }) => <option key={order.id} value={order.id}>{`${orderTitle(state, order)} · PO ${order.number || 'Not Assigned'} · ${order.supplier || 'Supplier Not Assigned'} · ${orderState(progress.received)} · ${fmt(progress.due)} to receive`}</option>)}
          </Select>
        </Field>
      )}
      {orderId && entry && <p className="font-medium">{orderTitle(state, entry.order)} <span className="font-normal text-muted">· PO {entry.order.number || 'Not Assigned'} · {entry.order.supplier || 'Supplier Not Assigned'} · {orderState(entry.progress.received)}</span></p>}
      {orderId && !entry && <p role="status" className="border-l-2 border-line pl-3 text-muted">This order has nothing left to receive, or is cancelled, so no new delivery can be recorded against it.</p>}
      {entry && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="t-label">Items on this order</h3>
            <span className="flex gap-2">
              <Button variant="ghost" className="!h-8" onClick={() => setPicked(Object.fromEntries(lines.filter((l) => l.due > 0).map((l) => [l.line.id, String(l.due)])))}>Receive all outstanding</Button>
              <Button variant="ghost" className="!h-8" onClick={() => setPicked({})}>Clear</Button>
            </span>
          </div>
          <ul className="divide-y divide-line border-y border-line" aria-label="Items on this order">
            {lines.map(({ line, received, due }) => {
              const on = picked[line.id] !== undefined
              const err = problem(line.id, due)
              return (
                <li key={line.id} className={`py-3 ${due === 0 ? 'opacity-60' : ''}`}>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1" disabled={due === 0} checked={on} onChange={(e) => toggle(line.id, due, e.target.checked)} aria-label={`Include ${name(line)}`} />
                    <span className="min-w-0 flex-1"><span className="block font-medium">{name(line)}</span><span className="block text-xs text-muted">{line.area}{due === 0 ? ' · received in full' : ''}</span></span>
                  </label>
                  <dl className="mt-2 grid grid-cols-4 gap-2 pl-7 text-xs">
                    <div><dt className="text-muted">Ordered</dt><dd className="tabular-nums">{fmt(line.qty)}</dd></div>
                    <div><dt className="text-muted">Received</dt><dd className="tabular-nums">{fmt(received)}</dd></div>
                    <div><dt className="text-muted">Remaining</dt><dd className="tabular-nums">{fmt(due)}</dd></div>
                    <div><dt className="text-muted">Receiving now</dt><dd><Input aria-label={`Quantity received: ${name(line)}`} inputMode="numeric" disabled={!on} value={picked[line.id] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [line.id]: e.target.value }))} className="!h-8" /></dd></div>
                  </dl>
                  {err && <p role="alert" className="mt-1 pl-7 text-xs text-bad">{err}</p>}
                </li>
              )
            })}
          </ul>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Date received *"><Input aria-label="Date received" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Delivery note / reference"><Input aria-label="Delivery reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. DN-1042" /></Field>
            <div className="col-span-2"><Field label="Note"><Input aria-label="Delivery note" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
          </div>
          <p className="text-xs text-muted">Recorded as confirmed by you, with the time, when you save.</p>
        </>
      )}
      {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={saving || !entry || included.length === 0 || invalid} onClick={() => void save()}>{saving ? 'Saving…' : `Confirm delivery · ${fmt(total)} items`}</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}

/** The Receive delivery panel. `orderId` opens it on that order (from an order's own Receive action); `focusKeys` offers only orders owing those materials. */
export function ReceiveModal({ state, today, onClose, orderId, focusKeys, onNewOrder, inProject }: { state: TrackerState; today: string; onClose: () => void; orderId?: string; focusKeys?: string[]; onNewOrder?: () => void; inProject?: (orderId: string) => boolean }) {
  const order = orderId ? (state.orders ?? []).find((o) => o.id === orderId) : undefined
  return (
    <Modal title={order ? `Receive delivery · ${orderTitle(state, order)}` : 'Receive delivery'} onClose={onClose} wide>
      <ReceiveForm state={state} today={today} onClose={onClose} orderId={orderId} focusKeys={focusKeys} onNewOrder={onNewOrder} inProject={inProject} />
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
    <Modal title={displayName(row)} onClose={onClose} wide>
      <div className="space-y-6 p-6 text-[13px]">
        <div>
          <p className="text-muted">{row.area} · {CATEGORY_LABEL[row.category]}{specText(row) ? ` · ${specText(row)}` : ''}</p>
          <p className="mt-1 font-medium">{PROC_LABEL[row.status]}{row.orphan && <span className="font-normal text-warn"> · no longer required by the current configuration; orders and deliveries are kept</span>}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 sm:grid-cols-7">
          <Q k="Required" v={row.required} /><Q k="Ordered" v={row.ordered} sub={row.toOrder > 0 ? `${fmt(row.toOrder)} to order` : undefined} /><Q k="Received" v={row.received} />
          <Q k="Outstanding" v={row.outstanding} /><Q k="Allocated" v={row.allocated} /><Q k="Unallocated" v={row.unallocated} /><Q k="Installed" v={row.installed} />
        </dl>
        <div className="flex flex-wrap gap-2">
          {access.can('materials.edit') && <Button variant="primary" onClick={onOrder}>Order</Button>}
          {access.can('materials.receive') && <Button onClick={onReceive}>Receive delivery</Button>}
        </div>

        <section aria-label="Orders">
          <h3 className="t-label mb-2">Orders</h3>
          {row.orderLines.length === 0 && row.orderedOnLines === 0 ? <p className="text-muted">Not ordered yet.</p> : (
            <ul className="divide-y divide-line border-y border-line">
              {row.orderLines.map((l) => { const o = orders.get(l.orderId); return <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{o ? orderTitle(state, o) : ''}{o?.number ? ` · PO ${o.number}` : ''} · {formatDate(o?.date)}</span><span className="tabular-nums">{fmt(l.qty)} {row.unit}</span></li> })}
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

/**
 * Edits an order: name, PO number, supplier and the quantity of each material on it, saved together. A quantity can go up or down but not below
 * what has already been delivered against it; the server checks that and the allocations too, so what is shown here is only guidance.
 */
export function OrderDetailsModal({ order, state, onClose }: { order: PurchaseOrder; state: TrackerState; onClose: () => void }) {
  const suppliers = (state.suppliers ?? []).filter((s) => !s.archived)
  const progress = orderProgress(state, order.id)
  const [orderName, setOrderName] = useState(order.name ?? '')
  const [number, setNumber] = useState(order.number)
  const listed = order.supplierId && suppliers.some((s) => s.id === order.supplierId)
  const [supplierId, setSupplierId] = useState(listed ? order.supplierId! : order.supplier ? '__other' : '')
  const [other, setOther] = useState(listed ? '' : order.supplier)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(progress.lines.map(({ line }) => [line.id, String(line.qty)])))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const total = progress.lines.reduce((a, { line }) => a + (Number.isFinite(toQty(qty[line.id])) ? toQty(qty[line.id]) : 0), 0)
  const save = async () => {
    setSaving(true); setError('')
    const e = await trackerStore.run(editPurchaseOrder(order.id, {
      name: orderName, number, supplierId: supplierId && supplierId !== '__other' ? supplierId : null, supplier: supplierId === '__other' ? other : '',
      quantities: progress.lines.map(({ line }) => ({ lineId: line.id, qty: toQty(qty[line.id]) })),
    }))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title="Edit order" onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        <p className="text-muted">Ordered {formatDate(order.date)}. Changing these does not change what has been delivered or allocated.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-3"><Field label="Order name"><Input aria-label="Order name" value={orderName} maxLength={80} onChange={(e) => setOrderName(e.target.value)} placeholder={orderTitle(state, { ...order, name: '' })} autoFocus /></Field></div>
          <Field label="PO number (optional)"><Input aria-label="PO number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Leave empty if not yet assigned" /></Field>
          <Field label="Supplier">
            <Select aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Not assigned</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__other">Another supplier…</option>
            </Select>
          </Field>
          {supplierId === '__other' && <Field label="Supplier name"><Input aria-label="Supplier name" value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
        </div>
        <section aria-label="Materials on this order">
          <h3 className="t-label mb-2">Materials · {fmt(total)} items</h3>
          <ul className="divide-y divide-line border-y border-line">
            {progress.lines.map(({ line, received }) => (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1"><span className="block">{name(line)}</span><span className="block text-xs text-muted">{line.area}{received > 0 ? ` · ${fmt(received)} delivered, so at least ${fmt(received)}` : ''}</span></span>
                <Input aria-label={`Quantity of ${displayName(line)} ${specText(line)}`} className="!w-24 text-right" inputMode="numeric" min={Math.max(1, received)} value={qty[line.id]} onChange={(e) => setQty({ ...qty, [line.id]: e.target.value })} />
              </li>
            ))}
          </ul>
        </section>
        {error && <p role="alert" className="border-l-2 border-danger pl-3 text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>Save changes</Button></div>
      </div>
    </Modal>
  )
}

/**
 * Corrects a delivery recorded wrongly: date, reference, note and the quantity received on each line. The server refuses a change that would leave
 * less received than has been allocated or installed, and the original values stay in the history. A delivery to be removed altogether is voided instead.
 */
export function CorrectDeliveryModal({ delivery, state, today, onClose }: { delivery: Delivery; state: TrackerState; today: string; onClose: () => void }) {
  const lines = (state.deliveryLines ?? []).filter((l) => l.deliveryId === delivery.id)
  const [date, setDate] = useState(delivery.date)
  const [reference, setReference] = useState(delivery.reference)
  const [note, setNote] = useState(delivery.note)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.qty)])))
  const [orderId, setOrderId] = useState(delivery.orderId ?? '')
  // Orders this delivery could belong to: every material on it must be on the order.
  const fits = (state.orders ?? []).filter((o) => o.id === delivery.orderId || (!o.cancelled && lines.every((l) => (state.orderLines ?? []).some((x) => x.orderId === o.id && x.key === l.key))))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const order = delivery.orderId ? (state.orders ?? []).find((o) => o.id === delivery.orderId) : undefined
  const save = async () => {
    setSaving(true); setError('')
    const e = await trackerStore.run(correctDelivery(delivery.id, { date, reference, note, ...(orderId !== (delivery.orderId ?? '') ? { orderId: orderId || null } : {}), quantities: lines.map((l) => ({ lineId: l.id, qty: toQty(qty[l.id]) })) }, today))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title="Correct delivery" onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        <p className="text-muted">{order ? `Against ${orderTitle(state, order)}. ` : 'Received without an order. '}The original values stay in the history. To remove the delivery altogether, void it.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Date received"><Input aria-label="Date received" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reference"><Input aria-label="Reference" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} /></Field>
          <div className="col-span-2 sm:col-span-3"><Field label="Note"><Input aria-label="Note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field></div>
          <div className="col-span-2 sm:col-span-3"><Field label="Against order">
            <Select aria-label="Against order" value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={!!order?.cancelled}>
              <option value="">Not against an order</option>
              {fits.map((o) => <option key={o.id} value={o.id}>{orderTitle(state, o)}</option>)}
            </Select>
          </Field></div>
        </div>
        <section aria-label="Quantities received">
          <h3 className="t-label mb-2">Quantities received</h3>
          <ul className="divide-y divide-line border-y border-line">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1"><span className="block">{displayName(l)}{specText(l) ? ` · ${specText(l)}` : ''}</span><span className="block text-xs text-muted">{l.area}</span></span>
                <Input aria-label={`Quantity received of ${displayName(l)} ${specText(l)}`} className="!w-24 text-right" inputMode="numeric" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </li>
            ))}
          </ul>
        </section>
        {error && <p role="alert" className="border-l-2 border-danger pl-3 text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>Save correction</Button></div>
      </div>
    </Modal>
  )
}
