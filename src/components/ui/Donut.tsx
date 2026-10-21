import { Ring, RingValue, RING_SIZE } from '@/components/viz/Ring'
import type { Status } from '@/components/viz/status'

/**
 * Plain progress ring (e.g. package completion), drawn with the same Ring primitive as every other gauge. Progress is informational,
 * so the default colour is the neutral blue, never red: low completion is not a problem unless it is behind a recorded schedule or
 * target (pass `status` to say so). `value` null renders a clean grey track with "Not tracked".
 */
export function Donut({ value, label, size = RING_SIZE, status = 'info' }: { value: number | null; label: string; size?: number; status?: Status }) {
  return (
    <Ring percent={value} status={value === null ? 'unknown' : status} size={size} label={value === null ? `${label}: not tracked` : `${label}: ${value}%`}>
      {value === null ? <span className="text-xs text-muted">Not tracked</span> : <RingValue size={size} value={<>{value}<span className="text-[0.5em] text-muted">%</span></>} />}
    </Ring>
  )
}
