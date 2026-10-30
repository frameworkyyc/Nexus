import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { addVehicle } from './commands'
import { fleetPaths } from './paths'
import { fleetStore, useFleet, useFleetCommand, useProjectRegistry } from './store'

/** Add a vehicle or piece of equipment to the organization's fleet, optionally assigning it to a project. Editors and administrators. */
export function AddAssetButton({ projectId, label = 'Add vehicle or equipment', variant = 'primary' }: { projectId?: string; label?: string; variant?: 'primary' | 'secondary' }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('data.edit')) return null
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />{label}</Button>
      {open && <AddAsset projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  )
}

function AddAsset({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { today } = useFleet()
  const registry = useProjectRegistry()
  const { run, saving } = useFleetCommand()
  const [v, setV] = useState({ unitNumber: '', kind: 'vehicle' as 'vehicle' | 'equipment', year: String(new Date().getFullYear()), make: '', model: '', vin: '', licencePlate: '', notes: '', project: projectId ?? '', meter: 'km' as 'km' | 'h' })
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const save = () => run(addVehicle({ unitNumber: v.unitNumber, kind: v.kind, year: Number(v.year), make: v.make, model: v.model, vin: v.vin, licencePlate: v.licencePlate, notes: v.notes, meterUnit: v.meter }, v.project || null, today), () => {
    const made = fleetStore.get().vehicles.find((x) => x.unitNumber.toLowerCase() === v.unitNumber.trim().toLowerCase())
    onClose()
    if (made) navigate(projectId ? fleetPaths.projectVehicle(projectId, made.id) : fleetPaths.orgVehicle(made.id))
  })
  const ok = v.unitNumber.trim() && v.make.trim() && v.model.trim() && v.year.trim()
  return (
    <Modal title="Add vehicle or equipment" onClose={onClose}>
      <form className="space-y-4 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); if (ok) save() }}>
        <p className="text-muted">It starts with no odometer, inspections or maintenance: nothing is assumed. Record those from the asset’s page.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Unit number *"><Input autoFocus value={v.unitNumber} onChange={(e) => set({ unitNumber: e.target.value })} /></Field>
          <Field label="Type"><Select aria-label="Type" value={v.kind} onChange={(e) => set({ kind: e.target.value as 'vehicle' | 'equipment', meter: e.target.value === 'equipment' ? 'h' : 'km' })}><option value="vehicle">Vehicle</option><option value="equipment">Equipment</option></Select></Field>
          <Field label="Meter counts"><Select aria-label="Meter counts" value={v.meter} onChange={(e) => set({ meter: e.target.value as 'km' | 'h' })}><option value="km">Kilometres (odometer)</option><option value="h">Operating hours</option></Select></Field>
          <Field label="Make *"><Input value={v.make} onChange={(e) => set({ make: e.target.value })} /></Field>
          <Field label="Model *"><Input value={v.model} onChange={(e) => set({ model: e.target.value })} /></Field>
          <Field label="Year *"><Input inputMode="numeric" value={v.year} onChange={(e) => set({ year: e.target.value })} /></Field>
          <Field label="Assign to project"><Select aria-label="Assign to project" value={v.project} onChange={(e) => set({ project: e.target.value })}><option value="">Not assigned</option>{registry.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="VIN / serial (optional)"><Input value={v.vin} onChange={(e) => set({ vin: e.target.value })} /></Field>
          <Field label="Licence plate (optional)"><Input value={v.licencePlate} onChange={(e) => set({ licencePlate: e.target.value })} /></Field>
        </div>
        <Field label="Notes (optional)"><Textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div className="flex gap-2"><Button variant="primary" type="submit" disabled={saving || !ok}>{saving ? 'Saving…' : 'Add'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}
