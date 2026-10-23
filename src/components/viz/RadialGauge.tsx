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
  /**
   * 'stack' (default, desktop): ring above its caption, caption centred. 'row' (phones): a horizontal card with the ring on the left and the
   * title, status, the unit line and details on the right, so four gauges stay readable without four screens of scrolling.
   */
  layout?: 'stack' | 'row'
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
export function RadialGauge({ title, percent, status, statusLabel, value, unit, detail, size = RING_SIZE, layout = 'stack', word = false, onSelect, to, actions }: RadialGaugeProps) {
  const row = layout === 'row'
  const aria = `${title}: ${statusLabel}${percent !== null ? `, ${Math.round(percent * 10) / 10}%` : ''}`
  const face = <Ring percent={percent} status={status} size={size}><RingValue value={value} unit={row ? undefined : unit} size={size} word={word} scale={row ? (word ? 0.15 : 0.225) : undefined} /></Ring>
  const interactive = to ? (
    <Link to={to} aria-label={aria} className="block rounded-full">{face}</Link>
  ) : onSelect ? (
    <button type="button" onClick={onSelect} aria-label={`${aria}. Show details`} className="block w-full rounded-full">{face}</button>
  ) : (
    <div role="img" aria-label={aria}>{face}</div>
  )
  return (
    <figure className={row ? 'flex items-center gap-4 text-left' : 'flex flex-col items-center text-center'} data-status={status}>
      <div className={row ? 'shrink-0' : 'w-full'}>{interactive}</div>
      <figcaption className={row ? 'min-w-0 flex-1' : 'mt-4 max-w-[16rem]'}>
        <div className="t-label">{title}</div>
        {row && unit && <div className="mt-1 text-[17px] font-medium leading-snug tabular-nums">{unit}</div>}
        <div className={`mt-1.5 flex ${row ? '' : 'justify-center'}`}><StatusMark status={status} label={statusLabel} /></div>
        {detail && <div className="mt-1 text-xs leading-snug text-muted">{detail}</div>}
        {actions && <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 ${row ? '' : 'justify-center'}`}>{actions}</div>}
      </figcaption>
    </figure>
  )
}
