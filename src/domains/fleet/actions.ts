import type { ISODate } from '@/lib/date'
import type { Accessory, AccessoryCategory, AccessoryPlacement, Defect, FleetState, InspectionRecord, MaintenanceRecord, OdometerReading, RatedCondition, Studded, TireClass, TireCondition, TireSet, TreadMeasurement, Vehicle } from './types'
import { countsAsCurrent, currentAssignment, currentServiceTarget, latestOdometer, odometerHistory } from './selectors'

export type Result = { state: FleetState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: FleetState) => Result

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

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
  // An undated verified reading sorts first, so it is the baseline for any dated reading that follows it.
  const before = counted.filter((r) => r.date === null || r.date <= input.date).at(-1)
  const after = counted.find((r) => r.date !== null && r.date > input.date)
  let flag: string | null = null
  if (input.correctsId) {
    const target = history.find((r) => r.id === input.correctsId)
    if (!target) return { error: 'The reading being corrected was not found.' }
    flag = `Stated as a correction of the ${fmtKm(target.reading)} reading${target.date ? ` on ${target.date}` : ''}.`
  } else if (before && input.reading < before.reading) flag = `Lower than the ${fmtKm(before.reading)} reading${before.date ? ` on ${before.date}` : ' (date not recorded)'}.`
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

/**
 * Sets the next scheduled service mileage. Earlier targets stay in the history. The service type and a "due soon" warning
 * window are optional and are only stored when given: nothing is assumed (a target is not taken to be an oil change).
 */
export const setServiceTarget = (vehicleId: string, odometer: number, note: string, today: ISODate, opts: { serviceType?: string; warnWithinKm?: number | null } = {}): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (!Number.isFinite(odometer) || !Number.isInteger(odometer) || odometer <= 0) return { error: 'Enter the next service mileage as a whole number of kilometres greater than zero.' }
  const warn = opts.warnWithinKm ?? null
  if (warn !== null && (!Number.isInteger(warn) || warn <= 0)) return { error: 'The warning window must be a whole number of kilometres greater than zero.' }
  const serviceType = opts.serviceType?.trim() || null
  const current = currentServiceTarget(s, vehicleId)
  if (current && current.odometer === odometer && current.serviceType === serviceType && current.warnWithinKm === warn) return { error: 'That is already the next service.' }
  return { state: { ...s, serviceTargets: [...s.serviceTargets, { id: nextId('svc'), vehicleId, odometer, setDate: today, note: note.trim(), serviceType, warnWithinKm: warn }] } }
}

/**
 * Records completed maintenance. A recorded service threshold is never a record of work done, so this is the only way a
 * service is shown as completed. The odometer, when given, cannot be above the vehicle's current valid reading.
 */
export const recordMaintenance = (vehicleId: string, input: { date: ISODate; serviceType: string; odometer: number | null; description: string; notes: string }, today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (!input.serviceType.trim()) return { error: 'Enter the type of service.' }
  if (!validDate(input.date)) return { error: 'Enter a valid date.' }
  if (input.date > today) return { error: 'Maintenance cannot be dated in the future.' }
  if (input.odometer !== null) {
    if (!Number.isInteger(input.odometer) || input.odometer < 0) return { error: 'Enter the service odometer as a whole number of kilometres.' }
    const cur = latestOdometer(s, vehicleId)
    if (cur && input.odometer > cur.reading) return { error: `That is above the current odometer (${fmtKm(cur.reading)}). Record the newer odometer reading first.` }
  }
  const rec: MaintenanceRecord = { id: nextId('mnt'), vehicleId, date: input.date, serviceType: input.serviceType.trim(), odometer: input.odometer, description: input.description.trim(), notes: input.notes.trim() }
  return { state: { ...s, maintenance: [...s.maintenance, rec] } }
}

/* ── Vehicle details ───────────────────────────────────────────────────── */

/** Edits the one vehicle record that the organization and project views both read. */
export const updateVehicle = (vehicleId: string, patch: { unitNumber: string; year: number; make: string; model: string; vin: string; licencePlate: string; notes: string }): Reducer => (s) => {
  const v = s.vehicles.find((x) => x.id === vehicleId)
  if (!v) return { error: 'Vehicle not found.' }
  const unit = patch.unitNumber.trim()
  if (!unit) return { error: 'Enter a unit number.' }
  if (s.vehicles.some((x) => x.id !== vehicleId && x.unitNumber.toLowerCase() === unit.toLowerCase())) return { error: `Unit ${unit} already exists.` }
  if (!Number.isInteger(patch.year) || patch.year < 1980 || patch.year > 2100) return { error: 'Enter a valid model year.' }
  if (!patch.make.trim() || !patch.model.trim()) return { error: 'Enter the make and model.' }
  const next: Vehicle = { ...v, unitNumber: unit, year: patch.year, make: patch.make.trim(), model: patch.model.trim(), vin: patch.vin.trim() || null, licencePlate: patch.licencePlate.trim() || null, notes: patch.notes.trim() }
  return { state: { ...s, vehicles: s.vehicles.map((x) => (x === v ? next : x)) } }
}

