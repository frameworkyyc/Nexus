import type { ReactNode } from 'react'
import { percentOf } from '@/lib/format'
import { CARD } from '@/components/mobile/Cards'
import { Donut } from '@/components/ui/Donut'
import { Ring, RingValue, RING_SIZE } from '@/components/viz/Ring'

/**
 * The one progress gauge layout in Nexus, taken from the Area Overview: a label above a full-size ring (RING_SIZE), the figure inside it, and
 * any footer beneath. Every screen that shows a row of gauges uses these, so size, ring thickness, typography and spacing cannot drift.
 */
export const GAUGE_GRID = 'grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-4'

/** The figure inside a ring: a percentage (the default) or a count such as 4/12. */
export function GaugeFigure({ percent, label, of, count, size = RING_SIZE }: { percent?: number | null; label: string; of?: number; count?: number; size?: number }) {
  if (count !== undefined && of !== undefined) {
    const pct = percentOf(count, of) ?? 0
    return <Ring percent={pct} status="info" size={size} label={`${label}: ${count} of ${of}`}><RingValue size={size} value={<>{count}<span className="text-[0.62em] text-muted">/{of}</span></>} /></Ring>
  }
  return <Donut value={percent ?? null} label={label} size={size} />
}

/** Desktop and tablet: label above, ring centred, optional footer. `action` sits at the right of the label row. */
export function ProgressGauge({ title, percent, count, of, action, children }: { title: string; percent?: number | null; count?: number; of?: number; action?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between"><span className="t-label">{title}</span>{action}</div>
      <div className="mt-4 flex justify-center"><GaugeFigure label={title} percent={percent} count={count} of={of} /></div>
      {children}
    </div>
  )
}

/** Phone: a card with the ring beside the label and its details, as on the Area Overview. */
export function GaugeCard({ title, percent, count, of, children }: { title: string; percent?: number | null; count?: number; of?: number; children?: ReactNode }) {
  return (
    <div className={`${CARD} flex items-center gap-4 p-4`}>
      <div className="shrink-0"><GaugeFigure label={title} percent={percent} count={count} of={of} size={112} /></div>
      <div className="min-w-0 flex-1"><span className="t-label">{title}</span>{children}</div>
    </div>
  )
}

/** The footer used under a gauge for a short caption. */
export const GaugeCaption = ({ children }: { children: ReactNode }) => <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{children}</p>
