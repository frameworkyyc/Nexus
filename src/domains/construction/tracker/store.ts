import { identity } from '@/app/identity'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { createModuleStore, setModuleContext, useSaver } from '@/lib/dataSource'
import { constructionStore } from '../store'
import { buildSeed } from '../seed'
import { todayISO } from '@/lib/date'
import { notify } from '@/lib/notify'
import { emptyTracker, type TrackerState } from './types'

/**
 * Imported project data. With a server it is saved in the database (source facts and operational edits in separate tables) and
 * is the same on every device. Without one it stays in this browser, apart from the demonstration data and untouched by
 * "Reset demo data".
 */
const trackerLocal = createPersistedStore<TrackerState>({
  key: identity.storageKeys.tracker, version: 3, seed: () => identity.trackerSeed?.(buildSeed(todayISO())) ?? emptyTracker(),
  // Older versions lacked manually entered materials, history and the supplier directory. Everything a person imported or entered stays
  // exactly as it is; values not tied to project records are kept as written and flagged for reconciliation, never rewritten.
  migrate: (data) => {
    const old = { ...emptyTracker(), ...(data as Partial<TrackerState>) }
    // A browser that only ever held the empty tracker gets the demo's starting materials.
    return !old.meta && old.lines.length === 0 && old.manual.length === 0 ? (identity.trackerSeed?.(buildSeed(todayISO())) ?? old) : old
  },
})

export const trackerStore = createModuleStore<TrackerState>('materials', trackerLocal, emptyTracker, notify)
export const trackerLocalStore = trackerLocal
export const resetTrackerData = () => trackerLocal.reset()

export const useTracker = () => ({ state: trackerStore.use(), today: todayISO() })
export const useTrackerCommand = () => useSaver(trackerStore)

// Rules that span modules: a material is checked against the project's areas, foundations and anchorage types; archiving a foundation checks its materials.
setModuleContext('materials', () => ({ construction: constructionStore.get() }))
setModuleContext('construction', () => ({ materials: trackerStore.get() }))
