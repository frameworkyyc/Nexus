import { identity } from '@/app/identity'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { createModuleStore, useSaver } from '@/lib/dataSource'
import { todayISO } from '@/lib/date'
import { notify } from '@/lib/notify'
import { emptyTracker, type TrackerState } from './types'

/**
 * Imported project data. With a server it is saved in the database (source facts and operational edits in separate tables) and
 * is the same on every device. Without one it stays in this browser, apart from the demonstration data and untouched by
 * "Reset demo data".
 */
const trackerLocal = createPersistedStore({ key: identity.storageKeys.tracker, version: 1, seed: emptyTracker })

export const trackerStore = createModuleStore<TrackerState>('materials', trackerLocal, emptyTracker, notify)
export const trackerLocalStore = trackerLocal
export const resetTrackerData = () => trackerLocal.reset()

export const useTracker = () => ({ state: trackerStore.use(), today: todayISO() })
export const useTrackerCommand = () => useSaver(trackerStore)
