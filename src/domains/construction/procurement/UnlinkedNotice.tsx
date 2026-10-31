import type { ReactNode } from 'react'
import { unlinkedDeliveries } from '../tracker/procurement'
import type { TrackerState } from '../tracker/types'
import { fmt } from './Dialogs'

/**
 * Says so when deliveries exist that belong to no order. They are real receipts and count as delivered everywhere, but deleting or cancelling an
 * order does not touch them: this is why a material can read Delivered when nothing is on order. Shown wherever those figures appear.
 */
export function UnlinkedNotice({ state, areaIds, action }: { state: TrackerState; areaIds?: Set<string>; action?: ReactNode }) {
  const u = unlinkedDeliveries(state, areaIds)
  if (u.count === 0) return null
  return (
    <p role="status" data-testid="unlinked-deliveries" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-line pl-3 text-[13px]">
      <span>{u.count} deliver{u.count === 1 ? 'y' : 'ies'} ({fmt(u.items)} items) {u.count === 1 ? 'was' : 'were'} recorded without an order. {u.count === 1 ? 'It counts' : 'They count'} as delivered here, in Materials and in the Area Overview, and {u.count === 1 ? 'is' : 'are'} not removed when an order is deleted. Attach {u.count === 1 ? 'it' : 'them'} to an order, or void {u.count === 1 ? 'it' : 'any'} recorded by mistake, under Orders.</span>
      {action}
    </p>
  )
}
