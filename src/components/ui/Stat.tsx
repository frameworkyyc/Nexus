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

/** A row of stats separated by thin dividers. */
export function StatRow({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-y-6 border-y border-line py-6 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line [&>div]:lg:px-6 [&>div:first-child]:lg:pl-0">{children}</dl>
}
