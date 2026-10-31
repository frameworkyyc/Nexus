import type { ReactNode } from 'react'

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <dt className="t-label">{label}</dt>
      <dd className="t-metric mt-2">{value}</dd>
      {sub && <p className="mt-1 text-xs leading-snug text-muted">{sub}</p>}
    </div>
  )
}

