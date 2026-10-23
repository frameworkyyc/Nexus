import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ring, RingValue, RING_SIZE } from './Ring'
import { StatusMark } from './StatusMark'
import type { Status } from './status'

export interface RadialGaugeProps {
  /** What is measured, e.g. "Oil Change". */
  title: string
  /** 0–100 progress shown by the arc. null = status-only (known status, no percentage) or unknown (status "unknown"). */
  percent: number | null
  status: Status
  /** Short status text shown with a glyph. Colour is never the only signal. */
  statusLabel: string
  /** The figure in the centre (already formatted) and a line beneath it. */
  value: ReactNode
  unit?: ReactNode
  /** One or two short supporting lines under the status. */
  detail?: ReactNode
  size?: number
  /** The centre figure is a status word (Unknown, Overdue) rather than a number. */
  word?: boolean
  /** Click-through to detail: a handler (in-page) or a route. */
  onSelect?: () => void
  to?: string
  /** Quick actions under the gauge (e.g. "Edit estimate"). */
  actions?: ReactNode
}

/**
 * Large radial gauge built on the shared Ring. Used for both percentage gauges and status-only gauges; an unknown value is a clean
 * grey track with the word Unknown, never a partial arc.
 */
export function RadialGauge({ title, percent, status, statusLabel, value, unit, detail, size = RING_SIZE, word = false, onSelect, to, actions }: RadialGaugeProps) {
  const aria = `${title}: ${statusLabel}${percent !== null ? `, ${Math.round(percent * 10) / 10}%` : ''}`
  const face = <Ring percent={percent} status={status} size={size}><RingValue value={value} unit={unit} size={size} word={word} /></Ring>
  const interactive = to ? (
    <Link to={to} aria-label={aria} className="block rounded-full">{face}</Link>
  ) : onSelect ? (
    <button type="button" onClick={onSelect} aria-label={`${aria}. Show details`} className="block w-full rounded-full">{face}</button>
  ) : (
    <div role="img" aria-label={aria}>{face}</div>
  )
  return (
    <figure className="flex flex-col items-center text-center" data-status={status}>
      {interactive}
      <figcaption className="mt-4 max-w-[16rem]">
        <div className="t-label">{title}</div>
        <div className="mt-1.5 flex justify-center"><StatusMark status={status} label={statusLabel} /></div>
        {detail && <div className="mt-1 text-xs leading-snug text-muted">{detail}</div>}
        {actions && <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">{actions}</div>}
      </figcaption>
    </figure>
  )
}
