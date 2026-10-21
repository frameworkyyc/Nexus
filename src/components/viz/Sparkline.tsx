import { STATUS_COLOR, type Status } from './status'

export interface SparkPoint { x: number; y: number }

/** x/y → svg path and the last point's position. Pure so it can be tested. Needs at least two distinct x values; otherwise there is no trend to draw. */
export function sparkGeometry(points: SparkPoint[], width: number, height: number, pad = 3): { d: string; last: SparkPoint } | null {
  if (points.length < 2) return null
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y)
  const x0 = Math.min(...xs); const x1 = Math.max(...xs)
  if (x0 === x1) return null
  const y0 = Math.min(...ys); const y1 = Math.max(...ys)
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * (width - pad * 2)
  const sy = (y: number) => (y1 === y0 ? height / 2 : height - pad - ((y - y0) / (y1 - y0)) * (height - pad * 2))
  const at = points.map((p) => ({ x: sx(p.x), y: sy(p.y) }))
  return { d: at.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '), last: at[at.length - 1] }
}

/** A small trend line drawn from recorded points only. Fewer than two points renders nothing, never a made-up line. */
export function Sparkline({ points, label, status = 'info', width = 120, height = 32 }: { points: SparkPoint[]; label: string; status?: Status; width?: number; height?: number }) {
  const g = sparkGeometry(points, width, height)
  if (!g) return null
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <path d={g.d} fill="none" stroke={STATUS_COLOR[status]} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle r={2.5} fill={STATUS_COLOR[status]} cx={g.last.x} cy={g.last.y} />
    </svg>
  )
}
