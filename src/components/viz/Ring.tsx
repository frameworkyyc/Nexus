import type { ReactNode } from 'react'
import { ringFraction, ringGeometry, STATUS_COLOR, type Status } from './status'

/** One size, stroke ratio and typography for every ring in Nexus (Fleet and Construction). */
export const RING_SIZE = 176
export const ringStroke = (size: number) => Math.max(6, Math.round(size * 0.06))

export interface RingProps {
  /** 0–100 progress. null = no percentage: the ring is a plain grey track (unknown) or, with a known `status`, a faintly tinted track (status-only). */
  percent: number | null
  status: Status
  size?: number
  /** Content centred in the ring (the big figure). */
  children?: ReactNode
  label?: string
}

/**
 * The shared rendering primitive: a smooth full-circle track plus one solid progress arc. Progress starts at 12 o'clock and runs
 * clockwise. There is no dashing, segmenting or per-segment colour, so the stroke is always a clean circle.
 */
export function Ring({ percent, status, size = RING_SIZE, children, label }: RingProps) {
  const stroke = ringStroke(size)
  const fraction = ringFraction(percent)
  const g = ringGeometry(size, stroke, fraction)
  const color = STATUS_COLOR[status]
  const statusOnly = fraction === null && status !== 'unknown'
  const c = size / 2
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" data-testid="gauge-ring" data-fraction={fraction ?? 'none'} data-size={size}>
        {/* Track: a complete circle. Status-only rings tint it; unknown rings keep the neutral grey. */}
        <circle cx={c} cy={c} r={g.radius} fill="none" stroke={statusOnly ? color : 'var(--nx-track)'} strokeOpacity={statusOnly ? 0.28 : 1} strokeWidth={stroke} data-testid="gauge-track" />
        {fraction !== null && fraction > 0 && (
          // rotate(-90) puts the start at 12 o'clock; an increasing dash offset on a circle draws clockwise.
          <circle cx={c} cy={c} r={g.radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${g.dash} ${g.circumference}`}
            transform={`rotate(-90 ${c} ${c})`} data-testid="gauge-arc" />
        )}
      </svg>
      {children !== undefined && <div className="absolute inset-0 flex flex-col items-center justify-center px-[14%] text-center">{children}</div>}
    </div>
  )
}

/** The big figure inside a ring, sized from the ring so every gauge has the same typography. */
/** `word` shrinks the figure for a status word (Unknown, Overdue) so it sits inside the ring like a number does. */
export function RingValue({ value, unit, size = RING_SIZE, word = false, scale }: { value: ReactNode; unit?: ReactNode; size?: number; word?: boolean; scale?: number }) {
  return (
    <>
      <div className="font-light leading-none tracking-tight tabular-nums" style={{ fontSize: Math.round(size * (scale ?? (word ? 0.14 : 0.2))) }}>{value}</div>
      {unit && <div className="mt-1.5 text-xs leading-tight text-muted">{unit}</div>}
    </>
  )
}
