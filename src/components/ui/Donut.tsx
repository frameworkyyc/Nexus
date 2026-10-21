import { ringFraction, ringGeometry, STATUS_COLOR, type Status } from '@/components/viz/status'

/**
 * Ring for plain progress (e.g. package completion). Uses the same ring maths as RadialGauge. Progress is informational, so the
 * default colour is the neutral blue, never red: low completion is not a problem unless it is behind a recorded schedule or target
 * (pass `status` to say so). `value` null renders a dashed empty track with "Not tracked".
 */
export function Donut({ value, label, size = 144, status = 'info' }: { value: number | null; label: string; size?: number; status?: Status }) {
  const stroke = 8
  const fraction = ringFraction(value)
  const g = ringGeometry(size, stroke, fraction)
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={value === null ? `${label}: not tracked` : `${label}: ${value}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={g.radius} fill="none" stroke="var(--nx-track)" strokeWidth={stroke} strokeDasharray={fraction === null ? '2 6' : undefined} strokeLinecap={fraction === null ? 'round' : undefined} />
        {fraction !== null && fraction > 0 && <circle cx={size / 2} cy={size / 2} r={g.radius} fill="none" stroke={STATUS_COLOR[status]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${g.dash} ${g.gap}`} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {value === null ? <span className="text-xs text-muted">Not tracked</span> : <span className="t-metric">{value}<span className="text-lg text-muted">%</span></span>}
      </div>
    </div>
  )
}
