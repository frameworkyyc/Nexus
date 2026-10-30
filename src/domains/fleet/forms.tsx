import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { SearchSelect, type SelectOption } from '@/components/ui/SearchSelect'
import { useAccess } from '@/lib/access'
import { accessoryLabel, findAccessoryType, typesOf } from './accessoryTypes'
import * as A from './commands'
import type { AccessoryInput, TireInput } from './actions'
import { recordOdometer, reviewInspection, setServiceTarget, submitInspection } from './commands'
import { activeTireSet, CONDITION_LABEL, currentOilTarget, latestOdometer, odometerHistory, serviceStatus, TIRE_CLASS_LABEL, TIRE_CONDITION_LABEL, vehicleTitle } from './selectors'
import { oilIndicator } from './indicators'
import { fleetStore, useFleet, useFleetCommand } from './store'
import { categoriesOf, fmtMeter, meterUnitOf } from './meter'
import type { Accessory, InspectionRecord, MeterUnit, RatedCondition, Studded, TireClass, TireCondition, TireSet, Vehicle } from './types'

const Body = ({ children }: { children: React.ReactNode }) => <div className="space-y-4 p-6 text-[13px]">{children}</div>

export function OdometerModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [date, setDate] = useState(today)
  const [reading, setReading] = useState('')
  const [note, setNote] = useState('')
  const [corrects, setCorrects] = useState('')
  const latest = latestOdometer(state, vehicle.id)
  const unit = meterUnitOf(state, vehicle.id)
  const history = odometerHistory(state, vehicle.id).filter((r) => r.review !== 'rejected').slice(-8).reverse()
  const save = () => { run(recordOdometer(vehicle.id, { date, reading: Number(reading), note, correctsId: corrects || null }, today), onClose)}
  return (
    <Modal title={`Record ${unit === 'h' ? 'hour meter' : 'odometer'} · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">{latest ? `Current ${unit === 'h' ? 'hours' : 'mileage'} ${fmtMeter(latest.reading, unit)} (${latest.date}).` : 'No reading recorded yet.'} A reading lower than an earlier one, or higher than a later one, is saved but held for review; it will not change the current mileage until someone accepts it.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={unit === 'h' ? 'Reading (hours)' : 'Reading (km)'}><Input inputMode="decimal" autoFocus value={reading} onChange={(e) => setReading(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="This corrects an earlier reading (optional)">
          <Select value={corrects} onChange={(e) => setCorrects(e.target.value)}><option value="">No — this is a new reading</option>{history.map((r) => <option key={r.id} value={r.id}>{r.date} · {fmtMeter(r.reading, unit)}</option>)}</Select>
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !reading} onClick={save}>Save reading</Button>
      </Body>
    </Modal>
  )
}

export function InspectionModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const unit = meterUnitOf(state, vehicle.id)
  const latest = latestOdometer(state, vehicle.id)
  const [date, setDate] = useState(today)
  const [by, setBy] = useState('')
  const [reading, setReading] = useState('')
  const [nextOil, setNextOil] = useState('')
  const [condition, setCondition] = useState<RatedCondition | ''>('')
  const [notes, setNotes] = useState('')
  const [defects, setDefects] = useState('')
  const [error, setError] = useState('')
  const readingN = numOrNull(reading)
  // Say, before saving, when the reading will not become the current figure: an older inspection never overwrites a newer reading.
  const nextN = numOrNull(nextOil)
  const basis = readingN !== null && !(latest && ((latest.date && date < latest.date) || readingN < latest.reading)) ? readingN : latest?.reading ?? readingN
  const overdueBy = nextN !== null && basis !== null && Number.isFinite(nextN) ? basis - nextN : null
  const held = readingN !== null && latest && ((latest.date && date < latest.date) || readingN < latest.reading)
  const save = () => {
    if (readingN === null) { setError(`Enter the current ${unit === 'h' ? 'hour-meter reading' : 'odometer'}.`); return }
    setError('')
    run(submitInspection(vehicle.id, { date, submittedBy: by, notes, defects: defects.split('\n'), meterReading: readingN, nextOilDue: numOrNull(nextOil), reportedCondition: condition || null }, today), onClose)
  }
  return (
    <Modal title={`Weekly inspection · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">Submitting records that the inspection was done and updates the {unit === 'h' ? 'hour meter' : 'odometer'}. It does not state the vehicle is sound: a reviewer verifies the condition, and every defect listed stays outstanding until it is resolved.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inspection date *"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Submitted by *"><Input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={unit === 'h' ? 'Current operating hours *' : 'Current odometer (km) *'}><Input inputMode="decimal" value={reading} onChange={(e) => setReading(e.target.value)} placeholder={latest ? `Last ${fmtMeter(latest.reading, unit)}` : 'Not recorded yet'} /></Field>
          <Field label={`Next oil change due (${unit === 'h' ? 'h' : 'km'}, optional)`}><Input inputMode="numeric" value={nextOil} onChange={(e) => setNextOil(e.target.value)} placeholder="Leave as is" /></Field>
        </div>
        {held && <p role="status" className="-mt-2 text-xs text-muted">This reading is {latest && latest.date && date < latest.date ? 'dated before' : 'lower than'} the current {fmtMeter(latest!.reading, unit)}. It is saved with the inspection but held for review, so it does not replace the current figure.</p>}
        {nextOil.trim() !== '' && (
          <p className="-mt-2 text-xs text-muted">
            {overdueBy !== null && overdueBy >= 0 ? <>That is {overdueBy === 0 ? 'at' : 'below'} the current reading, so the oil change will show as <span className="font-medium text-ink">{fmtMeter(overdueBy, unit)} overdue</span> until the schedule is updated. </> : null}
            This sets when the next oil change falls due. It does not record an oil change as done.
          </p>
        )}
        <Field label="Overall condition (as observed, optional)">
          <Select value={condition} onChange={(e) => setCondition(e.target.value as RatedCondition | '')}>
            <option value="">Not stated</option>
            {(['good', 'fair', 'poor', 'out-of-service'] as const).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Field label="Defects found (one per line)"><Textarea rows={4} value={defects} onChange={(e) => setDefects(e.target.value)} placeholder="Leave empty if none were found" /></Field>
        <Field label="Inspection notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <p role="alert" className="text-status-bad">{error}</p>}
        <Button variant="primary" disabled={saving || !by.trim()} onClick={save}>Submit inspection</Button>
      </Body>
    </Modal>
  )
}

const numOrNull = (t: string) => (t.trim() === '' ? null : Number(t))
const dateOrNull = (t: string) => (t === '' ? null : t)
const SERVICE_TYPES = ['Oil change', 'Tire rotation', 'Brake service', 'Scheduled service', 'Inspection']

export function ServiceModal({ vehicle, oil = false, onClose }: { vehicle: Vehicle; oil?: boolean; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const oilInd = oilIndicator(state, vehicle.id)
  const u = meterUnitOf(state, vehicle.id) === 'h' ? 'h' : 'km'
  const s = oil ? { target: oilInd.schedule } : serviceStatus(state, vehicle.id)
  // After an oil change is recorded the old target is done; offer the next one as last change + the previous interval (editable, never saved unseen).
  const prevOil = oil ? currentOilTarget(state, vehicle.id) : undefined
  const suggested = oil && !s.target && oilInd.lastAt !== null && prevOil?.intervalKm ? String(oilInd.lastAt + prevOil.intervalKm) : ''
  const [value, setValue] = useState(s.target ? String(s.target.odometer) : suggested)
  const [type, setType] = useState(oil ? 'Oil change' : s.target?.serviceType ?? '')
  const [warn, setWarn] = useState((s.target ?? prevOil)?.warnWithinKm ? String((s.target ?? prevOil)!.warnWithinKm) : '')
  const [interval, setInterval_] = useState((s.target ?? prevOil)?.intervalKm ? String((s.target ?? prevOil)!.intervalKm) : '')
  const [note, setNote] = useState('')
  const save = () => { run(setServiceTarget(vehicle.id, Number(value), note, today, { serviceType: type, warnWithinKm: numOrNull(warn), intervalKm: numOrNull(interval) }), onClose)}
  return (
    <Modal title={`${oil ? 'Next oil change' : 'Next service'} · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">{oil ? 'Enter the odometer reading at which the next oil change falls due. The interval percentage is shown only when the last oil change was recorded with its odometer.' : 'Enter the odometer reading at which the next scheduled service falls due. KM remaining is calculated from the latest valid reading. The service type is optional and is not assumed. Oil changes are scheduled separately.'}</p>
        <Field label={oil ? `Next oil change at (${u})` : `Next service at (${u})`}><Input inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        {!oil && <Field label="Service type (optional)"><Input list="service-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="Not specified" /></Field>}
        {!oil && <datalist id="service-types">{SERVICE_TYPES.filter((t) => t !== 'Oil change').map((t) => <option key={t} value={t} />)}</datalist>}
        <Field label={`Interval between services (${u}, optional)`}><Input inputMode="numeric" value={interval} onChange={(e) => setInterval_(e.target.value)} placeholder="Not set" /></Field>
        <Field label={`Highlight as due soon within (${u}, optional)`}><Input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} placeholder="No warning window" /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !value} onClick={save}>Save</Button>
      </Body>
    </Modal>
  )
}

/** `onSaved`, when given, runs after a successful save instead of just closing (e.g. to prompt for the next oil-change mileage). */
export function MaintenanceModal({ vehicle, presetType = '', onSaved, onClose }: { vehicle: Vehicle; presetType?: string; onSaved?: () => void; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [date, setDate] = useState(today)
  const [type, setType] = useState(presetType)
  const [odo, setOdo] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const save = () => { run(A.recordMaintenance(vehicle.id, { date, serviceType: type, odometer: numOrNull(odo), description, notes }, today), onSaved ?? onClose)}
  return (
    <Modal title={`Record maintenance · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">Records work that has been completed. A service threshold alone is never shown as done.</p>
        <Field label="Service type"><Input list="service-types" autoFocus value={type} onChange={(e) => setType(e.target.value)} /></Field>
        <datalist id="service-types">{SERVICE_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={meterUnitOf(state, vehicle.id) === 'h' ? 'Hour meter (h, optional)' : 'Odometer (km, optional)'}><Input inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
        </div>
        <Field label="Work done"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !type.trim()} onClick={save}>Save record</Button>
      </Body>
    </Modal>
  )
}

/** Lifespan settings for one asset: its category (organization default), its own estimate (takes priority) and how often it is inspected. */
export function PlanningModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state } = useFleet()
  const access = useAccess()
  const unit = meterUnitOf(state, vehicle.id)
  const [life, setLife] = useState(vehicle.expectedLifeKm === null ? '' : String(vehicle.expectedLifeKm))
  const [days, setDays] = useState(vehicle.inspectionIntervalDays === null ? '' : String(vehicle.inspectionIntervalDays))
  const [category, setCategory] = useState(vehicle.categoryId ?? '')
  const [meter, setMeter] = useState<MeterUnit>(unit)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canChangeUnit = !state.odometer.some((r) => r.vehicleId === vehicle.id) && !state.serviceTargets.some((t) => t.vehicleId === vehicle.id)
  const cats = categoriesOf(state).filter((c) => !c.archived || c.id === vehicle.categoryId)
  const chosen = categoriesOf(state).find((c) => c.id === category)
  const shown = life.trim() === '' && chosen && chosen.defaultLife !== null && chosen.meterUnit === meter ? chosen.defaultLife : null
  const save = async () => {
    setBusy(true); setError('')
    const steps = [
      ...(meter !== unit ? [() => fleetStore.run(A.setVehicleMeterUnit(vehicle.id, meter))] : []),
      ...(category !== (vehicle.categoryId ?? '') ? [() => fleetStore.run(A.setVehicleCategory(vehicle.id, category || null))] : []),
      () => fleetStore.run(A.setVehiclePlanning(vehicle.id, { expectedLifeKm: numOrNull(life), inspectionIntervalDays: numOrNull(days) })),
    ]
    for (const step of steps) { const e = await step(); if (e) { setError(e); setBusy(false); return } }
    setBusy(false); onClose()
  }
  return (
    <Modal title={`Lifespan settings · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">The estimated lifespan is a planning figure only. Reaching it does not mark the vehicle unsafe, unserviceable or in any condition: condition comes from inspections. This asset’s own estimate takes priority over its category’s default.</p>
        <Field label="Category (organization default lifespan)">
          <Select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); const c = categoriesOf(state).find((x) => x.id === e.target.value); if (c && canChangeUnit) setMeter(c.meterUnit) }}>
            <option value="">No category</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.defaultLife === null ? 'no default' : fmtMeter(c.defaultLife, c.meterUnit)}</option>)}
          </Select>
        </Field>
        <Field label="This asset counts">
          <Select aria-label="Meter unit" value={meter} disabled={!canChangeUnit} onChange={(e) => setMeter(e.target.value as MeterUnit)}>
            <option value="km">Kilometres (odometer)</option><option value="h">Operating hours (hour meter)</option>
          </Select>
        </Field>
        {!canChangeUnit && <p className="-mt-2 text-xs text-muted">The unit is fixed once readings or schedules are recorded.</p>}
        <Field label={`Own lifespan estimate (${meter === 'h' ? 'hours' : 'km'}, optional)`}><Input inputMode="numeric" autoFocus value={life} onChange={(e) => setLife(e.target.value)} placeholder={shown !== null ? `Using the ${chosen!.name} default: ${fmtMeter(shown, meter)}` : 'Not set'} /></Field>
        <p className="-mt-2 text-xs text-muted">Leave blank to use the category default.{access.can('structure.manage') ? '' : ' Defaults are managed by an administrator in Fleet settings.'}</p>
        <Field label="Inspection interval (days)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Weekly (7)" /></Field>
        {error && <p role="alert" className="text-status-bad">{error}</p>}
        <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
      </Body>
    </Modal>
  )
}

export function VehicleEditModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state } = useFleet()
  const [f, setF] = useState({ unitNumber: vehicle.unitNumber, year: String(vehicle.year), make: vehicle.make, model: vehicle.model, vin: vehicle.vin ?? '', licencePlate: vehicle.licencePlate ?? '', notes: vehicle.notes })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const unit = meterUnitOf(state, vehicle.id)
  const locked = state.odometer.some((r) => r.vehicleId === vehicle.id) || state.serviceTargets.some((t) => t.vehicleId === vehicle.id)
  const cats = categoriesOf(state).filter((c) => !c.archived || c.id === vehicle.categoryId)
  const [category, setCategory] = useState(vehicle.categoryId ?? '')
  const [meter, setMeter] = useState<MeterUnit>(unit)
  const chosen = categoriesOf(state).find((c) => c.id === category)
  const defaultLife = chosen && chosen.defaultLife !== null && chosen.meterUnit === meter ? chosen.defaultLife : null
  const [custom, setCustom] = useState(vehicle.expectedLifeKm !== null || defaultLife === null)
  const [life, setLife] = useState(vehicle.expectedLifeKm === null ? '' : String(vehicle.expectedLifeKm))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const useCustom = custom || defaultLife === null
  const save = async () => {
    setBusy(true); setError('')
    const steps = [
      () => fleetStore.run(A.updateVehicle(vehicle.id, { ...f, year: Number(f.year) })),
      ...(meter !== unit ? [() => fleetStore.run(A.setVehicleMeterUnit(vehicle.id, meter))] : []),
      ...(category !== (vehicle.categoryId ?? '') ? [() => fleetStore.run(A.setVehicleCategory(vehicle.id, category || null))] : []),
      // Using the category default stores no estimate on the asset, so it follows the default if that changes. The inspection interval is kept as it is.
      () => fleetStore.run(A.setVehiclePlanning(vehicle.id, { expectedLifeKm: useCustom ? numOrNull(life) : null, inspectionIntervalDays: vehicle.inspectionIntervalDays })),
    ]
    for (const step of steps) { const e = await step(); if (e) { setError(e); setBusy(false); return } }
    setBusy(false); onClose()
  }
  return (
    <Modal title={`Edit ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit number"><Input value={f.unitNumber} onChange={set('unitNumber')} /></Field>
          <Field label="Year"><Input inputMode="numeric" value={f.year} onChange={set('year')} /></Field>
          <Field label="Make"><Input value={f.make} onChange={set('make')} /></Field>
          <Field label="Model"><Input value={f.model} onChange={set('model')} /></Field>
          <Field label="VIN"><Input value={f.vin} onChange={set('vin')} placeholder="Not recorded" /></Field>
          <Field label="Licence plate"><Input value={f.licencePlate} onChange={set('licencePlate')} placeholder="Not recorded" /></Field>
        </div>
        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>

        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="t-label">Lifespan</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); const c = categoriesOf(state).find((x) => x.id === e.target.value); if (c && !locked) setMeter(c.meterUnit) }}>
                <option value="">No category</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Counts">
              <Select aria-label="Meter unit" value={meter} disabled={locked} onChange={(e) => setMeter(e.target.value as MeterUnit)}><option value="km">Kilometres</option><option value="h">Operating hours</option></Select>
            </Field>
          </div>
          {locked && <p className="-mt-1 text-xs text-muted">The unit is fixed once readings or schedules are recorded.</p>}
          <div role="radiogroup" aria-label="Lifespan source" className="space-y-1 text-[13px]">
            <label className={`flex min-h-9 items-center gap-2 phone:min-h-11 ${defaultLife === null ? 'text-muted' : ''}`}>
              <input type="radio" name="life-source" className="h-4 w-4 phone:h-6 phone:w-6" checked={!useCustom} disabled={defaultLife === null} onChange={() => setCustom(false)} />
              {defaultLife !== null ? `Use the ${chosen!.name} default (${fmtMeter(defaultLife, meter)})` : category ? `No default set for ${chosen?.name ?? 'this category'}` : 'Use the category default (choose a category)'}
            </label>
            <label className="flex min-h-9 items-center gap-2 phone:min-h-11"><input type="radio" name="life-source" className="h-4 w-4 phone:h-6 phone:w-6" checked={useCustom} onChange={() => setCustom(true)} />Enter a custom lifespan for this vehicle</label>
          </div>
          {useCustom && <Field label={`Estimated lifespan (${meter === 'h' ? 'operating hours' : 'km'})`}><Input aria-label="Estimated lifespan" inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} placeholder="Not set" /></Field>}
          <p className="text-xs text-muted">A planning estimate only: reaching it never marks the vehicle unsafe. Category defaults are managed in Fleet settings.</p>
        </fieldset>
        {error && <p role="alert" className="text-status-bad">{error}</p>}
        <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </Body>
    </Modal>
  )
}

