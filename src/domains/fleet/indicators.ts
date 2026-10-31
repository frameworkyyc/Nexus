import { remainingStatus, type Status } from '@/components/viz/status'
import type { ISODate } from '@/lib/date'
import { activeTireSet, currentOilTarget, currentServiceTarget, inspectionStatus, isOilChange, lastService, latestOdometer, latestTread, maintenanceOf, outstandingDefects, tireKm } from './selectors'
import { fmtMeter, lifespanOf, meterUnitOf } from './meter'
import type { FleetState, MaintenanceRecord, MeterUnit, ServiceTarget, TireSet } from './types'

/**
 * Pure view-models for the vehicle dashboard gauges. Every figure comes from recorded or configured data; when a figure cannot be
 * computed it is null and the status is `unknown` (or `info` where the data is present but nothing says whether it is good or bad).
 * Nothing here defaults a lifespan, an interval, a threshold, a completion or a condition.
 */

/** One decimal, the precision every percentage in the dashboard is shown at. */
export const pct1 = (n: number) => Math.round(n * 10) / 10

/** Remaining and consumed shares of a total, clamped to 0–100 so a gauge never over- or under-fills when the estimate is exceeded. */
export function lifeShares(used: number | null, total: number | null): { remainingPercent: number | null; consumedPercent: number | null; remaining: number | null } {
  if (used === null || total === null || !(total > 0) || used < 0) return { remainingPercent: null, consumedPercent: null, remaining: null }
  const consumed = Math.min(100, Math.max(0, (used / total) * 100))
  return { remainingPercent: 100 - consumed, consumedPercent: consumed, remaining: total - used }
}

/* ── Vehicle lifespan ──────────────────────────────────────────────────── */

export interface LifeIndicator {
  /** Where the estimate comes from: the asset itself, its category default, or nowhere. */
  source: 'asset' | 'category' | 'none'
  categoryName: string | null
  unit: MeterUnit
  status: Status
  label: string
  current: number | null
  expectedKm: number | null
  remainingKm: number | null
  /** Share of the estimated lifespan left / used, clamped to 0–100. null = cannot be computed. */
  remainingPercent: number | null
  consumedPercent: number | null
}

/**
 * Vehicle lifespan is a planning estimate, not a statement of mechanical condition. It is green while inside the estimate; going past
 * it is flagged for planning (orange) and never marks the vehicle unsafe, unserviceable or in poor condition.
 */
export function lifespanIndicator(state: FleetState, vehicleId: string): LifeIndicator {
  const vehicle = state.vehicles.find((v) => v.id === vehicleId)
  const life = vehicle ? lifespanOf(state, vehicle) : null
  const expectedKm = life?.value ?? null
  const unit = life?.unit ?? 'km'
  const fmtKm = (n: number) => fmtMeter(n, unit)
  const current = latestOdometer(state, vehicleId)?.reading ?? null
  const { remainingPercent, consumedPercent, remaining } = lifeShares(current, expectedKm)
  const base = { source: life?.source ?? 'none', categoryName: life?.category?.name ?? null, unit } as const
  if (expectedKm === null) return { ...base, status: 'unknown', label: 'No lifespan estimate set', current, expectedKm, remainingKm: null, remainingPercent: null, consumedPercent: null }
  if (remaining === null) return { ...base, status: 'unknown', label: 'No valid odometer reading', current, expectedKm, remainingKm: null, remainingPercent: null, consumedPercent: null }
  const within = remaining >= 0
  return { ...base, status: within ? 'ok' : 'warn', label: within ? 'Within estimated lifespan' : `Beyond estimate by ${fmtKm(-remaining)}`, current, expectedKm, remainingKm: remaining, remainingPercent, consumedPercent }
}

/* ── Scheduled maintenance (oil change and other services) ─────────────── */

export interface DistanceIndicator {
  unit: MeterUnit
  status: Status
  label: string
  current: number | null
  /** Odometer at which the work falls due; null = no schedule recorded. */
  dueAt: number | null
  remaining: number | null
  /** Odometer of the last completed work of the same kind, when recorded. */
  lastAt: number | null
  lastDate: ISODate | null
  /** Start of the current interval, and whether it was calculated (due − interval) rather than taken from a completed record. */
  intervalStart: number | null
  baselineCalculated: boolean
  intervalKm: number | null
  /** Share of the interval left / used (left is clamped to 0–100). null unless both ends of the interval are known. */
  remainingPercent: number | null
  consumedPercent: number | null
  warnWithinKm: number | null
  schedule: ServiceTarget | undefined
  last: MaintenanceRecord | undefined
}

