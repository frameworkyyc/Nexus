import type { ReactNode } from 'react'
import { StatusMark } from './StatusMark'
import type { Status } from './status'

export interface AlertItem { id: string; status: Exclude<Status, 'ok'>; text: ReactNode; onSelect?: () => void }

const RANK = { bad: 0, warn: 1, unknown: 2, info: 3 } as const

/** Things that need attention, worst first. Renders nothing when there is nothing to flag. */
export function MaintenanceAlerts({ items, title = 'Needs attention' }: { items: AlertItem[]; title?: string }) {
  if (!items.length) return null
  const sorted = [...items].sort((a, b) => RANK[a.status] - RANK[b.status])
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="t-label mb-2">{title}</h2>
      <ul className="space-y-1.5">
        {sorted.map((a) => (
          <li key={a.id} className="flex items-start gap-3 text-[13px]">
            <StatusMark status={a.status} label="" size={16} className="mt-0.5" />
            {a.onSelect ? <button type="button" onClick={a.onSelect} className="text-left underline-offset-4 hover:underline">{a.text}</button> : <span>{a.text}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
