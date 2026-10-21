import * as raw from './actions'
import { tagModule } from '@/lib/commandTag'

/** Tagged action creators for the materials module: identical to ./actions, but each reducer remembers the call that made it. */
const tagged = tagModule('materials', raw)
export const importTracker = tagged.importTracker
export const clearTracker = tagged.clearTracker
export const addReceipt = tagged.addReceipt
export const removeReceipt = tagged.removeReceipt
export const confirmNoReceipts = tagged.confirmNoReceipts
export const setOrdered = tagged.setOrdered
export const setNotes = tagged.setNotes
export const acknowledgeFlag = tagged.acknowledgeFlag