function distance(label: string, current: number | null, schedule: ServiceTarget | undefined, last: MaintenanceRecord | undefined, unit: MeterUnit): DistanceIndicator {
  const fmtKm = (n: number) => fmtMeter(n, unit)
  const dueAt = schedule?.odometer ?? null
  const remaining = dueAt !== null && current !== null ? dueAt - current : null
  const lastAt = last?.odometer ?? null
  // Interval start: the last completed work when its odometer is known and sits below the due mileage; otherwise, if an interval is
  // configured, due − interval as a calculated baseline. A baseline is never turned into a completed record.
  let intervalStart: number | null = null
  let baselineCalculated = false
  if (dueAt !== null && lastAt !== null && lastAt < dueAt) intervalStart = lastAt
  else if (dueAt !== null && schedule?.intervalKm) { intervalStart = dueAt - schedule.intervalKm; baselineCalculated = true }
  let remainingPercent: number | null = null
  let consumedPercent: number | null = null
  if (intervalStart !== null && dueAt !== null && current !== null && dueAt > intervalStart && current >= intervalStart) {
    const s = lifeShares(current - intervalStart, dueAt - intervalStart)
    remainingPercent = s.remainingPercent
    consumedPercent = ((current - intervalStart) / (dueAt - intervalStart)) * 100 // may exceed 100 when overdue
  }
  const status = remainingStatus(remaining, schedule?.warnWithinKm ?? null)
  let text: string
  if (!schedule) text = `No ${label} recorded`
  else if (current === null) text = 'No valid odometer reading'
  else if (remaining! < 0) text = `Overdue by ${fmtKm(-remaining!)}`
  else if (status === 'warn') text = 'Due soon'
  else if (status === 'ok') text = 'On schedule'
  else text = 'Not yet due'
  return { unit, status, label: text, current, dueAt, remaining, lastAt, lastDate: last?.date ?? null, intervalStart, baselineCalculated, intervalKm: schedule?.intervalKm ?? null, remainingPercent, consumedPercent, warnWithinKm: schedule?.warnWithinKm ?? null, schedule, last }
}

/** Scheduled service that is not an oil change. Percentage only when an interval start is known (last service of the same recorded type, or a configured interval). */
export function serviceIndicator(state: FleetState, vehicleId: string): DistanceIndicator {
  const schedule = currentServiceTarget(state, vehicleId)
  const type = schedule?.serviceType ?? null
  const last = type ? lastService(state, vehicleId, type) : undefined
  return distance('next service', latestOdometer(state, vehicleId)?.reading ?? null, schedule, last, meterUnitOf(state, vehicleId))
}

/**
 * Oil change, one indicator: the target recorded as an oil change. An untyped target is never read as one. A target at or below the
 * odometer of the last completed oil change (or completed within the current interval) is already done, so the next change is then "not set" rather than overdue; recording the
 * next mileage updates the gauge.
 */
export function oilIndicator(state: FleetState, vehicleId: string): DistanceIndicator {
  const last = maintenanceOf(state, vehicleId).find((m) => isOilChange(m.serviceType))
  let schedule = currentOilTarget(state, vehicleId)
  // Already done: an oil change completed at/after the due mileage, or (with an interval) later than the interval's calculated start,
  // meaning it was performed for this cycle. A change at exactly the start is the cycle's own baseline, so the schedule stays.
  if (schedule && last?.odometer != null && last.odometer > schedule.odometer - (schedule.intervalKm ?? 0) - (schedule.intervalKm ? 0 : 1)) schedule = undefined
  return distance('oil-change schedule', latestOdometer(state, vehicleId)?.reading ?? null, schedule, last, meterUnitOf(state, vehicleId))
}

/* ── Tires ─────────────────────────────────────────────────────────────── */

export interface TireIndicator {
  status: Status
  label: string
  set: TireSet | undefined
  km: number | null
  expectedLifeKm: number | null
  /** Estimated, mileage-based life left / used, clamped to 0–100. This is an estimate, separate from recorded condition. */
  remainingPercent: number | null
  consumedPercent: number | null
  remainingKm: number | null
  treadMm: number | null
  replaceAtMm: number | null
  /** What the status rests on. */
  basis: 'condition' | 'tread' | 'lifespan' | 'none'
}

/**
 * Estimated tire life is mileage-based and kept separate from actual condition (which stays "Not assessed" until recorded). Status:
 * a recorded "replace" or a tread at/below the recorded limit is red; worn, fair, or a mileage estimate that has been passed is orange;
 * a recorded good condition, a measured tread above the limit, or mileage still inside the estimate is green; with none of these, unknown.
 */
