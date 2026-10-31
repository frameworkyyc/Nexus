import { identity } from '@/app/identity'
import { useMemo } from 'react'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { createEphemeralStore, createPersistedStore } from '@/lib/createPersistedStore'
import { createModuleStore, setModuleContext, useSaver } from '@/lib/dataSource'
import { constructionStore, registerMaterialsRecords } from '../store'
import { buildSeed } from '../seed'
import { todayISO } from '@/lib/date'
import { notify } from '@/lib/notify'
import { refreshRequirements } from './requirements'
import { emptyTracker, type TrackerState } from './types'

/**
 * Imported project data. With a server it is saved in the database (source facts and operational edits in separate tables) and
 * is the same on every device. Without one it stays in this browser, apart from the demonstration data and untouched by
 * "Reset demo data".
 */
const trackerLocal = !IS_PUBLIC_DEMO ? createEphemeralStore(emptyTracker) : createPersistedStore<TrackerState>({
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

/**
 * The materials as everyone sees them: the saved records with calculated requirements and per-anchorage / plinth / footing quantities brought
 * up to date with the foundations and the Anchorage Library. This view is for display; the saved records are brought up to date, and the
 * change logged, by the next change made to a material.
 */
export function useTracker() {
  const raw = trackerStore.use()
  const construction = constructionStore.use()
  const state = useMemo(() => refreshRequirements(raw, construction, { log: false }), [raw, construction])
  return { state, today: todayISO() }
}
export const useTrackerCommand = () => useSaver(trackerStore)

// Construction views (foundation pages, activity statuses, the area overview) read their material figures from these same records.
registerMaterialsRecords(() => useTracker().state)

// Rules that span modules: a material is checked against the project's areas, foundations and anchorage types; archiving a foundation checks its materials.
setModuleContext('materials', () => ({ construction: constructionStore.get() }))
setModuleContext('construction', () => ({ materials: trackerStore.get() }))
