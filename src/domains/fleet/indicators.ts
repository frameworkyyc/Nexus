import { intervalConsumed, remainingStatus, worstStatus, type Status } from '@/components/viz/status'
import type { ISODate } from '@/lib/date'
import { activeTireSet, currentOilTarget, inspectionStatus, isOilChange, lastService, latestOdometer, latestTread, maintenanceOf, outstandingDefects, tireKm, currentServiceTarget } from './selectors'
import type { FleetState, MaintenanceRecord, ServiceTarget, TireSet } from './types'

/**
 * Pure view-models for the vehicle dashboard gauges. Every figure comes from recorded data; when a figure cannot be computed
 * it is null and the status is `unknown` (or `info` where the data is present but nothing says whether it is good or bad).
 * Nothing here defaults a lifespan, a threshold, a completion or a condition.
 */

export interface DistanceIndicator {
  status: Status
  /** Why the status is what it is, in plain words. */
  label: string
  current: number | null
  /** Odometer at which the work falls due; null = no schedule recorded. */
  dueAt: number | null
  remaining: number | null
  /** Odometer of the last completed work of the same kind, when recorded. */
  lastAt: number | null
  lastDate: ISODate | null
  /** Interval start/end used for the percentage; both must be known. */
  intervalStart: number | null
  /** Share of the interval consumed (can exceed 100 when overdue). null = not computable. */
  percent: number | null
  warnWithinKm: number | null
  schedule: ServiceTarget | undefined
  last: MaintenanceRecord | undefined
}

const fmtKm = (n: number) => `${n.toLocaleString('en-CA')} km`

function distance(label: string, current: number | null, schedule: ServiceTarget | undefined, last: MaintenanceRecord | undefined): DistanceIndicator {
  const dueAt = schedule?.odometer ?? null
  const remaining = dueAt !== null && current !== null ? dueAt - current : null
  const lastAt = last?.odometer ?? null
  const percent = intervalConsumed(lastAt, dueAt, current)
  const status = remainingStatus(remaining, schedule?.warnWithinKm ?? null)
  let text: string
  if (!schedule) text = `No ${label} recorded`
  else if (current === null) text = 'No valid odometer reading'
  else if (remaining! < 0) text = `Overdue by ${fmtKm(-remaining!)}`
  else if (status === 'warn') text = `Due soon · ${fmtKm(remaining!)} left`
  else if (status === 'ok') text = `On schedule · ${fmtKm(remaining!)} left`
  else text = `Not yet due · ${fmtKm(remaining!)} left`
  return { status, label: text, current, dueAt, remaining, lastAt, lastDate: last?.date ?? null, intervalStart: lastAt, percent, warnWithinKm: schedule?.warnWithinKm ?? null, schedule, last }
}

/**
 * Scheduled service (anything that is not an oil change). The interval start is the odometer of the last completed service of the
 * same recorded type; with no type on the target, or no such record, the start is unknown and no percentage is produced.
 */
export function serviceIndicator(state: FleetState, vehicleId: string): DistanceIndicator {
  const schedule = currentServiceTarget(state, vehicleId)
  const type = schedule?.serviceType ?? null
  const last = type ? lastService(state, vehicleId, type) : undefined
  return distance('next service', latestOdometer(state, vehicleId)?.reading ?? null, schedule, last)
}

/**
 * Oil change. Separate from scheduled service: only a target recorded as an oil change counts, so an untyped "next service" is
 * never read as one. A target at or below the odometer of the last completed oil change is already done, so the next change is
 * then "not set" rather than overdue.
 */
export function oilIndicator(state: FleetState, vehicleId: string): DistanceIndicator {
  const last = maintenanceOf(state, vehicleId).find((m) => isOilChange(m.serviceType))
  let schedule = currentOilTarget(state, vehicleId)
  if (schedule && last?.odometer != null && last.odometer >= schedule.odometer) schedule = undefined
  const out = distance('oil-change schedule', latestOdometer(state, vehicleId)?.reading ?? null, schedule, last)
  return out
}

/* ── Tires ─────────────────────────────────────────────────────────────── */

export interface TireIndicator {
  status: Status
  label: string
  set: TireSet | undefined
  km: number | null
  expectedLifeKm: number | null
  /** Share of the configured expected lifespan used; null unless both distance and a configured lifespan exist. */
  percent: number | null
  remainingKm: number | null
  treadMm: number | null
  replaceAtMm: number | null
  /** What the status rests on, so the UI can explain it. */
  basis: 'condition' | 'tread' | 'lifespan' | 'none'
}

/**
 * Tire status rests on a recorded condition, a measured tread against a recorded replacement threshold, or a configured expected
 * lifespan, in that order of authority. Distance alone, or age, never makes a set "healthy": with none of those the status is
 * unknown, and with only a lifespan it is informational until the lifespan is reached.
 */
