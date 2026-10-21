import { useCallback, useMemo } from 'react'
import { useToast } from '@/components/ui/Toast'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { todayISO } from '@/lib/date'
import { useConstruction } from '@/domains/construction/store'
import { DEMO_ACTOR } from './access'
import type { Reducer } from './actions'
import { buildFleetSeed } from './seed'
import type { FleetState, InspectionRecord, OdometerReading, RatedCondition } from './types'

/** v1 → v2: readings gain a review state, inspections gain submission/review fields, and service targets appear. Nothing is dropped. */
export function migrateFleet(data: unknown, from: number): FleetState {
  const d = data as Partial<FleetState> & { odometer?: Partial<OdometerReading>[]; inspections?: (Partial<InspectionRecord> & { condition?: RatedCondition })[] }
  if (from >= 2) return data as FleetState
  return {
    vehicles: d.vehicles ?? [], assignments: d.assignments ?? [], maintenance: d.maintenance ?? [], serviceTargets: [],
    odometer: (d.odometer ?? []).map((r) => ({ id: r.id!, vehicleId: r.vehicleId!, date: r.date!, reading: r.reading!, unit: r.unit ?? 'km', review: 'valid', flag: null, correctsId: null, note: '', reviewNote: '', reviewedDate: null })),
    inspections: (d.inspections ?? []).map((i) => ({ id: i.id!, vehicleId: i.vehicleId!, date: i.date!, submittedBy: '', notes: i.notes ?? '', defects: [], review: 'reviewed', reviewedBy: '', reviewedDate: i.date ?? null, reviewNote: '', condition: i.condition ?? null })),
  }
}

/** Demonstration persistence: browser-local only, like the construction pack. Swap for an API later. */
export const fleetStore = createPersistedStore({
  key: 'nexus.demo.fleet',
  version: 2,
  seed: buildFleetSeed,
  migrate: migrateFleet,
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

/** The acting user. Placeholder until authentication exists: everyone is the demo fleet manager and nothing is enforced. */
export const useFleetActor = () => DEMO_ACTOR
