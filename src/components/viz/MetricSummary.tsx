import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StatusMark } from './StatusMark'
import type { Status } from './status'

/** A large figure with a label: the borderless replacement for a boxed stat. Optional status, sparkline slot and click-through. */
export function MetricSummary({ label, value, sub, status, statusLabel, visual, to, onSelect }: {
  label: string; value: ReactNode; sub?: ReactNode; status?: Status; statusLabel?: string; visual?: ReactNode; to?: string; onSelect?: () => void
}) {
  const body = (
    <>
      <div className="t-label">{label}</div>
      <div className="mt-2 min-h-10 text-[1.75rem] font-light leading-10 sm:text-[2rem] tracking-tight tabular-nums">{value}</div>
      {status && statusLabel && <div className="mt-1.5"><StatusMark status={status} label={statusLabel} /></div>}
      {sub && <div className="mt-1 text-xs leading-snug text-muted">{sub}</div>}
      {visual && <div className="mt-3">{visual}</div>}
    </>
  )
  const cls = 'block w-full min-w-0 max-w-full text-left'
  // The grid cell is a plain div so every summary aligns to the top, whether or not its content is interactive.
  return (
    <div className="min-w-0 self-start">
      {to ? <Link to={to} className={`${cls} hover:opacity-80`}>{body}</Link> : onSelect ? <button type="button" onClick={onSelect} className={`${cls} hover:opacity-80`}>{body}</button> : <div className={cls}>{body}</div>}
    </div>
  )
}