/* ── Tires ─────────────────────────────────────────────────────────────── */

export interface TireInput {
  manufacturer: string; model: string; size: string; classes: TireClass[]; studded: Studded; origin: string
  installDate: ISODate | null; installOdometer: number | null; condition: TireCondition; notes: string
}
const odoOk = (n: number | null) => n === null || (Number.isInteger(n) && n >= 0)

function validateTire(s: FleetState, vehicleId: string, t: TireInput, today: ISODate): string | null {
  if (!t.manufacturer.trim() && !t.model.trim()) return 'Enter the tire manufacturer or model.'
  if (!odoOk(t.installOdometer)) return 'Enter the installation odometer as a whole number of kilometres.'
  if (t.installDate !== null && (!validDate(t.installDate) || t.installDate > today)) return 'Enter a valid installation date that is not in the future.'
  const cur = latestOdometer(s, vehicleId)
  if (t.installOdometer !== null && cur && t.installOdometer > cur.reading) return `The installation odometer is above the current odometer (${fmtKm(cur.reading)}).`
  return null
}
const toTire = (vehicleId: string, t: TireInput, id: string, active: boolean): TireSet => ({
  id, vehicleId, manufacturer: t.manufacturer.trim(), model: t.model.trim(), size: t.size.trim() || null, classes: [...new Set(t.classes)], studded: t.studded, origin: t.origin.trim(),
  active, installDate: t.installDate, installOdometer: t.installOdometer, removalDate: null, removalOdometer: null, condition: t.condition, treads: [], notes: t.notes.trim(),
})

/** Fits a first set (or one when none is active). Use replaceTireSet when a set is already fitted. */
export const addTireSet = (vehicleId: string, input: TireInput, today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (s.tireSets.some((t) => t.vehicleId === vehicleId && t.active)) return { error: 'This vehicle already has an active tire set. Replace it instead.' }
  const bad = validateTire(s, vehicleId, input, today)
  return bad ? { error: bad } : { state: { ...s, tireSets: [...s.tireSets, toTire(vehicleId, input, nextId('tire'), true)] } }
}

/**
 * Replaces the active set with a new one. The old set is closed with a removal date and odometer and kept in the history;
 * exactly one set stays active.
 */
export const replaceTireSet = (vehicleId: string, input: TireInput, removal: { date: ISODate | null; odometer: number | null }, today: ISODate): Reducer => (s) => {
  const old = s.tireSets.find((t) => t.vehicleId === vehicleId && t.active)
  if (!old) return { error: 'There is no active tire set to replace.' }
  const bad = validateTire(s, vehicleId, input, today)
  if (bad) return { error: bad }
  if (!odoOk(removal.odometer)) return { error: 'Enter the removal odometer as a whole number of kilometres.' }
  if (removal.date !== null && (!validDate(removal.date) || removal.date > today)) return { error: 'Enter a valid removal date that is not in the future.' }
  if (removal.odometer !== null && old.installOdometer !== null && removal.odometer < old.installOdometer) return { error: 'The removal odometer is below the installation odometer of the set being removed.' }
  if (removal.odometer !== null && input.installOdometer !== null && input.installOdometer < removal.odometer) return { error: 'The new set cannot be installed at a lower odometer than the old set was removed.' }
  const closed = s.tireSets.map((t) => (t === old ? { ...t, active: false, removalDate: removal.date, removalOdometer: removal.odometer } : t))
  return { state: { ...s, tireSets: [...closed, toTire(vehicleId, input, nextId('tire'), true)] } }
}

/** Takes the active set off without fitting another. The set stays in the history. */
export const removeTireSet = (tireId: string, removal: { date: ISODate | null; odometer: number | null }, today: ISODate): Reducer => (s) => {
  const t = s.tireSets.find((x) => x.id === tireId)
  if (!t) return { error: 'Tire set not found.' }
  if (!t.active) return { error: 'That set has already been removed.' }
  if (!odoOk(removal.odometer)) return { error: 'Enter the removal odometer as a whole number of kilometres.' }
  if (removal.date !== null && (!validDate(removal.date) || removal.date > today)) return { error: 'Enter a valid removal date that is not in the future.' }
  if (removal.odometer !== null && t.installOdometer !== null && removal.odometer < t.installOdometer) return { error: 'The removal odometer is below the installation odometer.' }
  return { state: { ...s, tireSets: s.tireSets.map((x) => (x === t ? { ...x, active: false, removalDate: removal.date, removalOdometer: removal.odometer } : x)) } }
}

