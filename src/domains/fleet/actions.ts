import type { ISODate } from '@/lib/date'
import type { Defect, FleetState, InspectionRecord, OdometerReading, RatedCondition } from './types'
import { countsAsCurrent, currentAssignment, currentServiceTarget, odometerHistory } from './selectors'

export type Result = { state: FleetState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: FleetState) => Result

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * Moves a vehicle to another project (or unassigns it with projectId = null). The earlier assignment is closed, not
 * rewritten, so the vehicle's history stays intact. `validProjectIds` comes from the project registry.
 */
export const reassignVehicle = (vehicleId: string, projectId: string | null, validProjectIds: string[], today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (projectId !== null && !validProjectIds.includes(projectId)) return { error: 'That project does not exist.' }
  const current = currentAssignment(s, vehicleId)
  if ((current?.projectId ?? null) === projectId) return { error: 'The vehicle is already assigned there.' }
  const closed = s.assignments.map((a) => (a === current ? { ...a, endDate: today } : a))
  const assignments = projectId === null ? closed : [...closed, { id: nextId('asg'), vehicleId, projectId, startDate: today, endDate: null }]
  return { state: { ...s, assignments } }
}

/* ── Odometer ──────────────────────────────────────────────────────────── */

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())
const fmtKm = (n: number) => `${n.toLocaleString('en-CA')} km`

/**
 * Records a dated odometer reading in kilometres. Impossible values are refused. A reading that contradicts the history
 * (lower than an earlier reading, higher than a later one, or stated as a correction) is still recorded, but held for review
 * and excluded from the vehicle's current mileage until a person accepts it. Earlier readings are never edited or removed.
 */
export const recordOdometer = (vehicleId: string, input: { date: ISODate; reading: number; note: string; correctsId?: string | null }, today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (!Number.isFinite(input.reading) || input.reading <= 0) return { error: 'Enter an odometer reading greater than zero.' }
  if (!Number.isInteger(input.reading)) return { error: 'Enter the odometer reading as a whole number of kilometres.' }
  if (!validDate(input.date)) return { error: 'Enter a valid date.' }
  if (input.date > today) return { error: 'A reading cannot be dated in the future.' }
  const history = odometerHistory(s, vehicleId)
  if (history.some((r) => r.date === input.date && r.reading === input.reading && r.review !== 'rejected')) return { error: 'That reading is already recorded for that date.' }
  const counted = history.filter(countsAsCurrent)
  const before = counted.filter((r) => r.date <= input.date).at(-1)
  const after = counted.find((r) => r.date > input.date)
  let flag: string | null = null
  if (input.correctsId) {
    const target = history.find((r) => r.id === input.correctsId)
    if (!target) return { error: 'The reading being corrected was not found.' }
    flag = `Stated as a correction of the ${fmtKm(target.reading)} reading on ${target.date}.`
  } else if (before && input.reading < before.reading) flag = `Lower than the ${fmtKm(before.reading)} reading on ${before.date}.`
  else if (after && input.reading > after.reading) flag = `Higher than the later ${fmtKm(after.reading)} reading on ${after.date}.`
  const reading: OdometerReading = {
    id: nextId('odo'), vehicleId, date: input.date, reading: input.reading, unit: 'km', review: flag ? 'needs-review' : 'valid', flag,
    correctsId: input.correctsId ?? null, note: input.note.trim(), reviewNote: '', reviewedDate: null,
  }
  return { state: { ...s, odometer: [...s.odometer, reading] } }
}

/** Accepts or rejects a held reading. The reading and the decision both stay on the record. */
export const reviewOdometer = (readingId: string, decision: 'accepted' | 'rejected', reviewNote: string, today: ISODate): Reducer => (s) => {
  const r = s.odometer.find((x) => x.id === readingId)
  if (!r) return { error: 'Reading not found.' }
  if (r.review !== 'needs-review') return { error: 'Only readings held for review can be decided.' }
  return { state: { ...s, odometer: s.odometer.map((x) => (x === r ? { ...x, review: decision, reviewNote: reviewNote.trim(), reviewedDate: today } : x)) } }
}

