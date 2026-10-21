import * as raw from './actions'
import { tagModule } from '@/lib/commandTag'

/** Tagged action creators for the construction module: identical to ./actions, but each reducer remembers the call that made it. */
const tagged = tagModule('construction', raw)
export const updateActivity = tagged.updateActivity
export const setFoundationNotes = tagged.setFoundationNotes
export const setPlinthNotes = tagged.setPlinthNotes
export const linkFoundationDoc = tagged.linkFoundationDoc
export const addDocument = tagged.addDocument
export const setPlinthAnchorage = tagged.setPlinthAnchorage
export const updateAnchorageType = tagged.updateAnchorageType
export const allocate = tagged.allocate
export const returnAllocation = tagged.returnAllocation
export const setBoltsReady = tagged.setBoltsReady
export const createPurchaseOrder = tagged.createPurchaseOrder
export const addPOLine = tagged.addPOLine
export const issuePurchaseOrder = tagged.issuePurchaseOrder
export const cancelPurchaseOrder = tagged.cancelPurchaseOrder
export const setPOExpected = tagged.setPOExpected
export const receiveDelivery = tagged.receiveDelivery
export const resolveDeliveryLine = tagged.resolveDeliveryLine
export const updateFabrication = tagged.updateFabrication
export const addFabricationNote = tagged.addFabricationNote
export const setFabricationPlinths = tagged.setFabricationPlinths
export const createFabrication = tagged.createFabrication
export const addDeficiency = tagged.addDeficiency
export const setDeficiencyStatus = tagged.setDeficiencyStatus
export const setRequirementDone = tagged.setRequirementDone
export const addRequirement = tagged.addRequirement
export const renameRequirement = tagged.renameRequirement
export const removeRequirement = tagged.removeRequirement
export const setHandoverNotes = tagged.setHandoverNotes
export const submitHandover = tagged.submitHandover
export const recordAcceptance = tagged.recordAcceptance
export const reopenHandover = tagged.reopenHandover
export const orderOnNewPO = tagged.orderOnNewPO
export const setProjectStatus = tagged.setProjectStatus
export const setReportedProgress = tagged.setReportedProgress
export const addProjectIssue = tagged.addProjectIssue
export const setProjectIssueStatus = tagged.setProjectIssueStatus
export const createFoundation = tagged.createFoundation
