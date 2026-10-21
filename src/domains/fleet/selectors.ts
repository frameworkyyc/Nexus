import { daysBetween, type ISODate } from '@/lib/date'
import type { ConditionStatus, FleetState, InspectionRecord, OdometerReading, ServiceTarget, Vehicle, VehicleAssignment } from './types'

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
    ...state.inspections.filter((i) => i.vehicleId === vehicleId && i.review === 'reviewed' && i.condition).map((i) => ({ date: i.date, condition: i.condition as ConditionStatus })),
    ...state.maintenance.filter((m) => m.vehicleId === vehicleId && m.condition).map((m) => ({ date: m.date, condition: m.condition as ConditionStatus })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  return rated[0]?.condition ?? 'not-assessed'
}

/* ── Odometer ──────────────────────────────────────────────────────────── */

export const countsAsCurrent = (r: OdometerReading) => r.review === 'valid' || r.review === 'accepted'
const byDate = (a: { date: ISODate }, b: { date: ISODate }) => a.date.localeCompare(b.date)

/** Readings in the order they happened (date, then the order they were entered). */
export function odometerHistory(state: FleetState, vehicleId: string): OdometerReading[] {
  return state.odometer.map((r, n) => ({ r, n })).filter((x) => x.r.vehicleId === vehicleId).sort((a, b) => byDate(a.r, b.r) || a.n - b.n).map((x) => x.r)
}

/** The latest reading that has not been held back for review; this is the vehicle's current mileage. */
export function latestOdometer(state: FleetState, vehicleId: string): OdometerReading | undefined {
  return odometerHistory(state, vehicleId).filter(countsAsCurrent).at(-1)
}

export const readingsNeedingReview = (state: FleetState, vehicleId?: string) => state.odometer.filter((r) => r.review === 'needs-review' && (!vehicleId || r.vehicleId === vehicleId))

/* ── Service ───────────────────────────────────────────────────────────── */

export const currentServiceTarget = (state: FleetState, vehicleId: string): ServiceTarget | undefined => state.serviceTargets.filter((t) => t.vehicleId === vehicleId).at(-1)

export interface ServiceStatus { target: ServiceTarget | undefined; odometer: OdometerReading | undefined; kmRemaining: number | null; overdue: boolean }

/** KM remaining is only stated when both a service target and a valid current reading exist; never estimated. */
export function serviceStatus(state: FleetState, vehicleId: string): ServiceStatus {
  const target = currentServiceTarget(state, vehicleId)
  const odometer = latestOdometer(state, vehicleId)
  const kmRemaining = target && odometer ? target.odometer - odometer.reading : null
  return { target, odometer, kmRemaining, overdue: kmRemaining !== null && kmRemaining < 0 }
}

/* ── Inspections and defects ───────────────────────────────────────────── */

export const INSPECTION_INTERVAL_DAYS = 7

export const inspectionsOf = (state: FleetState, vehicleId: string): InspectionRecord[] =>
  state.inspections.map((i, n) => ({ i, n })).filter((x) => x.i.vehicleId === vehicleId).sort((a, b) => byDate(b.i, a.i) || b.n - a.n).map((x) => x.i)

export interface InspectionStatus { last: InspectionRecord | undefined; state: 'none' | 'submitted' | 'reviewed'; daysSince: number | null; overdue: boolean }

/** Latest weekly submission, and whether the next one is overdue. A submission alone never implies a sound vehicle. */
export function inspectionStatus(state: FleetState, vehicleId: string, today: ISODate): InspectionStatus {
  const last = inspectionsOf(state, vehicleId)[0]
  if (!last) return { last, state: 'none', daysSince: null, overdue: false }
  const daysSince = daysBetween(last.date, today)
  return { last, state: last.review, daysSince, overdue: daysSince > INSPECTION_INTERVAL_DAYS }
}

export const outstandingDefects = (state: FleetState, vehicleId: string) =>
  inspectionsOf(state, vehicleId).flatMap((i) => i.defects.filter((d) => d.status === 'outstanding').map((d) => ({ inspection: i, defect: d })))

/* ── One row of fleet information, shared by the organization and project views ── */

export interface FleetRow {
  vehicle: Vehicle
  assignment: VehicleAssignment | undefined
  odometer: OdometerReading | undefined
  service: ServiceStatus
  inspection: InspectionStatus
  defects: number
  unreviewedDefects: number // outstanding defects on inspections nobody has reviewed yet
  flaggedReadings: number
  condition: ConditionStatus
}

export function fleetRow(state: FleetState, vehicle: Vehicle, today: ISODate): FleetRow {
  const open = outstandingDefects(state, vehicle.id)
  return {
    vehicle, assignment: currentAssignment(state, vehicle.id), odometer: latestOdometer(state, vehicle.id), service: serviceStatus(state, vehicle.id),
    inspection: inspectionStatus(state, vehicle.id, today), defects: open.length, unreviewedDefects: open.filter((x) => x.inspection.review === 'submitted').length,
    flaggedReadings: readingsNeedingReview(state, vehicle.id).length, condition: conditionOf(state, vehicle.id),
  }
}

/** The same vehicle records, filtered to those currently assigned to one project. */
export const vehiclesForProject = (state: FleetState, projectId: string) => state.vehicles.filter((v) => currentAssignment(state, v.id)?.projectId === projectId)

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
  for (const i of state.inspections.filter((x) => x.vehicleId === vehicleId)) events.push({ id: i.id, date: i.date, text: `Inspection submitted${i.defects.length ? ` (${i.defects.length} defect${i.defects.length === 1 ? '' : 's'} noted)` : ''}${i.review === 'reviewed' ? ', reviewed' : ', awaiting review'}` })
  for (const r of state.odometer.filter((x) => x.vehicleId === vehicleId)) events.push({ id: r.id, date: r.date, text: `Odometer ${r.reading.toLocaleString('en-CA')} ${r.unit}${r.review === 'needs-review' ? ' (held for review)' : r.review === 'rejected' ? ' (rejected)' : ''}` })
  for (const m of state.maintenance.filter((x) => x.vehicleId === vehicleId)) events.push({ id: m.id, date: m.date, text: `Maintenance: ${m.description}` })
  // Dated events newest first (ties broken by creation order, newest first); undated events last.
  return events
    .map((e, n) => ({ e, n }))
    .sort((a, b) => (a.e.date && b.e.date ? b.e.date.localeCompare(a.e.date) || b.n - a.n : a.e.date ? -1 : b.e.date ? 1 : b.n - a.n))
    .map((x) => x.e)
}
