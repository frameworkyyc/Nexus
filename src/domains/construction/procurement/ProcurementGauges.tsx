import { CARD } from '@/components/mobile/Cards'
import { GAUGE_GRID, GaugeCard, ProgressGauge } from '@/components/ui/ProgressGauge'
import { useIsPhone } from '@/lib/useMedia'
import { fmt } from './Dialogs'
import type { ProcurementSummary } from './summary'

export type GaugeKey = 'pending' | 'ordered' | 'delivered' | 'overdue'

/**
 * Four ring gauges above the Procurement tabs, in the Area Overview's design (same ring, label, footer and phone card). Each is a button that filters
 * the matching tab: Pending and Delivered filter Materials by status; Ordered and Overdue filter Orders.
 */
export function ProcurementGauges({ summary, onPick, active }: { summary: ProcurementSummary; onPick: (k: GaugeKey) => void; active?: GaugeKey | null }) {
  const phone = useIsPhone()
  const { required: R } = summary
  const items: { key: GaugeKey; title: string; qty: number; line: string; note: string; percent: number | null }[] = [
    { key: 'pending', title: 'Pending', qty: summary.pending, line: 'Required, not yet ordered', note: 'Filters Materials to those still to order', percent: summary.percent.pending },
    { key: 'ordered', title: 'Ordered', qty: summary.ordered, line: 'Ordered (delivered or not)', note: 'Shows the orders placed', percent: summary.percent.ordered },
    { key: 'delivered', title: 'Delivered', qty: summary.delivered, line: 'Received', note: 'Filters Materials to those with any quantity received', percent: summary.percent.delivered },
    { key: 'overdue', title: 'Overdue', qty: summary.overdue, line: `Undelivered, past expected date${summary.overdueOrders ? ` · ${summary.overdueOrders} order${summary.overdueOrders === 1 ? '' : 's'}` : ''}`, note: 'Shows orders past their expected delivery date', percent: summary.percent.overdue },
  ]
  const foot = (i: (typeof items)[number]) => (
    <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
      <div className="flex justify-between gap-3"><dt className="text-muted">{i.line}</dt><dd className="tabular-nums">{fmt(i.qty)} of {fmt(R)}</dd></div>
    </dl>
  )
  return (
    <section aria-label="Procurement progress" className="mb-8">
      <ul className={phone ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : GAUGE_GRID}>
        {items.map((i) => (
          <li key={i.key}>
            <button type="button" onClick={() => onPick(i.key)} aria-pressed={active === i.key} aria-label={`${i.title}: ${i.percent ?? 0}%, ${fmt(i.qty)} of ${fmt(R)}. ${i.note}`} className={`group block w-full text-left ${phone ? '' : 'hover:opacity-90'}`}>
              {phone
                ? <GaugeCard title={i.title} percent={i.percent}>{foot(i)}</GaugeCard>
                : <div className={active === i.key ? 'border-b-2 border-ink pb-2' : 'pb-2'}><ProgressGauge title={i.title} percent={i.percent}>{foot(i)}</ProgressGauge></div>}
            </button>
          </li>
        ))}
      </ul>
      {R === 0 && <p className={`${CARD} mt-3 p-3 text-xs text-muted`}>Nothing is required yet, so there is no progress to show.</p>}
    </section>
  )
}
