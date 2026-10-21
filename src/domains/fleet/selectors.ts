import type { ISODate } from '@/lib/date'
import type { ConditionStatus, FleetState, Vehicle, VehicleAssignment } from './types'

export const CONDITION_LABEL: Record<ConditionStatus, string> = {
  'not-assessed': 'Not assessed',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  'out-of-service': 'Out of service',
}

export const vehicleTitle = (v: Vehicle) => `${v.year} ${v.make} ${v.model}`

export function currentAssignment(state: FleetState, vehicleId: string): VehicleAssignment | undefined {
  return state.assignments.find((a) => a.vehicleId === vehicleId && a.endDate === null)
}

/**
 * Condition comes only from recorded information: the most recent inspection, or maintenance outcome, that states one.
 * With no such record the vehicle is explicitly "Not assessed".
 */
export function conditionOf(state: FleetState, vehicleId: string): ConditionStatus {
  const rated: { date: ISODate; condition: ConditionStatus }[] = [
    ...state.inspections.filter((i) => i.vehicleId === vehicleId).map((i) => ({ date: i.date, condition: i.condition as ConditionStatus })),
    ...state.maintenance.filter((m) => m.vehicleId === vehicleId && m.condition).map((m) => ({ date: m.date, condition: m.condition as ConditionStatus })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  return rated[0]?.condition ?? 'not-assessed'
}

export function latestOdometer(state: FleetState, vehicleId: string) {
  return state.odometer.filter((o) => o.vehicleId === vehicleId).sort((a, b) => b.date.localeCompare(a.date))[0]
}

export interface FleetCounts {
  vehicles: number
  assigned: number
  unassigned: number
  projects: number // distinct projects with at least one vehicle
}

export function fleetCounts(state: FleetState): FleetCounts {
  const current = state.vehicles.map((v) => currentAssignment(state, v.id))
  const assigned = current.filter(Boolean) as VehicleAssignment[]
  return { vehicles: state.vehicles.length, assigned: assigned.length, unassigned: state.vehicles.length - assigned.length, projects: new Set(assigned.map((a) => a.projectId)).size }
}

export interface HistoryEvent {
  id: string
  date: ISODate | null // null = not recorded
  text: string
}

/** History is derived from recorded records only; an undated seed assignment is shown as "date not recorded". */
export function historyOf(state: FleetState, vehicleId: string, projectName: (id: string) => string): HistoryEvent[] {
  const events: HistoryEvent[] = []
  for (const a of state.assignments.filter((x) => x.vehicleId === vehicleId)) {
    events.push({ id: `${a.id}:start`, date: a.startDate, text: `Assigned to ${projectName(a.projectId)}` })
    if (a.endDate) events.push({ id: `${a.id}:end`, date: a.endDate, text: `Removed from ${projectName(a.projectId)}` })
  }
  for (const i of state.inspections.filter((x) => x.vehicleId === vehicleId)) events.push({ id: i.id, date: i.date, text: `Inspection recorded: ${CONDITION_LABEL[i.condition]}` })
  for (const m of state.maintenance.filter((x) => x.vehicleId === vehicleId)) events.push({ id: m.id, date: m.date, text: `Maintenance: ${m.description}` })
  // Dated events newest first (ties broken by creation order, newest first); undated events last.
  return events
    .map((e, n) => ({ e, n }))
    .sort((a, b) => (a.e.date && b.e.date ? b.e.date.localeCompare(a.e.date) || b.n - a.n : a.e.date ? -1 : b.e.date ? 1 : b.n - a.n))
    .map((x) => x.e)
}
