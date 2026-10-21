import { useMemo } from 'react'
import { createPersistedStore } from '@/lib/createPersistedStore'
import { createModuleStore, useSaver } from '@/lib/dataSource'
import { notify } from '@/lib/notify'
import { todayISO } from '@/lib/date'
import { useConstruction } from '@/domains/construction/store'
import { DEMO_ACTOR } from './access'
import { applyVerifiedT6010, buildFleetSeed } from './seed'
import type { FleetState, InspectionRecord, OdometerReading, RatedCondition } from './types'

/**
 * Upgrades saved data without losing records. v1 → v2: readings gain a review state, inspections gain submission/review
 * fields, service targets appear. v2 → v3: dates may be unrecorded, maintenance gains a type and odometer, service targets gain
 * a type and warning window, tire sets and accessories appear, and T6010's verified information is added where still empty.
 */
export function migrateFleet(data: unknown, from: number): FleetState {
  const d = data as Partial<FleetState> & { odometer?: Partial<OdometerReading>[]; inspections?: (Partial<InspectionRecord> & { condition?: RatedCondition })[] }
  let s: FleetState
  if (from >= 2) s = data as FleetState
  else s = {
    vehicles: d.vehicles ?? [], assignments: d.assignments ?? [], maintenance: d.maintenance ?? [], serviceTargets: [], tireSets: [], accessories: [],
    odometer: (d.odometer ?? []).map((r) => ({ id: r.id!, vehicleId: r.vehicleId!, date: r.date!, reading: r.reading!, unit: r.unit ?? 'km', review: 'valid', flag: null, correctsId: null, note: '', reviewNote: '', reviewedDate: null })),
    inspections: (d.inspections ?? []).map((i) => ({ id: i.id!, vehicleId: i.vehicleId!, date: i.date!, submittedBy: '', notes: i.notes ?? '', defects: [], review: 'reviewed', reviewedBy: '', reviewedDate: i.date ?? null, reviewNote: '', condition: i.condition ?? null })),
  }
  if (from < 3) {
    s = {
      ...s, tireSets: s.tireSets ?? [], accessories: s.accessories ?? [],
      serviceTargets: (s.serviceTargets ?? []).map((t) => ({ ...t, serviceType: t.serviceType ?? null, warnWithinKm: t.warnWithinKm ?? null })),
      maintenance: (s.maintenance ?? []).map((m) => ({ ...m, serviceType: m.serviceType ?? 'Other', odometer: m.odometer ?? null })),
    }
    s = applyVerifiedT6010(s)
  }
  return s
}

/**
 * Fleet records. With a server (saved-data mode) they live in the database and every change is confirmed by the server before
 * it is shown as saved. Without one (demonstration mode, local development) they stay in this browser, as before.
 */
const fleetLocal = createPersistedStore({
  key: 'nexus.demo.fleet',
  version: 3,
  seed: buildFleetSeed,
  migrate: migrateFleet,
})

const emptyFleet = (): FleetState => ({ vehicles: [], assignments: [], odometer: [], serviceTargets: [], inspections: [], maintenance: [], tireSets: [], accessories: [] })

export const fleetStore = createModuleStore<FleetState>('fleet', fleetLocal, emptyFleet, notify)
/** The browser-held copy: read for backups and migration, never written in saved-data mode. */
export const fleetLocalStore = fleetLocal

export function useFleet() {
  return { state: fleetStore.use(), today: todayISO() }
}

/** For forms and buttons: `run(reducer, onDone)` with a `saving` flag; `onDone` fires only once the change is confirmed. */
export const useFleetCommand = () => useSaver(fleetStore)

export const resetFleetDemoData = () => fleetLocal.reset()

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
