import { identity } from '@/app/identity'
import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/Toast'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { createEphemeralStore, createPersistedStore } from '@/lib/createPersistedStore'
import { createModuleStore, getBackend, useSaver } from '@/lib/dataSource'
import { notify } from '@/lib/notify'
import { todayISO } from '@/lib/date'
import type { Reducer } from './actions'
import { emptyConstruction } from './empty'
import { buildPortfolio, buildSeed, REEF_PROJECT } from './seed'
import type { ConstructionState } from './types'
import { getIndex } from './selectors'

/** v1 → v2: keep every saved edit, add project status fields and the summary-tracked portfolio. */
export function migrateConstruction(data: unknown, from: number): ConstructionState {
  const old = data as ConstructionState
  if (from >= 2) return old
  const today = todayISO()
  const portfolio = buildPortfolio(today)
  return {
    ...old,
    projects: [...old.projects.map((p) => ({ ...REEF_PROJECT, ...p })), ...portfolio.projects],
    projectIssues: portfolio.issues,
  }
}

/**
 * Construction records. In saved-data mode they come from the server: the real REEF project and areas, plus the foundations
 * and activity records people have entered (nothing demonstrative). In demonstration mode they are the fictional seed, in this browser.
 */
const constructionLocal = IS_PUBLIC_DEMO
  ? createPersistedStore({ key: identity.storageKeys.construction, version: 2, seed: () => buildSeed(todayISO()), migrate: migrateConstruction })
  : createEphemeralStore(emptyConstruction) // the application keeps no operational records in the browser

export const constructionStore = createModuleStore<ConstructionState>('construction', constructionLocal, emptyConstruction, notify)

export function useConstruction() {
  const state = constructionStore.use()
  const idx = useMemo(() => getIndex(state), [state])
  return { state, idx, today: todayISO() }
}

/** Saving hook for records that are persisted on the server: `run(reducer, onDone)` plus a `saving` flag. */
export const useConstructionCommand = () => useSaver(constructionStore)

/**
 * Synchronous runner for the demonstration-only screens (procurement, fabrication, handover, documents). Those actions have no
 * saved records, so in saved-data mode they are refused with a message instead of silently changing nothing.
 */
export function useRun() {
  const toast = useToast()
  return useCallback(
    (reducer: Reducer): string | null => {
      if (getBackend().mode === 'server') {
        const msg = 'This part of Nexus is not available with saved project data yet.'
        toast(msg)
        return msg
      }
      const result = reducer(constructionLocal.get())
      if (result.error !== undefined) {
        toast(result.error)
        return result.error
      }
      constructionLocal.set(result.state)
      return null
    },
    [toast],
  )
}

export const resetDemoData = () => constructionLocal.reset()
export const constructionLocalStore = constructionLocal