/** Edits descriptive details of a set (including filling in unknowns later). Fitting history is changed only through install/replace/remove. */
export const updateTireSet = (tireId: string, input: TireInput, today: ISODate): Reducer => (s) => {
  const t = s.tireSets.find((x) => x.id === tireId)
  if (!t) return { error: 'Tire set not found.' }
  const bad = validateTire(s, t.vehicleId, input, today)
  if (bad) return { error: bad }
  if (!t.active && t.removalOdometer !== null && input.installOdometer !== null && input.installOdometer > t.removalOdometer) return { error: 'The installation odometer is above the removal odometer.' }
  return { state: { ...s, tireSets: s.tireSets.map((x) => (x === t ? { ...x, ...toTire(t.vehicleId, input, t.id, t.active), removalDate: t.removalDate, removalOdometer: t.removalOdometer, treads: t.treads } : x)) } }
}

/** Records a tread-depth measurement. The date is optional and the odometer defaults to the current reading when the set is active. */
export const addTreadMeasurement = (tireId: string, input: { date: ISODate | null; depthMm: number; note: string }, today: ISODate): Reducer => (s) => {
  const t = s.tireSets.find((x) => x.id === tireId)
  if (!t) return { error: 'Tire set not found.' }
  if (!Number.isFinite(input.depthMm) || input.depthMm < 0 || input.depthMm > 30) return { error: 'Enter the tread depth in millimetres (0 to 30).' }
  if (input.date !== null && (!validDate(input.date) || input.date > today)) return { error: 'Enter a valid date that is not in the future.' }
  const odometer = t.active ? latestOdometer(s, t.vehicleId)?.reading ?? null : t.removalOdometer
  const m: TreadMeasurement = { id: nextId('tread'), date: input.date, odometer, depthMm: input.depthMm, note: input.note.trim() }
  return { state: { ...s, tireSets: s.tireSets.map((x) => (x === t ? { ...x, treads: [...x.treads, m] } : x)) } }
}

export const setTireCondition = (tireId: string, condition: TireCondition): Reducer => (s) =>
  s.tireSets.some((t) => t.id === tireId) ? { state: { ...s, tireSets: s.tireSets.map((t) => (t.id === tireId ? { ...t, condition } : t)) } } : { error: 'Tire set not found.' }

/* ── Accessories ───────────────────────────────────────────────────────── */

export interface AccessoryInput { name: string; category: AccessoryCategory; description: string; specification: string; cost: number | null; warranty: string; notes: string }
const validateAccessory = (a: AccessoryInput) =>
  !a.name.trim() ? 'Enter a name for the accessory.' : a.cost !== null && (!Number.isFinite(a.cost) || a.cost < 0) ? 'Cost must be zero or more.' : null

function validatePlacementDates(s: FleetState, vehicleId: string, date: ISODate | null, odometer: number | null, today: ISODate): string | null {
  if (date !== null && (!validDate(date) || date > today)) return 'Enter a valid date that is not in the future.'
  if (!odoOk(odometer)) return 'Enter the odometer as a whole number of kilometres.'
  const cur = latestOdometer(s, vehicleId)
  if (odometer !== null && cur && odometer > cur.reading) return `The odometer is above the vehicle's current reading (${fmtKm(cur.reading)}).`
  return null
}

/** Adds an accessory and installs it on a vehicle. */
export const addAccessory = (vehicleId: string, input: AccessoryInput, install: { date: ISODate | null; odometer: number | null }, today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  const bad = validateAccessory(input) ?? validatePlacementDates(s, vehicleId, install.date, install.odometer, today)
  if (bad) return { error: bad }
  const acc: Accessory = {
    id: nextId('acc'), name: input.name.trim(), category: input.category, description: input.description.trim(), specification: input.specification.trim(), cost: input.cost, warranty: input.warranty.trim(), notes: input.notes.trim(),
    placements: [{ vehicleId, installDate: install.date, installOdometer: install.odometer, endDate: null, endOdometer: null, endReason: null, toVehicleId: null, note: '' }],
  }
  return { state: { ...s, accessories: [...s.accessories, acc] } }
}

const patchAccessory = (s: FleetState, id: string, fn: (a: Accessory) => Accessory | string): Result => {
  const a = s.accessories.find((x) => x.id === id)
  if (!a) return { error: 'Accessory not found.' }
  const next = fn(a)
  return typeof next === 'string' ? { error: next } : { state: { ...s, accessories: s.accessories.map((x) => (x === a ? next : x)) } }
}

