import { afterAll, beforeAll } from 'vitest'
import * as tracker from '@/domains/construction/tracker/actions'
import { SERVER_COMMANDS } from '@/shared/registry'

/**
 * `addReceipt` and `setOrdered` are retired as server commands (deliveries now need a purchase order). Many persistence, permission and
 * history tests still need receipts and ordered quantities of the kind that exist in historical data, so a test file that calls this swaps the
 * original reducers back in for its own run (each test file has its own module registry) and restores the retired ones afterwards.
 */
export function installLegacyReceiptCommands() {
  const m = SERVER_COMMANDS.materials as Record<string, unknown>
  const saved = { addReceipt: m.addReceipt, setOrdered: m.setOrdered }
  beforeAll(() => { m.addReceipt = tracker.legacyAddReceipt; m.setOrdered = tracker.legacySetOrdered })
  afterAll(() => { m.addReceipt = saved.addReceipt; m.setOrdered = saved.setOrdered })
}
