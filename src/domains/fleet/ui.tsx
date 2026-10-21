import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { CONDITION_LABEL } from './selectors'
import { resetFleetDemoData } from './store'
import type { ConditionStatus } from './types'

const TONE: Record<ConditionStatus, Tone> = { 'not-assessed': 'muted', good: 'ok', fair: 'warn', poor: 'bad', 'out-of-service': 'bad' }

export const ConditionBadge = ({ condition }: { condition: ConditionStatus }) => <StatusBadge tone={TONE[condition]} label={CONDITION_LABEL[condition]} />

/** Shown on Fleet pages: the data is demonstration data kept in this browser only. */
export function FleetFooter() {
  const reset = () => {
    if (window.confirm('Reset fleet demonstration data to its original state? Any reassignments will be lost.')) resetFleetDemoData()
  }
  return (
    <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      <p className="text-xs text-muted">Demonstration data — stored in this browser only. Fields marked “Not recorded” have not been entered.</p>
      <Button variant="ghost" onClick={reset} className="h-8 whitespace-nowrap px-2"><RotateCcw size={13} strokeWidth={1.5} />Reset demo data</Button>
    </footer>
  )
}

export const NOT_RECORDED = <span className="text-muted">Not recorded</span>
