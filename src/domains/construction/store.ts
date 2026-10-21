import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/Toast'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { todayISO } from '@/lib/date'
import type { Reducer } from './actions'
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

export const constructionStore = createPersistedStore({
  key: 'nexus.demo.construction',
  version: 2,
  seed: () => buildSeed(todayISO()),
  migrate: migrateConstruction,
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