export function tireIndicator(state: FleetState, vehicleId: string): TireIndicator {
  const fmtKm = (n: number) => fmtMeter(n, meterUnitOf(state, vehicleId))
  const set = activeTireSet(state, vehicleId)
  if (!set) return { status: 'unknown', label: 'No tire set fitted', set, km: null, expectedLifeKm: null, remainingPercent: null, consumedPercent: null, remainingKm: null, treadMm: null, replaceAtMm: null, basis: 'none' }
  const km = tireKm(state, set)
  const life = set.expectedLifeKm
  const { remainingPercent, consumedPercent, remaining } = lifeShares(km, life)
  const treadMm = latestTread(set)?.depthMm ?? null
  const base = { set, km, expectedLifeKm: life, remainingPercent, consumedPercent, remainingKm: remaining, treadMm, replaceAtMm: set.replaceAtMm }
  if (set.condition === 'replace') return { ...base, status: 'bad', label: 'Replace (recorded condition)', basis: 'condition' }
  if (treadMm !== null && set.replaceAtMm !== null && treadMm <= set.replaceAtMm) return { ...base, status: 'bad', label: `Tread ${treadMm} mm at or below ${set.replaceAtMm} mm limit`, basis: 'tread' }
  if (set.condition === 'worn') return { ...base, status: 'warn', label: 'Worn (recorded condition)', basis: 'condition' }
  if (remaining !== null && remaining < 0) return { ...base, status: 'warn', label: `Beyond estimated life by ${fmtKm(-remaining)}`, basis: 'lifespan' }
  if (set.condition === 'fair') return { ...base, status: 'warn', label: 'Fair (recorded condition)', basis: 'condition' }
  if (set.condition === 'good') return { ...base, status: 'ok', label: 'Good (recorded condition)', basis: 'condition' }
  if (treadMm !== null && set.replaceAtMm !== null) return { ...base, status: 'ok', label: `Tread ${treadMm} mm, above ${set.replaceAtMm} mm limit`, basis: 'tread' }
  if (remaining !== null) return { ...base, status: 'ok', label: 'Within estimated life', basis: 'lifespan' }
  return { ...base, status: 'unknown', label: 'No lifespan estimate set', basis: 'none' }
}

/* ── Inspections ───────────────────────────────────────────────────────── */

export type InspectionCadence = 'current' | 'due' | 'overdue' | 'unknown'
export interface InspectionIndicator {
  cadence: InspectionCadence
  status: Status
  label: string
  daysSince: number | null
  daysUntilDue: number | null
  intervalDays: number
  awaitingReview: boolean
  defects: number
  unreviewedDefects: number
  /** Demonstration records present for this vehicle. They never affect the status. */
  demoCount: number
}

/**
 * Whether the inspection is on time, from GENUINE inspections only: demonstration records are ignored, so samples can neither
 * satisfy nor hide a missing or overdue inspection. A status-only measure (no percentage): a submitted inspection makes the cadence
 * "current" but never marks the vehicle healthy, and an unreviewed one is shown as awaiting review.
 */
export function inspectionIndicator(state: FleetState, vehicleId: string, today: ISODate): InspectionIndicator {
  const i = inspectionStatus(state, vehicleId, today)
  const open = outstandingDefects(state, vehicleId)
  const common = { defects: open.length, unreviewedDefects: open.filter((x) => x.inspection.review === 'submitted').length, intervalDays: i.interval, demoCount: i.demoCount }
  if (i.daysSince === null) return { ...common, cadence: 'unknown', status: 'unknown', label: 'No verified inspection recorded', daysSince: null, daysUntilDue: null, awaitingReview: false }
  const awaitingReview = i.state === 'submitted'
  const daysUntilDue = i.interval - i.daysSince
  const cadence: InspectionCadence = i.daysSince > i.interval ? 'overdue' : i.daysSince === i.interval ? 'due' : 'current'
  const status: Status = cadence === 'overdue' ? 'bad' : cadence === 'due' ? 'warn' : awaitingReview ? 'info' : 'ok'
  const late = i.daysSince - i.interval
  const when = cadence === 'overdue' ? `Overdue by ${late} day${late === 1 ? '' : 's'}` : cadence === 'due' ? 'Due today' : `Current · due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`
  return { ...common, cadence, status, label: awaitingReview && cadence === 'current' ? `${when} · awaiting review` : when, daysSince: i.daysSince, daysUntilDue, awaitingReview }
}

