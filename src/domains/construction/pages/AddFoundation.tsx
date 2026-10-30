import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { archiveFoundation, createArea, createFoundation, editFoundation, renameFoundation } from '../commands'
import { useConstruction, useConstructionCommand, constructionStore } from '../store'
import type { Foundation } from '../types'

/**
 * Adds a foundation (and its plinths) to an area's register. Every activity starts as "not started": adding a foundation records that it
 * exists, never that any work has been done. Administrators only; this is the one place foundations are created — the Materials form
 * can only pick from them.
 */
export function AddFoundationButton({ projectId, areaId }: { projectId: string; areaId?: string }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('foundations.manage')) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />Add foundation</Button>
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
        <p className="text-muted">Adds the foundation and its plinths to the register. Nothing is marked as started or complete. A number already used in the area (even by an archived foundation) is refused.</p>
        {!areaId && <Field label="Area"><Select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
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

/** Sets up a new construction area together with its foundations. Administrators only. */
export function AddAreaButton({ projectId }: { projectId: string }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('foundations.manage')) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />Add area</Button>
      {open && <AddAreaModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  )
}

interface DraftFoundation { number: string; description: string; plinths: string }
function AddAreaModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { run, saving } = useConstructionCommand()
  const [name, setName] = useState('')
  const [rows, setRows] = useState<DraftFoundation[]>([{ number: '', description: '', plinths: '1' }])
  const used = rows.filter((r) => r.number.trim() || r.description.trim())
  const save = () => run(createArea(projectId, name, used.map((r) => ({ number: r.number, description: r.description, plinthCount: Number(r.plinths) }))), onClose)
  const set = (i: number, patch: Partial<DraftFoundation>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Modal title="Add construction area" onClose={onClose} wide>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Define the area and its foundations together. More foundations can be added later from the Foundation Register. Nothing is marked as started.</p>
        <Field label="Area name *"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Control Building" /></Field>
        <div className="space-y-2">
          <p className="t-label">Foundations</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] items-end gap-2 phone:grid-cols-2">
              <Field label="Number"><Input aria-label={`Foundation ${i + 1} number`} value={r.number} onChange={(e) => set(i, { number: e.target.value })} placeholder="e.g. 61-01" /></Field>
              <Field label="Description"><Input aria-label={`Foundation ${i + 1} description`} value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></Field>
              <Field label="Plinths"><Input aria-label={`Foundation ${i + 1} plinths`} inputMode="numeric" value={r.plinths} onChange={(e) => set(i, { plinths: e.target.value })} /></Field>
              <Button variant="ghost" aria-label={`Remove foundation ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} strokeWidth={1.5} /></Button>
            </div>
          ))}
          <Button onClick={() => setRows([...rows, { number: '', description: '', plinths: '1' }])}><Plus size={14} strokeWidth={1.5} />Add another foundation</Button>
        </div>
        <Button variant="primary" disabled={saving || !name.trim()} onClick={save}>{saving ? 'Saving…' : 'Create area'}</Button>
      </div>
    </Modal>
  )
}

/** Rename, edit, archive or restore one foundation. Administrators only. Its id, plinths and every record pointing at it are unaffected. */
export function ManageFoundationButton({ foundation }: { foundation: Foundation }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('foundations.manage')) return null
  return (
    <>
      <Button variant="ghost" className="h-8 px-2 text-xs" aria-label={`Manage foundation ${foundation.number}`} onClick={() => setOpen(true)}>Manage</Button>
      {open && <ManageFoundationModal id={foundation.id} onClose={() => setOpen(false)} />}
    </>
  )
}

function ManageFoundationModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useConstruction()
  const f = state.foundations.find((x) => x.id === id)
  const [number, setNumber] = useState(f?.number ?? '')
  const [description, setDescription] = useState(f?.description ?? '')
  const [notes, setNotes] = useState(f?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!f) return null
  const go = async (steps: (() => Promise<string | null>)[], close = false) => {
    setSaving(true); setError(null)
    for (const step of steps) { const e = await step(); if (e) { setError(e); setSaving(false); return } }
    setSaving(false)
    if (close) onClose()
  }
  const changed = number.trim() !== f.number || description !== f.description || notes !== f.notes
  const save = () => go([
    ...(number.trim() !== f.number ? [() => constructionStore.run(renameFoundation(id, number))] : []),
    ...(description !== f.description || notes !== f.notes ? [() => constructionStore.run(editFoundation(id, { description, notes }))] : []),
  ], true)
  return (
    <Modal title={`Foundation ${f.number}`} onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        {f.archived && <p role="status" className="border-l-2 border-warn pl-3">Archived: hidden from pickers and the default register view. Every record keeps pointing at it.</p>}
        <p className="text-muted">Renaming changes the number shown everywhere. Materials, survey and QA/QC records are tied to the foundation itself, so none of them are affected.</p>
        <Field label="Foundation number"><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={saving || !changed || !number.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button disabled={saving} onClick={() => { if (f.archived || window.confirm(`Archive foundation ${f.number}? It is hidden from pickers and the default register view; nothing is deleted.`)) void go([() => constructionStore.run(archiveFoundation(id, !f.archived))]) }}>{f.archived ? 'Restore' : 'Archive'}</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
