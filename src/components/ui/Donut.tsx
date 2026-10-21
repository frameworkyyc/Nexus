/** Minimal monochrome ring. `value` null renders an empty ring with "Not tracked". */
export function Donut({ value, label, size = 144 }: { value: number | null; label: string; size?: number }) {
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value === null ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={value === null ? `${label}: not tracked` : `${label}: ${value}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--nx-line)" strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--nx-ink)" strokeWidth={stroke} strokeDasharray={`${(v / 100) * c} ${c}`} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {value === null ? <span className="text-xs text-muted">Not tracked</span> : <span className="t-metric">{value}<span className="text-lg text-muted">%</span></span>}
      </div>
    </div>
  )
}
