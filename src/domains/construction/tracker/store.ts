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
const trackerLocal = createPersistedStore<TrackerState>({
  key: identity.storageKeys.tracker, version: 2, seed: () => identity.trackerSeed?.() ?? emptyTracker(),
  // Version 1 had no manually entered materials or history; the imported workbook, receipts and notes are kept as they are.
  migrate: (data) => {
    const old = { ...emptyTracker(), ...(data as Partial<TrackerState>) }
    // A browser that only ever held the empty tracker gets the demo's starting materials; anything a person entered or imported stays.
    return !old.meta && old.lines.length === 0 && old.manual.length === 0 ? (identity.trackerSeed?.() ?? old) : old
  },
})

export const trackerStore = createModuleStore<TrackerState>('materials', trackerLocal, emptyTracker, notify)
export const trackerLocalStore = trackerLocal
export const resetTrackerData = () => trackerLocal.reset()

export const useTracker = () => ({ state: trackerStore.use(), today: todayISO() })
export const useTrackerCommand = () => useSaver(trackerStore)
