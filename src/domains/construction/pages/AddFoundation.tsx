import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useIsServer } from '@/lib/dataSource'
import { createFoundation } from '../commands'
import { useConstruction, useConstructionCommand } from '../store'

/**
 * Adds a foundation (and its plinths) to the saved register. Every activity starts as "not started": adding a foundation records
 * that it exists, never that any work has been done. Only offered with saved data; the demonstration register is fixed.
 */
export function AddFoundationButton({ projectId, areaId }: { projectId: string; areaId?: string }) {
  const server = useIsServer()
  const [open, setOpen] = useState(false)
  if (!server) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add foundation</Button>
      {open && <AddFoundationModal projectId={projectId} areaId={areaId} onClose={() => setOpen(false)} />}
    </>
  )
}

function AddFoundationModal({ projectId, areaId, onClose }: { projectId: string; areaId?: string; onClose: () => void }) {
  const { state } = useConstruction()
  const { run, saving } = useConstructionCommand()
  const areas = state.areas.filter((a) => a.projectId === projectId)
  const [area, setArea] = useState(areaId ?? areas[0]?.id ?? '')
  const [number, setNumber] = useState('')
  const [description, setDescription] = useState('')
  const [plinths, setPlinths] = useState('1')
  const save = () => run(createFoundation(area, number, description, Number(plinths)), onClose)
  return (
    <Modal title="Add foundation" onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Adds the foundation and its plinths to the register. Nothing is marked as started or complete.</p>
        {!areaId && <Field label="Area"><Select value={area} onChange={(e) => setArea(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Foundation number"><Input autoFocus value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 21-03" /></Field>
          <Field label="Number of plinths"><Input inputMode="numeric" value={plinths} onChange={(e) => setPlinths(e.target.value)} /></Field>
        </div>
        <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Button variant="primary" disabled={saving || !number.trim()} onClick={save}>{saving ? 'Saving…' : 'Add foundation'}</Button>
      </div>
    </Modal>
  )
}
