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
export const addMaterials = tagged.addMaterials
export const editMaterial = tagged.editMaterial
export const bulkEditMaterials = tagged.bulkEditMaterials
export const archiveMaterials = tagged.archiveMaterials
export const addSupplier = tagged.addSupplier
export const renameSupplier = tagged.renameSupplier
export const archiveSupplier = tagged.archiveSupplier
export const setPreferredSupplier = tagged.setPreferredSupplier
