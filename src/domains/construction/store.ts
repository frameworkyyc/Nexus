import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/Toast'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { todayISO } from '@/lib/date'
import type { Reducer } from './actions'
import { buildSeed } from './seed'
import { getIndex } from './selectors'

export const constructionStore = createPersistedStore({
  key: 'nexus.demo.construction',
  version: 1,
  seed: () => buildSeed(todayISO()),
})

export function useConstruction() {
  const state = constructionStore.use()
  const idx = useMemo(() => getIndex(state), [state])
  return { state, idx, today: todayISO() }
}

/** Applies a reducer to the latest state. Returns the error message (also toasted) or null on success. */
export function useRun() {
  const toast = useToast()
  return useCallback(
    (reducer: Reducer): string | null => {
      const result = reducer(constructionStore.get())
      if (result.error !== undefined) {
        toast(result.error)
        return result.error
      }
      constructionStore.set(result.state)
      return null
    },
    [toast],
  )
}

export const resetDemoData = () => constructionStore.reset()
