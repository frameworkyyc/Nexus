import { daysBetween, type ISODate } from '@/lib/date'
import type { Accessory, AccessoryPlacement, AccessoryStatus, ConditionStatus, FleetState, InspectionRecord, MaintenanceRecord, OdometerReading, ServiceTarget, TireSet, TreadMeasurement, Vehicle, VehicleAssignment } from './types'

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
/** Oldest first; an unrecorded date sorts before every dated entry. */
const cmpDate = (a: ISODate | null, b: ISODate | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a.localeCompare(b))
const byDate = (a: { date: ISODate | null }, b: { date: ISODate | null }) => cmpDate(a.date, b.date)

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

export type ServiceState = 'not-set' | 'no-reading' | 'ok' | 'due-soon' | 'overdue'
export interface ServiceStatus {
  target: ServiceTarget | undefined
  odometer: OdometerReading | undefined
  kmRemaining: number | null
  overdue: boolean
  /** "due-soon" only when a warning window was recorded; without one, only overdue is highlighted. */
  state: ServiceState
}

/** KM remaining is only stated when both a service target and a valid current reading exist; never estimated. */
export function serviceStatus(state: FleetState, vehicleId: string): ServiceStatus {
  const target = currentServiceTarget(state, vehicleId)
  const odometer = latestOdometer(state, vehicleId)
  const kmRemaining = target && odometer ? target.odometer - odometer.reading : null
  const overdue = kmRemaining !== null && kmRemaining < 0
  const st: ServiceState = !target ? 'not-set' : kmRemaining === null ? 'no-reading' : overdue ? 'overdue' : target.warnWithinKm !== null && kmRemaining <= target.warnWithinKm ? 'due-soon' : 'ok'
  return { target, odometer, kmRemaining, overdue, state: st }
}

/* ── Maintenance records ───────────────────────────────────────────────── */

/** Newest first. A recorded future service threshold is not a maintenance record: only completed work appears here. */
export const maintenanceOf = (state: FleetState, vehicleId: string): MaintenanceRecord[] =>
  state.maintenance.map((m, n) => ({ m, n })).filter((x) => x.m.vehicleId === vehicleId).sort((a, b) => byDate(b.m, a.m) || b.n - a.n).map((x) => x.m)

const sameType = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const lastService = (state: FleetState, vehicleId: string, serviceType?: string): MaintenanceRecord | undefined =>
  maintenanceOf(state, vehicleId).find((m) => !serviceType || sameType(m.serviceType, serviceType))

/* ── Tires ─────────────────────────────────────────────────────────────── */

export const activeTireSet = (state: FleetState, vehicleId: string): TireSet | undefined => state.tireSets.find((t) => t.vehicleId === vehicleId && t.active)

/** The active set first, then replaced sets newest first (by installation odometer, then entry order). */
export function tireSetsOf(state: FleetState, vehicleId: string): TireSet[] {
  return state.tireSets.map((t, n) => ({ t, n })).filter((x) => x.t.vehicleId === vehicleId)
    .sort((a, b) => Number(b.t.active) - Number(a.t.active) || (b.t.installOdometer ?? -1) - (a.t.installOdometer ?? -1) || b.n - a.n).map((x) => x.t)
}

/**
 * Kilometres run on a set: for the active set, the latest valid vehicle odometer minus the installation odometer; for a removed
 * set, removal odometer minus installation odometer. Null when either figure is missing or the result would be negative.
 */
export function tireKm(state: FleetState, set: TireSet): number | null {
  const end = set.active ? latestOdometer(state, set.vehicleId)?.reading ?? null : set.removalOdometer
  if (end === null || set.installOdometer === null) return null
  const km = end - set.installOdometer
  return km < 0 ? null : km
}

export const latestTread = (set: TireSet): TreadMeasurement | undefined =>
  set.treads.map((t, n) => ({ t, n })).sort((a, b) => cmpDate(a.t.date, b.t.date) || a.n - b.n).map((x) => x.t).at(-1)

export const TIRE_CLASS_LABEL = { winter: 'Winter', 'all-season': 'All-season', 'all-terrain': 'All-terrain', summer: 'Summer', other: 'Other' } as const
export const TIRE_CONDITION_LABEL = { unknown: 'Not assessed', good: 'Good', fair: 'Fair', worn: 'Worn', replace: 'Replace' } as const

