import { Field, Input, Select } from '@/components/ui/Field'
import { useConstruction } from '../../store'
import { scopedCalc } from '../requirements'
import type { QtyBasis } from '../types'

const OPTIONS: { value: QtyBasis; label: string }[] = [
  { value: 'fixed', label: 'Fixed total quantity' },
  { value: 'per-anchorage', label: 'Per anchorage type instance' },
  { value: 'per-plinth', label: 'Per plinth' },
  { value: 'per-footing', label: 'Per footing' },
]
const HELP: Record<QtyBasis, string> = {
  fixed: 'The quantity is the total required. Nothing is multiplied.',
  'per-anchorage': 'Counted on every plinth that uses the chosen anchorage type, across all of the foundation’s footings.',
  'per-plinth': 'Counted on every plinth of the chosen foundation, across all of its footings.',
  'per-footing': 'Counted once for each footing (physical foundation) of the chosen foundation.',
}

/**
 * What the entered quantity refers to, and the resulting total. For anything other than a fixed total the total is calculated from the
 * foundation's actual counts and recalculated if they change, so the entry shows the working: "4 per plinth × 36 plinths (OP-101) = 144".
 */
export function QuantityScope({ basis, onBasis, qty, onQty, foundationId, anchorageTypeId, label = 'Quantity', ariaLabel }: {
  basis: QtyBasis; onBasis: (b: QtyBasis) => void; qty: string; onQty: (q: string) => void
  foundationId: string | null | undefined; anchorageTypeId: string | null | undefined; label?: string; ariaLabel?: string
}) {
  const { state } = useConstruction()
  const n = qty.trim() === '' ? NaN : Number(qty)
  const calc = Number.isInteger(n) && n >= 0 ? scopedCalc(state, basis, n, foundationId, anchorageTypeId) : null
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity is"><Select aria-label="Quantity is" value={basis} onChange={(e) => onBasis(e.target.value as QtyBasis)}>{OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
        <Field label={basis === 'fixed' ? `${label} required (total) *` : `${label} ${OPTIONS.find((o) => o.value === basis)!.label.toLowerCase()} *`}><Input aria-label={ariaLabel ?? 'Qty required'} inputMode="numeric" value={qty} onChange={(e) => onQty(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-muted">{HELP[basis]}</p>
      {basis !== 'fixed' && (
        <p role="status" aria-live="polite" className="text-[13px]">
          {calc === null ? <span className="text-muted">Enter the quantity to see the total.</span> : 'error' in calc ? <span className="text-muted">{calc.error}</span> : <><span className="text-muted">{calc.calc.expression.replace(/ = [\d,]+$/, ' = ')}</span><span className="font-medium">{calc.total.toLocaleString('en-CA')} total required</span></>}
        </p>
      )}
    </div>
  )
}
