import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ringGeometry, ringFraction, STATUS_COLOR, type Status } from './status'
import { StatusMark } from './StatusMark'

export interface RadialGaugeProps {
  /** What is measured, e.g. "Scheduled service". */
  title: string
  /** Percentage 0–100 (values above 100 fill the ring). null = unknown / not computable: the ring stays empty and dashed. */
  percent: number | null
  status: Status
  /** Short status text shown with the glyph, e.g. "Due in 1,695 km". Colour is never the only signal. */
  statusLabel: string
  /** The big figure in the centre (already formatted) and its unit/caption. */
  value: ReactNode
  unit?: ReactNode
  /** Supporting lines under the gauge. */
  detail?: ReactNode
  size?: number
  /** Click-through to detail: an in-page anchor/handler or a route. */
  onSelect?: () => void
  to?: string
  /** Quick actions rendered under the gauge (e.g. "Record oil change"). */
  actions?: ReactNode
}

/**
 * Large radial indicator. The arc is drawn only when `percent` is a number; an unknown value shows an empty dashed track, never a
 * filled or partly filled ring. The centre always carries the numeric value as text, and the status has a glyph and a label.
 */
export function RadialGauge({ title, percent, status, statusLabel, value, unit, detail, size = 184, onSelect, to, actions }: RadialGaugeProps) {
  const stroke = Math.round(size * 0.075)
  const fraction = ringFraction(percent)
  const g = ringGeometry(size, stroke, fraction)
  const color = STATUS_COLOR[status]
  const aria = `${title}: ${statusLabel}${percent !== null ? `, ${Math.round(percent)}% of interval used` : ''}`
  const face = (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true" data-testid="gauge-ring" data-fraction={fraction ?? 'unknown'}>
        <circle cx={size / 2} cy={size / 2} r={g.radius} fill="none" stroke={fraction === null && status !== 'unknown' ? color : 'var(--nx-track)'} strokeOpacity={fraction === null && status !== 'unknown' ? 0.4 : 1} strokeWidth={stroke} strokeDasharray={fraction === null ? '2 7' : undefined} strokeLinecap={fraction === null ? 'round' : undefined} />
        {fraction !== null && fraction > 0 && (
          <circle cx={size / 2} cy={size / 2} r={g.radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${g.dash} ${g.gap}`} data-testid="gauge-arc" />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <div className="t-metric leading-none" style={{ fontSize: size * 0.17 }}>{value}</div>
        {unit && <div className="mt-1 text-xs text-muted">{unit}</div>}
      </div>
    </div>
  )
  const interactive = to ? (
    <Link to={to} aria-label={aria} className="group block rounded-full focus-visible:outline-2">{face}</Link>
  ) : onSelect ? (
    <button type="button" onClick={onSelect} aria-label={`${aria}. Show details`} className="group block w-full rounded-full">{face}</button>
  ) : (
    <div role="img" aria-label={aria}>{face}</div>
  )
  return (
    <figure className="flex flex-col items-center text-center" data-status={status}>
      {interactive}
      <figcaption className="mt-4 max-w-[16rem]">
        <div className="t-label">{title}</div>
        <div className="mt-1.5 flex justify-center"><StatusMark status={status} label={statusLabel} /></div>
        {detail && <div className="mt-1.5 text-xs leading-snug text-muted">{detail}</div>}
        {actions && <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">{actions}</div>}
      </figcaption>
    </figure>
  )
}
