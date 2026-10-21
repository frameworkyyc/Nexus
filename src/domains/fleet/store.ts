import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/Toast'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { todayISO } from '@/lib/date'
import { useConstruction } from '@/domains/construction/store'
import type { Reducer } from './actions'
import { buildFleetSeed } from './seed'

/** Demonstration persistence: browser-local only, like the construction pack. Swap for an API later. */
export const fleetStore = createPersistedStore({
  key: 'nexus.demo.fleet',
  version: 1,
  seed: buildFleetSeed,
})

export function useFleet() {
  return { state: fleetStore.use(), today: todayISO() }
}

export function useFleetRun() {
  const toast = useToast()
  return useCallback(
    (reducer: Reducer): string | null => {
      const result = reducer(fleetStore.get())
      if (result.error !== undefined) {
        toast(result.error)
        return result.error
      }
      fleetStore.set(result.state)
      return null
    },
    [toast],
  )
}

export const resetFleetDemoData = () => fleetStore.reset()

/**
 * The single place Fleet reads the organization's project registry. Fleet stores only project ids;
 * this adapter resolves names, and is the one thing to replace when projects move to their own service.
 */
export function useProjectRegistry() {
  const { state } = useConstruction()
  return useMemo(() => {
    const list = state.projects.map((p) => ({ id: p.id, name: p.name, jobNumber: p.jobNumber }))
    const byId = new Map(list.map((p) => [p.id, p]))
    return { projects: list, name: (id: string) => byId.get(id)?.name ?? id, get: (id: string) => byId.get(id) }
  }, [state.projects])
}