/* ── Service ───────────────────────────────────────────────────────────── */

/** Sets the next scheduled service mileage. Earlier targets stay in the history. */
export const setServiceTarget = (vehicleId: string, odometer: number, note: string, today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (!Number.isFinite(odometer) || !Number.isInteger(odometer) || odometer <= 0) return { error: 'Enter the next service mileage as a whole number of kilometres greater than zero.' }
  const current = currentServiceTarget(s, vehicleId)
  if (current?.odometer === odometer) return { error: 'That is already the next service mileage.' }
  return { state: { ...s, serviceTargets: [...s.serviceTargets, { id: nextId('svc'), vehicleId, odometer, setDate: today, note: note.trim() }] } }
}

/* ── Inspections and defects ───────────────────────────────────────────── */

const patchInspection = (s: FleetState, id: string, fn: (i: InspectionRecord) => InspectionRecord | string): Result => {
  const i = s.inspections.find((x) => x.id === id)
  if (!i) return { error: 'Inspection not found.' }
  const next = fn(i)
  return typeof next === 'string' ? { error: next } : { state: { ...s, inspections: s.inspections.map((x) => (x === i ? next : x)) } }
}

/** Records a weekly inspection submission. It is stored as "submitted": no condition is implied and defects start outstanding. */
export const submitInspection = (vehicleId: string, input: { date: ISODate; submittedBy: string; notes: string; defects: string[] }, today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (!validDate(input.date)) return { error: 'Enter a valid date.' }
  if (input.date > today) return { error: 'An inspection cannot be dated in the future.' }
  if (s.inspections.some((i) => i.vehicleId === vehicleId && i.date === input.date)) return { error: 'An inspection is already recorded for that date.' }
  const defects = input.defects.map((d) => d.trim()).filter(Boolean).map((description): Defect => ({ id: nextId('def'), description, status: 'outstanding', resolvedDate: null, resolutionNote: '' }))
  const rec: InspectionRecord = { id: nextId('insp'), vehicleId, date: input.date, submittedBy: input.submittedBy.trim(), notes: input.notes.trim(), defects, review: 'submitted', reviewedBy: '', reviewedDate: null, reviewNote: '', condition: null }
  return { state: { ...s, inspections: [...s.inspections, rec] } }
}

/** A reviewer marks the submission as reviewed and may state a condition. Defects are unaffected: they are resolved separately. */
export const reviewInspection = (inspectionId: string, input: { reviewedBy: string; note: string; condition: RatedCondition | null }, today: ISODate): Reducer => (s) =>
  patchInspection(s, inspectionId, (i) => (i.review === 'reviewed' ? 'This inspection has already been reviewed.' : { ...i, review: 'reviewed', reviewedBy: input.reviewedBy.trim(), reviewedDate: today, reviewNote: input.note.trim(), condition: input.condition }))

export const addDefect = (inspectionId: string, description: string): Reducer => (s) =>
  patchInspection(s, inspectionId, (i) => (description.trim() ? { ...i, defects: [...i.defects, { id: nextId('def'), description: description.trim(), status: 'outstanding', resolvedDate: null, resolutionNote: '' }] } : 'Describe the defect.'))

export const resolveDefect = (inspectionId: string, defectId: string, resolutionNote: string, today: ISODate): Reducer => (s) =>
  patchInspection(s, inspectionId, (i) => {
    const d = i.defects.find((x) => x.id === defectId)
    if (!d) return 'Defect not found.'
    if (d.status === 'resolved') return 'That defect is already resolved.'
    return { ...i, defects: i.defects.map((x) => (x === d ? { ...x, status: 'resolved', resolvedDate: today, resolutionNote: resolutionNote.trim() } : x)) }
  })

export const reopenDefect = (inspectionId: string, defectId: string): Reducer => (s) =>
  patchInspection(s, inspectionId, (i) => (i.defects.some((x) => x.id === defectId && x.status === 'resolved') ? { ...i, defects: i.defects.map((x) => (x.id === defectId ? { ...x, status: 'outstanding', resolvedDate: null, resolutionNote: '' } : x)) } : 'That defect is not resolved.'))
