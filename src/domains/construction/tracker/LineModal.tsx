import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/format'
import { addReceipt, confirmNoReceipts, removeReceipt, setNotes, setOrdered } from './commands'
import { CATEGORY_LABEL, DELIVERY_LABEL, deliveryState, isVerified, receivedOf, remainingOf } from './selectors'
import { useTracker, useTrackerCommand } from './store'
import type { ImportFlag } from './types'

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 border-b border-line py-2.5"><dt className="text-muted">{k}</dt><dd>{children}</dd></div>
)

/** Inspect one imported line and maintain its Nexus-side records: receipts, ordered quantity, notes. */
export function LineModal({ lineId, onClose }: { lineId: string; onClose: () => void }) {
  const { state, today } = useTracker()
  const { run, saving } = useTrackerCommand()
  const line = state.lines.find((l) => l.id === lineId)
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(today)
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [ordered, setOrderedText] = useState<string | null>(null)
  if (!line) return null
  const flags: ImportFlag[] = state.flags.filter((f) => f.lineId === line.id)
  const remaining = remainingOf(line)
  const ds = deliveryState(line)
  const save = () => {
    run(addReceipt(line.id, { date, qty: Number(qty), reference: ref, note }, today), () => { setQty(''); setRef(''); setNote('') })
  }
  return (
    <Modal title={line.component} onClose={onClose} wide>
      <div className="space-y-8 p-6 text-[13px]">
        <dl className="border-t border-line">
          <Row k="Area">{line.area}</Row>
          <Row k="Footing type">{line.footingType || '—'}</Row>
          <Row k="Anchorage type">{line.anchorageType || '—'}</Row>
          <Row k="Component type">{CATEGORY_LABEL[line.category]}</Row>
          <Row k="Counts">{line.footings} footings · {line.plinths} plinths · {line.bolts} bolts</Row>
          <Row k="Required">{line.requiredQty.toLocaleString('en-CA')} <span className="text-muted">= {line.calc.expression}{line.calc.recomputed !== null && line.calc.recomputed !== line.requiredQty ? ` (formula gives ${line.calc.recomputed})` : ''}</span></Row>
          <Row k="Workbook status">{line.sourceStatus || '—'} <span className="text-muted">(a spreadsheet status, not a receipt)</span></Row>
          <Row k="Source">{line.source.sheet}, row {line.source.row}</Row>
        </dl>

        {line.sourceNotes.length > 0 && (
          <section><h3 className="t-label mb-2">Workbook comments</h3>{line.sourceNotes.map((n, i) => <p key={i} className="whitespace-pre-line border-l-2 border-line pl-3 text-muted">{n}</p>)}</section>
        )}
        {flags.length > 0 && (
          <section><h3 className="t-label mb-2">Flagged for review</h3><ul className="space-y-1.5">{flags.map((f) => <li key={f.id} className="text-muted">{f.message}</li>)}</ul></section>
        )}

        <section>
          <h3 className="t-label mb-2">Delivery · {DELIVERY_LABEL[ds]}</h3>
          <dl className="border-t border-line">
            <Row k="Received (verified)">{isVerified(line) ? receivedOf(line).toLocaleString('en-CA') : <span className="text-muted">Not verified</span>}</Row>
            <Row k="Remaining">{remaining === null ? <span className="text-muted">Unknown until a receipt is recorded or “nothing received” is confirmed</span> : remaining.toLocaleString('en-CA')}</Row>
          </dl>
          {line.receipts.length > 0 && (
            <ul className="mt-2">
              {line.receipts.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                  <span>{formatDate(r.date)} · <span className="tabular-nums">{r.qty.toLocaleString('en-CA')}</span>{r.reference && <span className="text-muted"> · {r.reference}</span>}{r.note && <span className="text-muted"> · {r.note}</span>}</span>
                  <button className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => run(removeReceipt(line.id, r.id))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Quantity received"><Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Delivery ref."><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={saving || !qty} onClick={save}>{saving ? 'Saving…' : 'Record receipt'}</Button>
            {!line.receipts.length && (
              <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={line.confirmedNoReceipts} onChange={(e) => run(confirmNoReceipts(line.id, e.target.checked))} />Confirm nothing has been received</label>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Ordered quantity (optional)">
            <Input inputMode="numeric" placeholder="Not recorded" value={ordered ?? (line.orderedQty === null ? '' : String(line.orderedQty))} onChange={(e) => setOrderedText(e.target.value)}
              onBlur={() => { if (ordered !== null) run(setOrdered(line.id, ordered.trim() === '' ? null : Number(ordered)), () => setOrderedText(null)) }} />
          </Field>
          <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={3} defaultValue={line.notes} onBlur={(e) => e.target.value !== line.notes && run(setNotes(line.id, e.target.value))} /></Field></div>
        </section>
        {line.sourceRemoved && <p className="text-xs text-muted">This row is no longer in the latest imported workbook; it is kept because it holds entries made in Nexus.</p>}
      </div>
    </Modal>
  )
}