/* ── Accessories ───────────────────────────────────────────────────────── */

export interface AccessoryOnVehicle { accessory: Accessory; placement: AccessoryPlacement; status: AccessoryStatus }

/** Every accessory that has ever been on this vehicle, with its latest placement here. Nothing is removed from view when it moves. */
export function accessoriesOf(state: FleetState, vehicleId: string): AccessoryOnVehicle[] {
  const out: AccessoryOnVehicle[] = []
  for (const accessory of state.accessories) {
    const here = accessory.placements.filter((p) => p.vehicleId === vehicleId)
    const placement = here.at(-1)
    if (!placement) continue
    out.push({ accessory, placement, status: placement.endReason === null ? 'installed' : placement.endReason })
  }
  return out
}

export const ACCESSORY_CATEGORY_LABEL = { 'tidy-tank': 'Tidy tank', 'light-bar': 'Light bar', 'job-box': 'Job box', 'headache-rack': 'Headache rack', radio: 'Radio', other: 'Other' } as const
export const currentVehicleOf = (a: Accessory): string | null => a.placements.find((p) => p.endReason === null)?.vehicleId ?? null

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
  tires: TireSet | undefined
  tireKm: number | null
  accessories: number // currently installed
}

export function fleetRow(state: FleetState, vehicle: Vehicle, today: ISODate): FleetRow {
  const open = outstandingDefects(state, vehicle.id)
  return {
    vehicle, assignment: currentAssignment(state, vehicle.id), odometer: latestOdometer(state, vehicle.id), service: serviceStatus(state, vehicle.id),
    inspection: inspectionStatus(state, vehicle.id, today), defects: open.length, unreviewedDefects: open.filter((x) => x.inspection.review === 'submitted').length,
    flaggedReadings: readingsNeedingReview(state, vehicle.id).length, condition: conditionOf(state, vehicle.id),
    tires: activeTireSet(state, vehicle.id), tireKm: (() => { const t = activeTireSet(state, vehicle.id); return t ? tireKm(state, t) : null })(),
    accessories: accessoriesOf(state, vehicle.id).filter((x) => x.status === 'installed').length,
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
  for (const m of state.maintenance.filter((x) => x.vehicleId === vehicleId)) events.push({ id: m.id, date: m.date, text: `${m.serviceType}${m.description ? `: ${m.description}` : ''}${m.odometer !== null ? ` at ${m.odometer.toLocaleString('en-CA')} km` : ''}` })
  for (const t of state.serviceTargets.filter((x) => x.vehicleId === vehicleId)) events.push({ id: t.id, date: t.setDate, text: `Next ${t.serviceType ? t.serviceType.toLowerCase() : 'service'} set for ${t.odometer.toLocaleString('en-CA')} km` })
  for (const t of state.tireSets.filter((x) => x.vehicleId === vehicleId)) {
    const name = `${t.manufacturer} ${t.model}`.trim()
    events.push({ id: `${t.id}:in`, date: t.installDate, text: `Tires installed: ${name}${t.origin ? ` (${t.origin.toLowerCase()})` : ''}${t.installOdometer !== null ? ` at ${t.installOdometer.toLocaleString('en-CA')} km` : ''}` })
    if (!t.active) events.push({ id: `${t.id}:out`, date: t.removalDate, text: `Tires removed: ${name}${t.removalOdometer !== null ? ` at ${t.removalOdometer.toLocaleString('en-CA')} km` : ''}` })
    t.treads.forEach((m) => events.push({ id: m.id, date: m.date, text: `Tread measured on ${name}: ${m.depthMm} mm` }))
  }
  for (const a of state.accessories) a.placements.forEach((p, i) => {
    if (p.vehicleId !== vehicleId) return
    events.push({ id: `${a.id}:${i}:in`, date: p.installDate, text: `${a.name} installed` })
    if (p.endReason) events.push({ id: `${a.id}:${i}:out`, date: p.endDate, text: p.endReason === 'transferred' ? `${a.name} transferred to another vehicle` : `${a.name} removed` })
  })
  // Dated events newest first (ties broken by creation order, newest first); undated events last.
  return events
    .map((e, n) => ({ e, n }))
    .sort((a, b) => (a.e.date && b.e.date ? b.e.date.localeCompare(a.e.date) || b.n - a.n : a.e.date ? -1 : b.e.date ? 1 : b.n - a.n))
    .map((x) => x.e)
}
