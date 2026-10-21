import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { recordOdometer, reviewInspection, setServiceTarget, submitInspection } from './actions'
import { latestOdometer, odometerHistory, serviceStatus } from './selectors'
import { useFleet, useFleetRun } from './store'
import type { InspectionRecord, RatedCondition, Vehicle } from './types'

const Body = ({ children }: { children: React.ReactNode }) => <div className="space-y-4 p-6 text-[13px]">{children}</div>

export function OdometerModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state, today } = useFleet()
  const run = useFleetRun()
  const [date, setDate] = useState(today)
  const [reading, setReading] = useState('')
  const [note, setNote] = useState('')
  const [corrects, setCorrects] = useState('')
  const latest = latestOdometer(state, vehicle.id)
  const history = odometerHistory(state, vehicle.id).filter((r) => r.review !== 'rejected').slice(-8).reverse()
  const save = () => { if (run(recordOdometer(vehicle.id, { date, reading: Number(reading), note, correctsId: corrects || null }, today)) === null) onClose() }
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
        <Button variant="primary" disabled={!reading} onClick={save}>Save reading</Button>
      </Body>
    </Modal>
  )
}

export function InspectionModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { today } = useFleet()
  const run = useFleetRun()
  const [date, setDate] = useState(today)
  const [by, setBy] = useState('')
  const [notes, setNotes] = useState('')
  const [defects, setDefects] = useState('')
  const save = () => { if (run(submitInspection(vehicle.id, { date, submittedBy: by, notes, defects: defects.split('\n') }, today)) === null) onClose() }
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
        <Button variant="primary" onClick={save}>Submit inspection</Button>
      </Body>
    </Modal>
  )
}

export function ServiceModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { state, today } = useFleet()
  const run = useFleetRun()
  const s = serviceStatus(state, vehicle.id)
  const [value, setValue] = useState(s.target ? String(s.target.odometer) : '')
  const [note, setNote] = useState('')
  const save = () => { if (run(setServiceTarget(vehicle.id, Number(value), note, today)) === null) onClose() }
  return (
    <Modal title={`Next service · ${vehicle.unitNumber}`} onClose={onClose}>
      <Body>
        <p className="text-muted">Enter the odometer reading at which the next scheduled service falls due. KM remaining is calculated from the latest valid reading; nothing is estimated.</p>
        <Field label="Next service at (km)"><Input inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={!value} onClick={save}>Save</Button>
      </Body>
    </Modal>
  )
}

const RATINGS: RatedCondition[] = ['good', 'fair', 'poor', 'out-of-service']
export function ReviewModal({ inspection, onClose }: { inspection: InspectionRecord; onClose: () => void }) {
  const { today } = useFleet()
  const run = useFleetRun()
  const [by, setBy] = useState('')
  const [note, setNote] = useState('')
  const [condition, setCondition] = useState<RatedCondition | ''>('')
  const save = () => { if (run(reviewInspection(inspection.id, { reviewedBy: by, note, condition: condition || null }, today)) === null) onClose() }
  return (
    <Modal title="Review inspection" onClose={onClose}>
      <Body>
        <p className="text-muted">Reviewing marks the submission as seen. Setting a condition is optional; defects are not closed by a review and are resolved separately.</p>
        <Field label="Reviewed by"><Input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
        <Field label="Condition (optional)"><Select value={condition} onChange={(e) => setCondition(e.target.value as RatedCondition | '')}><option value="">Not stated</option>{RATINGS.map((r) => <option key={r} value={r}>{r === 'out-of-service' ? 'Out of service' : r[0].toUpperCase() + r.slice(1)}</option>)}</Select></Field>
        <Field label="Review note"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" onClick={save}>Mark reviewed</Button>
      </Body>
    </Modal>
  )
}
