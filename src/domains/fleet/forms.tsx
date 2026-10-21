import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import * as A from './commands'
import type { AccessoryInput, TireInput } from './actions'
import { recordOdometer, reviewInspection, setServiceTarget, submitInspection } from './commands'
import { activeTireSet, ACCESSORY_CATEGORY_LABEL, currentOilTarget, latestOdometer, odometerHistory, serviceStatus, TIRE_CLASS_LABEL, TIRE_CONDITION_LABEL, vehicleTitle } from './selectors'
import { useFleet, useFleetCommand } from './store'
import type { Accessory, AccessoryCategory, InspectionRecord, RatedCondition, Studded, TireClass, TireCondition, TireSet, Vehicle } from './types'

const Body = ({ children }: { children: React.ReactNode }) => <div className="space-y-4 p-6 text-[13px]">{children}</div>

export function OdometerModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [date, setDate] = useState(today)
  const [reading, setReading] = useState('')
  const [note, setNote] = useState('')
  const [corrects, setCorrects] = useState('')
  const latest = latestOdometer(state, vehicle.id)
  const history = odometerHistory(state, vehicle.id).filter((r) => r.review !== 'rejected').slice(-8).reverse()
  const save = () => { run(recordOdometer(vehicle.id, { date, reading: Number(reading), note, correctsId: corrects || null }, today), onClose)}
  return (
    <Modal title={`Record odometer · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">{latest ? `Current mileage ${latest.reading.toLocaleString('en-CA')} km (${latest.date}).` : 'No reading recorded yet.'} A reading lower than an earlier one, or higher than a later one, is saved but held for review; it will not change the current mileage until someone accepts it.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reading (km)"><Input inputMode="numeric" autoFocus value={reading} onChange={(e) => setReading(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="This corrects an earlier reading (optional)">
          <Select value={corrects} onChange={(e) => setCorrects(e.target.value)}><option value="">No — this is a new reading</option>{history.map((r) => <option key={r.id} value={r.id}>{r.date} · {r.reading.toLocaleString('en-CA')} km</option>)}</Select>
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !reading} onClick={save}>Save reading</Button>
      </Body>
    </Modal>
  )
}

export function InspectionModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [date, setDate] = useState(today)
  const [by, setBy] = useState('')
  const [notes, setNotes] = useState('')
  const [defects, setDefects] = useState('')
  const save = () => { run(submitInspection(vehicle.id, { date, submittedBy: by, notes, defects: defects.split('\n') }, today), onClose)}
  return (
    <Modal title={`Weekly inspection · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">Submitting records that the inspection was done. It does not state the vehicle is sound: a reviewer sets the condition, and every defect listed stays outstanding until it is resolved.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inspection date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Submitted by"><Input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
        </div>
        <Field label="Defects found (one per line)"><Textarea rows={4} value={defects} onChange={(e) => setDefects(e.target.value)} placeholder="Leave empty if none were found" /></Field>
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving} onClick={save}>Submit inspection</Button>
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
  const s = oil ? { target: currentOilTarget(state, vehicle.id) } : serviceStatus(state, vehicle.id)
  const [value, setValue] = useState(s.target ? String(s.target.odometer) : '')
  const [type, setType] = useState(oil ? 'Oil change' : s.target?.serviceType ?? '')
  const [warn, setWarn] = useState(s.target?.warnWithinKm ? String(s.target.warnWithinKm) : '')
  const [note, setNote] = useState('')
  const save = () => { run(setServiceTarget(vehicle.id, Number(value), note, today, { serviceType: type, warnWithinKm: numOrNull(warn) }), onClose)}
  return (
    <Modal title={`${oil ? 'Next oil change' : 'Next service'} · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">{oil ? 'Enter the odometer reading at which the next oil change falls due. The interval percentage is shown only when the last oil change was recorded with its odometer.' : 'Enter the odometer reading at which the next scheduled service falls due. KM remaining is calculated from the latest valid reading. The service type is optional and is not assumed. Oil changes are scheduled separately.'}</p>
        <Field label={oil ? 'Next oil change at (km)' : 'Next service at (km)'}><Input inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        {!oil && <Field label="Service type (optional)"><Input list="service-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="Not specified" /></Field>}
        {!oil && <datalist id="service-types">{SERVICE_TYPES.filter((t) => t !== 'Oil change').map((t) => <option key={t} value={t} />)}</datalist>}
        <Field label="Highlight as due soon within (km, optional)"><Input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} placeholder="No warning window" /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !value} onClick={save}>Save</Button>
      </Body>
    </Modal>
  )
}

export function MaintenanceModal({ vehicle, presetType = '', onClose }: { vehicle: Vehicle; presetType?: string; onClose: () => void }) {
  const { today } = useFleet()
  const { run, saving } = useFleetCommand()
  const [date, setDate] = useState(today)
  const [type, setType] = useState(presetType)
  const [odo, setOdo] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const save = () => { run(A.recordMaintenance(vehicle.id, { date, serviceType: type, odometer: numOrNull(odo), description, notes }, today), onClose)}
  return (
    <Modal title={`Record maintenance · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">Records work that has been completed. A service threshold alone is never shown as done.</p>
        <Field label="Service type"><Input list="service-types" autoFocus value={type} onChange={(e) => setType(e.target.value)} /></Field>
        <datalist id="service-types">{SERVICE_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Odometer (km, optional)"><Input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
        </div>
        <Field label="Work done"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !type.trim()} onClick={save}>Save record</Button>
      </Body>
    </Modal>
  )
}

export function VehicleEditModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { run, saving } = useFleetCommand()
  const [f, setF] = useState({ unitNumber: vehicle.unitNumber, year: String(vehicle.year), make: vehicle.make, model: vehicle.model, vin: vehicle.vin ?? '', licencePlate: vehicle.licencePlate ?? '', notes: vehicle.notes })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = () => { run(A.updateVehicle(vehicle.id, { ...f, year: Number(f.year) }), onClose)}
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
        <Button variant="primary" disabled={saving} onClick={save}>Save changes</Button>
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

const CATEGORIES: AccessoryCategory[] = ['tidy-tank', 'light-bar', 'job-box', 'headache-rack', 'radio', 'other']

/** Add an accessory to a vehicle, or edit its details. */
export function AccessoryModal({ vehicle, accessory, onClose }: { vehicle: Vehicle; accessory?: Accessory; onClose: () => void }) {
  const { state, today } = useFleet()
  const { run, saving } = useFleetCommand()
  const cur = latestOdometer(state, vehicle.id)
  const [f, setF] = useState({ name: accessory?.name ?? '', category: (accessory?.category ?? 'other') as AccessoryCategory, description: accessory?.description ?? '', specification: accessory?.specification ?? '', cost: accessory?.cost == null ? '' : String(accessory.cost), warranty: accessory?.warranty ?? '', notes: accessory?.notes ?? '', installDate: '', installOdometer: cur ? String(cur.reading) : '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const input = (): AccessoryInput => ({ name: f.name, category: f.category, description: f.description, specification: f.specification, cost: numOrNull(f.cost), warranty: f.warranty, notes: f.notes })
  const save = () => {
    const r = accessory ? A.updateAccessory(accessory.id, input()) : A.addAccessory(vehicle.id, input(), { date: dateOrNull(f.installDate), odometer: numOrNull(f.installOdometer) }, today)
    run(r, onClose)
  }
  return (
    <Modal title={accessory ? `Edit ${accessory.name}` : `Add accessory · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
          <Field label="Type"><Select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{ACCESSORY_CATEGORY_LABEL[c]}</option>)}</Select></Field>
        </div>
        <Field label="Description"><Input value={f.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Specification / capacity"><Input value={f.specification} onChange={set('specification')} placeholder="e.g. 750 L" /></Field>
          <Field label="Cost (if known)"><Input inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="Not recorded" /></Field>
        </div>
        <Field label="Warranty"><Input value={f.warranty} onChange={set('warranty')} placeholder="Not recorded" /></Field>
        {!accessory && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Installation date (optional)"><Input type="date" max={today} value={f.installDate} onChange={set('installDate')} /></Field>
            <Field label="Installation odometer (km)"><Input inputMode="numeric" value={f.installOdometer} onChange={set('installOdometer')} /></Field>
          </div>
        )}
        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
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
    <Modal title={`${title} · ${accessory.name}`} onClose={onClose}>
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
