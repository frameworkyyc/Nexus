import type { ReactNode } from 'react'
import { StatusMark } from './StatusMark'

/** The intentional "we don't know" state: a muted dashed outline, the word Unknown and the reason, never a placeholder number. */
export function UnknownState({ title, reason, action }: { title?: string; reason: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-4 text-sm" data-testid="unknown-state">
      {title && <div className="t-label">{title}</div>}
      <div className={title ? 'mt-1.5' : ''}><StatusMark status="unknown" label="Unknown" /></div>
      <p className="mt-1 text-xs leading-snug text-muted">{reason}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
