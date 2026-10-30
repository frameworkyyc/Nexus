import * as raw from './actions'
import { tagModule } from '@/lib/commandTag'

/** Tagged action creators for the fleet module: identical to ./actions, but each reducer remembers the call that made it. */
const tagged = tagModule('fleet', raw)
export const reassignVehicle = tagged.reassignVehicle
export const recordOdometer = tagged.recordOdometer
export const reviewOdometer = tagged.reviewOdometer
export const setServiceTarget = tagged.setServiceTarget
export const recordMaintenance = tagged.recordMaintenance
export const updateVehicle = tagged.updateVehicle
export const addTireSet = tagged.addTireSet
export const replaceTireSet = tagged.replaceTireSet
export const removeTireSet = tagged.removeTireSet
export const updateTireSet = tagged.updateTireSet
export const addTreadMeasurement = tagged.addTreadMeasurement
export const setTireCondition = tagged.setTireCondition
export const addAccessoryType = tagged.addAccessoryType
export const renameAccessoryType = tagged.renameAccessoryType
export const setAccessoryTypeArchived = tagged.setAccessoryTypeArchived
export const addAccessory = tagged.addAccessory
export const updateAccessory = tagged.updateAccessory
export const updateInstallation = tagged.updateInstallation
export const removeAccessory = tagged.removeAccessory
export const installAccessory = tagged.installAccessory
export const transferAccessory = tagged.transferAccessory
export const submitInspection = tagged.submitInspection
export const reviewInspection = tagged.reviewInspection
export const removeDemoInspections = tagged.removeDemoInspections
export const setVehiclePlanning = tagged.setVehiclePlanning
export const addDefect = tagged.addDefect
export const resolveDefect = tagged.resolveDefect
export const reopenDefect = tagged.reopenDefect
export const addVehicle = tagged.addVehicle
export const addFleetCategory = tagged.addFleetCategory
export const updateFleetCategory = tagged.updateFleetCategory
export const setFleetCategoryArchived = tagged.setFleetCategoryArchived
export const setVehicleCategory = tagged.setVehicleCategory
export const setVehicleMeterUnit = tagged.setVehicleMeterUnit
