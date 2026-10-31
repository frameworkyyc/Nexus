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
export const createPurchaseOrder = tagged.createPurchaseOrder
export const setPurchaseOrderNumber = tagged.setPurchaseOrderNumber
export const setPurchaseOrderSupplier = tagged.setPurchaseOrderSupplier
export const setPurchaseOrderName = tagged.setPurchaseOrderName
export const editPurchaseOrder = tagged.editPurchaseOrder
export const deletePurchaseOrder = tagged.deletePurchaseOrder
export const addOrderLines = tagged.addOrderLines
export const cancelPurchaseOrder = tagged.cancelPurchaseOrder
export const recordDelivery = tagged.recordDelivery
export const voidDelivery = tagged.voidDelivery
export const setAllocations = tagged.setAllocations
export const recordInstallation = tagged.recordInstallation
export const voidInstallation = tagged.voidInstallation
export const addSupplier = tagged.addSupplier
export const renameSupplier = tagged.renameSupplier
export const archiveSupplier = tagged.archiveSupplier
export const setPreferredSupplier = tagged.setPreferredSupplier