export const updateAccessory = (accessoryId: string, input: AccessoryInput): Reducer => (s) =>
  patchAccessory(s, accessoryId, (a) => validateAccessory(input) ?? { ...a, name: input.name.trim(), category: input.category, description: input.description.trim(), specification: input.specification.trim(), cost: input.cost, warranty: input.warranty.trim(), notes: input.notes.trim() })

/** Fills in or corrects when and at what odometer an accessory was installed on a vehicle (its latest placement there). */
export const updateInstallation = (accessoryId: string, vehicleId: string, install: { date: ISODate | null; odometer: number | null }, today: ISODate): Reducer => (s) =>
  patchAccessory(s, accessoryId, (a) => {
    const idx = a.placements.map((p) => p.vehicleId).lastIndexOf(vehicleId)
    if (idx < 0) return 'That accessory has not been on this vehicle.'
    const bad = validatePlacementDates(s, vehicleId, install.date, install.odometer, today)
    return bad ?? { ...a, placements: a.placements.map((p, i) => (i === idx ? { ...p, installDate: install.date, installOdometer: install.odometer } : p)) }
  })

const closeOpen = (a: Accessory, end: { date: ISODate | null; odometer: number | null; reason: 'removed' | 'transferred'; toVehicleId: string | null; note: string }): AccessoryPlacement[] =>
  a.placements.map((p) => (p.endReason === null ? { ...p, endDate: end.date, endOdometer: end.odometer, endReason: end.reason, toVehicleId: end.toVehicleId, note: end.note } : p))

/** Takes an accessory off its vehicle. The record and its placement history are kept. */
export const removeAccessory = (accessoryId: string, end: { date: ISODate | null; odometer: number | null; note: string }, today: ISODate): Reducer => (s) =>
  patchAccessory(s, accessoryId, (a) => {
    const open = a.placements.find((p) => p.endReason === null)
    if (!open) return 'That accessory is not currently installed.'
    const bad = validatePlacementDates(s, open.vehicleId, end.date, end.odometer, today)
    if (bad) return bad
    if (end.odometer !== null && open.installOdometer !== null && end.odometer < open.installOdometer) return 'The removal odometer is below the installation odometer.'
    return { ...a, placements: closeOpen(a, { ...end, reason: 'removed', toVehicleId: null, note: end.note.trim() }) }
  })

/** Installs a removed accessory on a vehicle again (the same or another one), adding a placement. */
export const installAccessory = (accessoryId: string, vehicleId: string, install: { date: ISODate | null; odometer: number | null; note: string }, today: ISODate): Reducer => (s) =>
  patchAccessory(s, accessoryId, (a) => {
    if (!s.vehicles.some((v) => v.id === vehicleId)) return 'Vehicle not found.'
    if (a.placements.some((p) => p.endReason === null)) return 'That accessory is already installed. Remove or transfer it first.'
    return validatePlacementDates(s, vehicleId, install.date, install.odometer, today) ?? { ...a, placements: [...a.placements, { vehicleId, installDate: install.date, installOdometer: install.odometer, endDate: null, endOdometer: null, endReason: null, toVehicleId: null, note: install.note.trim() }] }
  })

/**
 * Transfers an installed accessory to another vehicle. The original record is kept: its placement on the first vehicle is
 * closed as "transferred" and a new placement opens on the second, so both vehicles keep the history.
 */
export const transferAccessory = (accessoryId: string, toVehicleId: string, input: { date: ISODate | null; fromOdometer: number | null; toOdometer: number | null; note: string }, today: ISODate): Reducer => (s) =>
  patchAccessory(s, accessoryId, (a) => {
    const open = a.placements.find((p) => p.endReason === null)
    if (!open) return 'That accessory is not currently installed.'
    if (!s.vehicles.some((v) => v.id === toVehicleId)) return 'Vehicle not found.'
    if (open.vehicleId === toVehicleId) return 'The accessory is already on that vehicle.'
    const bad = validatePlacementDates(s, open.vehicleId, input.date, input.fromOdometer, today) ?? validatePlacementDates(s, toVehicleId, input.date, input.toOdometer, today)
    if (bad) return bad
    if (input.fromOdometer !== null && open.installOdometer !== null && input.fromOdometer < open.installOdometer) return 'The removal odometer is below the installation odometer.'
    const closed = closeOpen(a, { date: input.date, odometer: input.fromOdometer, reason: 'transferred', toVehicleId, note: input.note.trim() })
    return { ...a, placements: [...closed, { vehicleId: toVehicleId, installDate: input.date, installOdometer: input.toOdometer, endDate: null, endOdometer: null, endReason: null, toVehicleId: null, note: input.note.trim() }] }
  })

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