const CLASSES: TireClass[] = ['winter', 'all-season', 'all-terrain', 'summer', 'other']
const CONDITIONS: TireCondition[] = ['unknown', 'good', 'fair', 'worn', 'replace']
export type TireMode = { kind: 'add' } | { kind: 'replace' } | { kind: 'edit'; tire: TireSet }

/** Add the first set, replace the active set (keeping it in history), or edit a set's details. */
export function TireModal({ vehicle, mode, onClose }: { vehicle: Vehicle; mode: TireMode; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const cur = latestOdometer(state, vehicle.id)
  const old = mode.kind === 'edit' ? mode.tire : undefined
  const [f, setF] = useState({
    manufacturer: old?.manufacturer ?? '', model: old?.model ?? '', size: old?.size ?? '', studded: (old?.studded ?? 'unknown') as Studded, origin: old?.origin ?? '',
    installDate: old?.installDate ?? '', installOdometer: old ? (old.installOdometer === null ? '' : String(old.installOdometer)) : cur ? String(cur.reading) : '', condition: (old?.condition ?? 'unknown') as TireCondition, notes: old?.notes ?? '',
    expectedLifeKm: old?.expectedLifeKm == null ? '' : String(old.expectedLifeKm), replaceAtMm: old?.replaceAtMm == null ? '' : String(old.replaceAtMm),
  })
  const [classes, setClasses] = useState<TireClass[]>(old?.classes ?? [])
  const [remDate, setRemDate] = useState(today)
  const [remOdo, setRemOdo] = useState(cur ? String(cur.reading) : '')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const input = (): TireInput => ({ manufacturer: f.manufacturer, model: f.model, size: f.size, classes, studded: f.studded, origin: f.origin, installDate: dateOrNull(f.installDate), installOdometer: numOrNull(f.installOdometer), condition: f.condition, notes: f.notes, expectedLifeKm: numOrNull(f.expectedLifeKm), replaceAtMm: numOrNull(f.replaceAtMm) })
  const save = () => {
    const r = mode.kind === 'add' ? A.addTireSet(vehicle.id, input(), today)
      : mode.kind === 'replace' ? A.replaceTireSet(vehicle.id, input(), { date: dateOrNull(remDate), odometer: numOrNull(remOdo) }, today)
      : A.updateTireSet(mode.tire.id, input(), today)
    run(r, onClose)
  }
  const active = activeTireSet(state, vehicle.id)
  return (
    <Modal title={mode.kind === 'replace' ? `Replace tires · ${vehicle.unitNumber}` : mode.kind === 'add' ? `Add tire set · ${vehicle.unitNumber}` : `Edit tire set · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        {mode.kind === 'replace' && active && (
          <section className="space-y-3 border-b border-line pb-4">
            <p className="text-muted">The current set ({active.manufacturer} {active.model}) is taken off and kept in the tire history.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Removal date (optional)"><Input type="date" max={today} value={remDate} onChange={(e) => setRemDate(e.target.value)} /></Field>
              <Field label="Removal odometer (km)"><Input inputMode="numeric" value={remOdo} onChange={(e) => setRemOdo(e.target.value)} /></Field>
            </div>
          </section>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Manufacturer"><Input autoFocus value={f.manufacturer} onChange={set('manufacturer')} /></Field>
          <Field label="Model"><Input value={f.model} onChange={set('model')} /></Field>
          <Field label="Size (if known)"><Input value={f.size} onChange={set('size')} placeholder="Not recorded" /></Field>
          <Field label="Studded"><Select value={f.studded} onChange={set('studded')}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></Select></Field>
        </div>
        <fieldset><legend className="t-label mb-1.5">Classification (choose any that apply)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{CLASSES.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={classes.includes(c)} onChange={(e) => setClasses((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} />{TIRE_CLASS_LABEL[c]}</label>)}</div>
        </fieldset>
        <Field label="Installed as"><Input value={f.origin} onChange={set('origin')} placeholder="e.g. Original factory tires" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Installation date (optional)"><Input type="date" max={today} value={f.installDate} onChange={set('installDate')} /></Field>
          <Field label="Installation odometer (km)"><Input inputMode="numeric" value={f.installOdometer} onChange={set('installOdometer')} /></Field>
        </div>
        <Field label="Condition"><Select value={f.condition} onChange={set('condition')}>{CONDITIONS.map((c) => <option key={c} value={c}>{TIRE_CONDITION_LABEL[c]}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected lifespan (km, optional)"><Input inputMode="numeric" value={f.expectedLifeKm} onChange={set('expectedLifeKm')} placeholder="Not set" /></Field>
          <Field label="Replace at tread (mm, optional)"><Input inputMode="decimal" value={f.replaceAtMm} onChange={set('replaceAtMm')} placeholder="Not set" /></Field>
        </div>
        <p className="text-xs text-muted">Both are your own figures and have no default. Without them Nexus shows remaining tire life as Unknown. Tire age alone is never treated as a safety measure.</p>
        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
        <Button variant="primary" disabled={saving} onClick={save}>{mode.kind === 'replace' ? 'Replace set' : 'Save'}</Button>
      </Body>
    </Modal>
  )
}

export function TreadModal({ tire, onClose }: { tire: TireSet; onClose: () => void }) {
  const { today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [depth, setDepth] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const save = () => { run(A.addTreadMeasurement(tire.id, { date: dateOrNull(date), depthMm: Number(depth), note }, today), onClose)}
  return (
    <Modal title="Record tread depth" onClose={onClose}>
      <Body>
        <p className="text-muted">{tire.manufacturer} {tire.model}. The vehicle’s current odometer is stored with the measurement.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tread depth (mm)"><Input inputMode="decimal" autoFocus value={depth} onChange={(e) => setDepth(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Note (e.g. position)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !depth} onClick={save}>Save measurement</Button>
      </Body>
    </Modal>
  )
}

export function RemoveTireModal({ tire, onClose }: { tire: TireSet; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const cur = latestOdometer(state, tire.vehicleId)
  const [date, setDate] = useState(today)
  const [odo, setOdo] = useState(cur ? String(cur.reading) : '')
  const save = () => { run(A.removeTireSet(tire.id, { date: dateOrNull(date), odometer: numOrNull(odo) }, today), onClose)}
  return (
    <Modal title="Remove tire set" onClose={onClose}>
      <Body>
        <p className="text-muted">Takes {tire.manufacturer} {tire.model} off without fitting another set. It stays in the tire history.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Removal date (optional)"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Removal odometer (km)"><Input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
        </div>
        <Button variant="primary" disabled={saving} onClick={save}>Remove set</Button>
      </Body>
    </Modal>
  )
}

/** Add an accessory to a vehicle, or edit its details. The accessory type names it, so there is no separate name to enter. */
export function AccessoryModal({ vehicle, accessory, onClose }: { vehicle: Vehicle; accessory?: Accessory; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const access = useAccess()
  const [f, setF] = useState({ typeId: accessory?.typeId ?? '', pendingType: '', name: accessory?.name ?? '', description: accessory?.description ?? '', specification: accessory?.specification ?? '', cost: accessory?.cost == null ? '' : String(accessory.cost), warranty: accessory?.warranty ?? '', notes: accessory?.notes ?? '', installDate: '', installOdometer: '' })
  const [adding, setAdding] = useState<string | null>(null)
  const [typeError, setTypeError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  // A type just created from this form is selected as soon as the saved directory contains it.
  const typeId = f.typeId || (f.pendingType ? findAccessoryType(state, f.pendingType)?.id ?? '' : '')
  const typeOptions: SelectOption[] = typesOf(state).filter((t) => !t.archived || t.id === accessory?.typeId).sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: t.id, label: t.archived ? `${t.name} (archived)` : t.name }))
  const canAddType = access.can('data.edit')
  const input = (): AccessoryInput => ({ typeId: typeId || null, name: f.name, description: f.description, specification: f.specification, cost: numOrNull(f.cost), warranty: f.warranty, notes: f.notes })
  const legacyUnlinked = !!accessory && accessory.typeId === null
  const [error, setError] = useState('')
  const save = () => {
    if (!typeId && !(legacyUnlinked && f.name.trim())) { setError('Choose an accessory type.'); return }
    setError('')
    const r = accessory ? A.updateAccessory(accessory.id, input()) : A.addAccessory(vehicle.id, input(), { date: dateOrNull(f.installDate), odometer: numOrNull(f.installOdometer) }, today)
    run(r, onClose)
  }
  const createType = async (name: string) => {
    setTypeError('')
    const err = await fleetStore.run(A.addAccessoryType(name))
    if (err !== null) { setTypeError(err); return }
    setF((x) => ({ ...x, typeId: '', pendingType: name }))
    setAdding(null)
  }
  return (
    <Modal title={accessory ? `Edit ${accessoryLabel(state, accessory)}` : `Add accessory · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <Field label="Accessory type *">
          <SearchSelect label="Accessory type" value={typeId} options={typeOptions} onChange={(v) => setF((x) => ({ ...x, typeId: v, pendingType: '' }))} placeholder="Search accessory types…"
            onCreate={canAddType ? (text) => { setTypeError(''); setAdding(text) } : undefined} createLabel={(t) => `Add new type “${t}”`} />
        </Field>
        {canAddType && adding === null && <button type="button" className="min-h-9 text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline phone:min-h-11" onClick={() => { setTypeError(''); setAdding('') }}>+ Add new type</button>}
        {adding !== null && (
          <form className="space-y-2 rounded-nx border border-line p-3" onSubmit={(e) => { e.preventDefault(); void createType(adding) }}>
            <Field label="New accessory type name *"><Input autoFocus value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. Tidy Tank" /></Field>
            {typeError && <p role="alert" className="text-status-bad">{typeError}</p>}
            <div className="flex gap-2"><Button variant="primary" type="submit" disabled={!adding.trim()}>Add type</Button><Button type="button" onClick={() => { setAdding(null); setTypeError('') }}>Cancel</Button></div>
          </form>
        )}
        {accessory && accessory.name && <Field label="Custom name (from earlier records)"><Input value={f.name} onChange={set('name')} /></Field>}
        <Field label="Description / details (optional)"><Input value={f.description} onChange={set('description')} placeholder="e.g. Aluminum fuel tank, 2 compartments" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacity / specification (optional)"><Input value={f.specification} onChange={set('specification')} placeholder="e.g. 500 L" /></Field>
          <Field label="Cost (optional)"><Input inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="Not recorded" /></Field>
        </div>
        <Field label="Warranty (optional)"><Input value={f.warranty} onChange={set('warranty')} placeholder="Not recorded" /></Field>
        {!accessory && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Installation date (optional)"><Input type="date" max={today} value={f.installDate} onChange={set('installDate')} /></Field>
            <Field label="Installation odometer (km, optional)"><Input inputMode="numeric" value={f.installOdometer} onChange={set('installOdometer')} /></Field>
          </div>
        )}
        <Field label="Notes (optional)"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
        {error && <p role="alert" className="text-status-bad">{error}</p>}
        <Button variant="primary" disabled={saving} onClick={save}>{accessory ? 'Save changes' : 'Add accessory'}</Button>
      </Body>
    </Modal>
  )
}

export type MoveMode = 'install-details' | 'remove' | 'transfer' | 'reinstall'

/** Fill in installation details, remove, transfer to another vehicle, or reinstall an accessory. Its record and history are always kept. */
export function AccessoryMoveModal({ vehicle, accessory, mode, onClose }: { vehicle: Vehicle; accessory: Accessory; mode: MoveMode; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const placement = accessory.placements.filter((p) => p.vehicleId === vehicle.id).at(-1)
  const cur = latestOdometer(state, vehicle.id)
  const [date, setDate] = useState(mode === 'install-details' ? placement?.installDate ?? '' : today)
  const [odo, setOdo] = useState(mode === 'install-details' ? (placement?.installOdometer == null ? '' : String(placement.installOdometer)) : cur ? String(cur.reading) : '')
  const [target, setTarget] = useState(mode === 'transfer' ? state.vehicles.find((v) => v.id !== vehicle.id)?.id ?? '' : vehicle.id)
  const [toOdo, setToOdo] = useState('')
  const [note, setNote] = useState('')
  const save = () => {
    const d = dateOrNull(date)
    const r = mode === 'install-details' ? A.updateInstallation(accessory.id, vehicle.id, { date: d, odometer: numOrNull(odo) }, today)
      : mode === 'remove' ? A.removeAccessory(accessory.id, { date: d, odometer: numOrNull(odo), note }, today)
      : mode === 'transfer' ? A.transferAccessory(accessory.id, target, { date: d, fromOdometer: numOrNull(odo), toOdometer: numOrNull(toOdo), note }, today)
      : A.installAccessory(accessory.id, target, { date: d, odometer: numOrNull(odo), note }, today)
    run(r, onClose)
  }
  const title = { 'install-details': 'Installation details', remove: 'Remove accessory', transfer: 'Transfer accessory', reinstall: 'Install accessory' }[mode]
  const others = state.vehicles.filter((v) => v.id !== vehicle.id)
  return (
    <Modal title={`${title} · ${accessoryLabel(state, accessory)}`} onClose={onClose}>
      <Body>
        {mode === 'transfer' && <p className="text-muted">The accessory moves to another vehicle. Its record and history stay together, and both vehicles keep their part of it.</p>}
        {mode === 'transfer' && (
          <Field label="Transfer to"><Select value={target} onChange={(e) => setTarget(e.target.value)}>{others.map((v) => <option key={v.id} value={v.id}>{v.unitNumber} · {vehicleTitle(v)}</option>)}</Select></Field>
        )}
        {mode === 'reinstall' && (
          <Field label="Install on"><Select value={target} onChange={(e) => setTarget(e.target.value)}>{state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber} · {vehicleTitle(v)}</option>)}</Select></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={mode === 'install-details' || mode === 'reinstall' ? 'Installation date (optional)' : 'Date (optional)'}><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={mode === 'transfer' ? `Odometer on ${vehicle.unitNumber} (km)` : 'Odometer (km)'}><Input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
        </div>
        {mode === 'transfer' && <Field label="Odometer on the receiving vehicle (km)"><Input inputMode="numeric" value={toOdo} onChange={(e) => setToOdo(e.target.value)} /></Field>}
        {mode !== 'install-details' && <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        <Button variant="primary" disabled={saving} onClick={save}>{mode === 'install-details' ? 'Save' : title}</Button>
      </Body>
    </Modal>
  )
}

const RATINGS: RatedCondition[] = ['good', 'fair', 'poor', 'out-of-service']
export function ReviewModal({ inspection, onClose }: { inspection: InspectionRecord; onClose: () => void }) {
  const { today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [by, setBy] = useState('')
  const [note, setNote] = useState('')
  const [condition, setCondition] = useState<RatedCondition | ''>('')
  const save = () => { run(reviewInspection(inspection.id, { reviewedBy: by, note, condition: condition || null }, today), onClose)}
  return (
    <Modal title="Review inspection" onClose={onClose}>
      <Body>
        <p className="text-muted">Reviewing marks the submission as seen. Setting a condition is optional; defects are not closed by a review and are resolved separately.</p>
        <Field label="Reviewed by"><Input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
        <Field label="Condition (optional)"><Select value={condition} onChange={(e) => setCondition(e.target.value as RatedCondition | '')}><option value="">Not stated</option>{RATINGS.map((r) => <option key={r} value={r}>{r === 'out-of-service' ? 'Out of service' : r[0].toUpperCase() + r.slice(1)}</option>)}</Select></Field>
        <Field label="Review note"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving} onClick={save}>Mark reviewed</Button>
      </Body>
    </Modal>
  )
}