export function tireIndicator(state: FleetState, vehicleId: string): TireIndicator {
  const set = activeTireSet(state, vehicleId)
  if (!set) return { status: 'unknown', label: 'No tire set fitted', set, km: null, expectedLifeKm: null, percent: null, remainingKm: null, treadMm: null, replaceAtMm: null, basis: 'none' }
  const km = tireKm(state, set)
  const life = set.expectedLifeKm
  const percent = km !== null && life !== null ? (km / life) * 100 : null
  const remainingKm = km !== null && life !== null ? life - km : null
  const tread = latestTread(set)
  const treadMm = tread?.depthMm ?? null
  const base = { set, km, expectedLifeKm: life, percent, remainingKm, treadMm, replaceAtMm: set.replaceAtMm }
  if (set.condition === 'replace') return { ...base, status: 'bad', label: 'Replace — recorded condition', basis: 'condition' }
  if (treadMm !== null && set.replaceAtMm !== null && treadMm <= set.replaceAtMm) return { ...base, status: 'bad', label: `Tread ${treadMm} mm at/below ${set.replaceAtMm} mm limit`, basis: 'tread' }
  if (set.condition === 'worn') return { ...base, status: 'warn', label: 'Worn — recorded condition', basis: 'condition' }
  if (remainingKm !== null && remainingKm < 0) return { ...base, status: 'bad', label: `Past expected lifespan by ${fmtKm(-remainingKm)}`, basis: 'lifespan' }
  if (set.condition === 'fair') return { ...base, status: 'warn', label: 'Fair — recorded condition', basis: 'condition' }
  if (set.condition === 'good') return { ...base, status: 'ok', label: 'Good — recorded condition', basis: 'condition' }
  if (treadMm !== null && set.replaceAtMm !== null) return { ...base, status: 'ok', label: `Tread ${treadMm} mm, above ${set.replaceAtMm} mm limit`, basis: 'tread' }
  if (remainingKm !== null) return { ...base, status: 'info', label: `${fmtKm(remainingKm)} of expected lifespan left`, basis: 'lifespan' }
  return { ...base, status: 'unknown', label: 'Condition not assessed', basis: 'none' }
}

/* ── Inspections ───────────────────────────────────────────────────────── */

export type InspectionCadence = 'current' | 'due' | 'overdue' | 'unknown'
export interface InspectionIndicator {
  cadence: InspectionCadence
  status: Status
  label: string
  daysSince: number | null
  /** Days since the last inspection as a share of the weekly interval; null when none is recorded. */
  percent: number | null
  daysUntilDue: number | null
  awaitingReview: boolean
  defects: number
  unreviewedDefects: number
}

const INTERVAL = 7

/**
 * Whether the weekly inspection is on time. This is a cadence measure, not a health measure: a submitted inspection makes the
 * cadence "current" but never marks the vehicle healthy, and an inspection nobody has reviewed is shown as awaiting review.
 */
export function inspectionIndicator(state: FleetState, vehicleId: string, today: ISODate): InspectionIndicator {
  const i = inspectionStatus(state, vehicleId, today)
  const open = outstandingDefects(state, vehicleId)
  const common = { defects: open.length, unreviewedDefects: open.filter((x) => x.inspection.review === 'submitted').length }
  if (i.daysSince === null) return { ...common, cadence: 'unknown', status: 'unknown', label: 'No inspection recorded', daysSince: null, percent: null, daysUntilDue: null, awaitingReview: false }
  const awaitingReview = i.state === 'submitted'
  const daysUntilDue = INTERVAL - i.daysSince
  const percent = (i.daysSince / INTERVAL) * 100
  const cadence: InspectionCadence = i.daysSince > INTERVAL ? 'overdue' : i.daysSince === INTERVAL ? 'due' : 'current'
  const status: Status = cadence === 'overdue' ? 'bad' : cadence === 'due' ? 'warn' : awaitingReview ? 'info' : 'ok'
  const when = cadence === 'overdue' ? `Overdue by ${i.daysSince - INTERVAL} day${i.daysSince - INTERVAL === 1 ? '' : 's'}` : cadence === 'due' ? 'Due today' : `Current · next due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`
  return { ...common, cadence, status, label: awaitingReview && cadence === 'current' ? `${when} · awaiting review` : when, daysSince: i.daysSince, percent, daysUntilDue, awaitingReview }
}

/** The single worst status across the gauges, for a vehicle-level summary. Unknown gauges keep a vehicle from reading as fully healthy. */
export const rollUp = (...statuses: Status[]): Status => worstStatus(statuses)
