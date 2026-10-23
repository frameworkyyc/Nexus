export function ProgressBar({ value, width = 'w-24 sm:w-32', showValue = true }: { value: number; width?: string; showValue?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`h-px bg-line ${width}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="-mt-px h-0.5 bg-ink" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      {showValue && <span className="w-9 text-[13px] tabular-nums text-muted">{value}%</span>}
    </div>
  )
}
