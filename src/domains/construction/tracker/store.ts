import { useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { todayISO } from '@/lib/date'
import type { Reducer } from './actions'
import { emptyTracker } from './types'

/**
 * Imported project data lives in its own browser-local store, apart from the fictional demonstration data, so it is never
 * mixed into demo totals and "Reset demo data" does not erase it. Browser-local means this device only: no other user sees
 * it and clearing site data removes it. Replace with a server-side store once authentication exists.
 */
export const trackerStore = createPersistedStore({ key: 'nexus.reef.materialTracker', version: 1, seed: emptyTracker })

export const useTracker = () => ({ state: trackerStore.use(), today: todayISO() })

export function useTrackerRun() {
  const toast = useToast()
  return useCallback((reducer: Reducer): string | null => {
    const result = reducer(trackerStore.get())
    if (result.error !== undefined) { toast(result.error); return result.error }
    trackerStore.set(result.state)
    return null
  }, [toast])
}
