import { Link } from 'react-router-dom'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { STATUS_LABEL, STATUS_TONE, type HandoverPhase } from './config'
import type { Exception } from './exceptions'
import type { Issue } from './selectors'
import { FOUNDATION_STATE_LABEL, type FoundationStateId, type Tally } from './selectors'
import type { ActivityStatus } from './types'

export const ActivityStatusBadge = ({ status }: { status: ActivityStatus }) => <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />

export function FoundationStateBadge({ state, blocked }: { state: FoundationStateId; blocked?: boolean }) {
  if (blocked) return <StatusBadge tone="bad" label="Blocked" />
  const tone = { 'not-started': 'muted', 'in-progress': 'info', constructed: 'ok', 'closed-out': 'ok' } as const
  return <StatusBadge tone={tone[state]} label={FOUNDATION_STATE_LABEL[state]} />
}

export const phaseTone = (phase: HandoverPhase): Tone =>
  ({ 'in-progress': 'muted', 'construction-complete': 'info', 'handover-preparation': 'info', 'ready-for-review': 'warn', 'handed-over': 'ok' } as const)[phase]

export const fraction = (t: Pick<Tally, 'done' | 'total'>) => `${t.done}/${t.total}`

const severityDot = { high: 'bg-bad', medium: 'bg-warn', low: 'bg-neutral-400' }

export function IssueList({ issues, limit, empty = 'Nothing requires attention.' }: { issues: Issue[]; limit?: number; empty?: string }) {
  const shown = limit ? issues.slice(0, limit) : issues
  if (!shown.length) return <p className="py-6 text-[13px] text-muted">{empty}</p>
  return (
    <ul>
      {shown.map((i) => (
        <li key={i.id} className="border-b border-line">
          <Link to={i.to} className="flex items-start gap-3 py-3 transition-colors hover:bg-hover">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${severityDot[i.severity]}`} title={`${i.severity} priority`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{i.title}</span>
              <span className="block truncate text-xs text-muted">{i.detail}</span>
            </span>
          </Link>
        </li>
      ))}
      {limit && issues.length > limit && <li className="py-3 text-xs text-muted">+ {issues.length - limit} more</li>}
    </ul>
  )
}

/** Small text link used inside tables. */
export const TextLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to} className="underline-offset-4 transition-colors hover:underline">
    {children}
  </Link>
)

const exDot = { high: 'bg-bad', medium: 'bg-warn' }

/** Compact list of significant items: title, area, status. Each row opens its record. */
export function ExceptionList({ items, limit = 6, empty = 'Nothing needs attention.', showArea = true }: { items: Exception[]; limit?: number; empty?: string; showArea?: boolean }) {
  if (!items.length) return <p className="border-t border-line py-6 text-[13px] text-muted">{empty}</p>
  return (
    <ul className="border-t border-line">
      {items.slice(0, limit).map((e) => (
        <li key={e.id} className="border-b border-line">
          <Link to={e.to} className="flex items-start gap-3 py-3 transition-colors hover:bg-hover">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${exDot[e.severity]}`} title={e.severity === 'high' ? 'Critical' : 'Attention'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{e.title}</span>
              {showArea && <span className="block text-xs text-muted">{e.area}</span>}
            </span>
            <span className="shrink-0 text-xs text-muted">{e.status}</span>
          </Link>
        </li>
      ))}
      {items.length > limit && <li className="py-3 text-xs text-muted">+ {items.length - limit} more</li>}
    </ul>
  )
}
