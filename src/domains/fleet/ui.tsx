import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { useIsServer } from '@/lib/dataSource'
import { CONDITION_LABEL } from './selectors'
import { resetFleetDemoData } from './store'
import type { ConditionStatus } from './types'

const TONE: Record<ConditionStatus, Tone> = { 'not-assessed': 'muted', good: 'ok', fair: 'warn', poor: 'bad', 'out-of-service': 'bad' }

export const ConditionBadge = ({ condition }: { condition: ConditionStatus }) => <StatusBadge tone={TONE[condition]} label={CONDITION_LABEL[condition]} />

/** Shown on Fleet pages. With saved data there is nothing to reset; the demonstration copy can be reset. */
export function FleetFooter() {
  const server = useIsServer()
  const reset = () => {
    if (window.confirm('Reset fleet demonstration data to its original state? Any reassignments will be lost.')) resetFleetDemoData()
  }
  if (server) return <footer className="mt-16 border-t border-line pt-4"><p className="text-xs text-muted">Saved to the server database. Fields marked “Not recorded” have not been entered.</p></footer>
  return (
    <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      <p className="text-xs text-muted">Demonstration data — stored in this browser only. Fields marked “Not recorded” have not been entered.</p>
      <Button variant="ghost" onClick={reset} className="h-8 whitespace-nowrap px-2"><RotateCcw size={13} strokeWidth={1.5} />Reset demo data</Button>
    </footer>
  )
}

/** Where the records live and what protects them. Roles are modelled but not enforced. */
export function AccessNotice() {
  const server = useIsServer()
  return (
    <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted">
      {server
        ? 'Records are saved on the server and shown on every device you sign in from. Only approved accounts can reach this site (Cloudflare Access). Roles inside Nexus (fleet manager, project supervisor, project user) are designed but not enforced: everyone who signs in can change everything.'
        : 'Records are stored in this browser only, so other users and devices do not see them. Role-based access (fleet managers, project supervisors, project users) is designed but not enforced: there is no sign-in yet, so these pages are not secure.'}
    </p>
  )
}

export const NOT_RECORDED = <span className="text-muted">Not recorded</span>
