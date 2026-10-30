import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { foundationConcrete } from '../concrete'
import { foundationQuantity } from '../foundationQuantity'
import { addFoundations, archiveArea, archiveFoundation, configureFoundation, createArea, createFoundation, editArea, editFoundation, renameFoundation } from '../commands'
import type { FoundationConfig } from '../configActions'
import { configFromDraft, draftFromFoundation, FoundationConfigFields, type ConfigDraft } from './FoundationConfigFields'
import { useConstruction, useConstructionCommand, constructionStore } from '../store'
import type { ConstructionState, Foundation } from '../types'

/** Quantity text → number; blank means the default of 1. */
export const parseQuantity = (t: string) => (t.trim() === '' ? 1 : Number(t))
/** Plinths-per-foundation text → number; blank means not known (never zero). */
export const parsePlinths = (t: string) => (t.trim() === '' ? null : Number(t))
/** "Total plinths" shown live while typing: quantity × plinths per foundation, or why it can't be calculated. */
export function totalText(qty: string, per: string): string {
  const q = parseQuantity(qty), p = parsePlinths(per)
  if (!Number.isInteger(q) || q < 1) return 'Enter a quantity of 1 or more'
  if (p === null) return 'Not known — enter plinths per foundation'
  if (!Number.isInteger(p) || p < 0) return 'Enter plinths per foundation as a whole number'
  return (q * p).toLocaleString('en-CA')
}

/** Runs a configuration against the current records (without saving) to show the concrete it would give, or why it cannot be applied. */
function previewOf(draft: ConfigDraft, run: (cfg: FoundationConfig) => { state?: ConstructionState; error?: string }, pick: (s: ConstructionState) => Foundation | undefined) {
  const cfg = configFromDraft(draft)
  if ('error' in cfg) return cfg.error
  if (!cfg.config.footing && (cfg.config.groups ?? []).every((g) => !g.dims)) return null
  const r = run(cfg.config)
  if (r.error !== undefined || !r.state) return r.error ?? null
  const f = pick(r.state)
  return f ? foundationConcrete(f, r.state.plinths, (r.state.anchorageGroups ?? []).filter((g) => g.foundationId === f.id)) : null
}

/**
 * Adds a foundation (and its plinths) to an area's register. Every activity starts as "not started": adding a foundation records that it
 * exists, never that any work has been done. Administrators only; this is the one place foundations are created — the Materials form
 * can only pick from them.
 */
export function AddFoundationButton({ projectId, areaId }: { projectId: string; areaId?: string }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('structure.manage')) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />Add foundations</Button>
      {open && <AddFoundationModal projectId={projectId} areaId={areaId} onClose={() => setOpen(false)} />}
    </>
  )
}

function AddFoundationModal({ projectId, areaId, onClose }: { projectId: string; areaId?: string; onClose: () => void }) {
  const { state } = useConstruction()
  const { run, saving } = useConstructionCommand()
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived)
  const [area, setArea] = useState(areaId ?? areas[0]?.id ?? '')
  const [mode, setMode] = useState<'one' | 'many'>('one')
  const [number, setNumber] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState<ConfigDraft>({ footing: { length: '', width: '', height: '', unit: 'mm' }, plinthBase: 'above-footing', groups: [] })
  const [bulk, setBulk] = useState('')
  const types = state.anchorageTypes.filter((t) => t.projectId === projectId)
  const [problem, setProblem] = useState('')
  // One designation per line: "name, quantity, plinths per foundation, description" (everything after the name is optional).
  const parsed = bulk.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [n, q, p, ...d] = l.split(/\t|,/).map((x) => x.trim()); return { number: n ?? '', quantity: parseQuantity(q ?? ''), plinthCount: parsePlinths(p ?? ''), description: d.join(', ') } })
  const save = () => {
    if (mode === 'many') return run(addFoundations(area, parsed), onClose)
    const cfg = configFromDraft(draft)
    if ('error' in cfg) { setProblem(cfg.error); return }
    setProblem('')
    // No anchorage groups entered = plinth count not known (nothing is assumed).
    return run(createFoundation(area, number, description, null, parseQuantity(quantity), { ...cfg.config, ...(cfg.config.groups?.length ? {} : { groups: undefined }) }), onClose)
  }
  const q = parseQuantity(quantity)
  const preview = mode === 'one' ? previewOf(draft, (cfg) => createFoundation(area, 'ZZ-PREVIEW', '', null, Number.isInteger(q) && q >= 1 ? q : 1, cfg)(state), (st) => st.foundations.find((f) => f.number === 'ZZ-PREVIEW')) : null
  return (
    <Modal title="Add foundations" onClose={onClose} wide>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Each entry is a foundation name that may stand for several identical foundations (its quantity). Nothing is marked as started or complete. A name already used in the area (even by an archived foundation) is refused.</p>
        {!areaId && <Field label="Area"><Select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        <div className="flex gap-1" role="group" aria-label="How many">
          {(['one', 'many'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-nx px-3 py-1.5 transition-colors phone:h-11 ${mode === m ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink'}`}>{m === 'one' ? 'One foundation name' : 'Several at once'}</button>)}
        </div>
        {mode === 'one' ? (
          <>
            <Field label="Foundation Name *"><Input autoFocus value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. FND-101" /></Field>
            <Field label="Foundation Quantity"><Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
            <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <FoundationConfigFields draft={draft} onChange={setDraft} types={types} quantity={Number.isInteger(q) && q >= 1 ? q : 1} preview={preview} />
            {problem && <p role="alert" className="border-l-2 border-bad pl-3">{problem}</p>}
          </>
        ) : (
          <Field label="One per line: name, quantity, plinths per foundation, description"><Textarea autoFocus rows={7} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'FND-101, 18, 4, Pump pad\nFND-102, 6, 4\nFND-103, 2'} /></Field>
        )}
        {mode === 'many' && <p className="text-xs text-muted">{parsed.length} name{parsed.length === 1 ? '' : 's'} ready · {parsed.reduce((n, r) => n + (Number.isInteger(r.quantity) && r.quantity > 0 ? r.quantity : 0), 0).toLocaleString('en-CA')} physical foundations. Leave quantity blank for 1 and plinths blank if not known. Paste from a spreadsheet if you like (tab-separated works too). Either all are added or none.</p>}
        <Button variant="primary" disabled={saving || (mode === 'one' ? !number.trim() : parsed.length === 0)} onClick={save}>{saving ? 'Saving…' : mode === 'one' ? 'Add foundation' : `Add ${parsed.length} foundation name${parsed.length === 1 ? '' : 's'}`}</Button>
      </div>
    </Modal>
  )
}

/** Sets up a new construction area together with its foundations. Administrators only. */
export function AddAreaButton({ projectId }: { projectId: string }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('structure.manage')) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />Add area</Button>
      {open && <AddAreaModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Rename, describe, archive or restore an area. Administrators only. */
export function ManageAreaButton({ areaId }: { areaId: string }) {
  const access = useAccess()
  const [open, setOpen] = useState(false)
  if (!access.can('structure.manage')) return null
  return (
    <>
      <Button onClick={() => setOpen(true)}>Manage area</Button>
      {open && <ManageAreaModal areaId={areaId} onClose={() => setOpen(false)} />}
    </>
  )
}
function ManageAreaModal({ areaId, onClose }: { areaId: string; onClose: () => void }) {
  const { state } = useConstruction()
  const a = state.areas.find((x) => x.id === areaId)
  const [name, setName] = useState(a?.name ?? '')
  const [identifier, setIdentifier] = useState(a?.identifier ?? '')
  const [description, setDescription] = useState(a?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!a) return null
  const go = async (p: Promise<string | null>, close: boolean) => { setSaving(true); const e = await p; setSaving(false); setError(e); if (!e && close) onClose() }
  return (
    <Modal title={`Area · ${a.name}`} onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        {a.archived && <p role="status" className="border-l-2 border-warn pl-3">Archived: hidden from pickers and lists. Its foundations and every record pointing at it are kept.</p>}
        <Field label="Area name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Identifier (optional)"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. A-100" /></Field>
        <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <p className="text-xs text-muted">Renaming never affects foundations, materials or other records: they point at the area itself.</p>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={saving || !name.trim()} onClick={() => void go(constructionStore.run(editArea(areaId, { name, identifier, description })), true)}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button disabled={saving} onClick={() => { if (a.archived || window.confirm(`Archive ${a.name}? It is hidden from pickers and lists; nothing is deleted.`)) void go(constructionStore.run(archiveArea(areaId, !a.archived)), false) }}>{a.archived ? 'Restore' : 'Archive'}</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

interface DraftFoundation { number: string; quantity: string; description: string; plinths: string }
function AddAreaModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { run, saving } = useConstructionCommand()
  const [name, setName] = useState('')
  const [rows, setRows] = useState<DraftFoundation[]>([{ number: '', quantity: '1', description: '', plinths: '' }])
  const [identifier, setIdentifier] = useState('')
  const used = rows.filter((r) => r.number.trim() || r.description.trim())
  const save = () => run(createArea(projectId, name, used.map((r) => ({ number: r.number, description: r.description, plinthCount: parsePlinths(r.plinths), quantity: parseQuantity(r.quantity) })), { identifier }), onClose)
  const set = (i: number, patch: Partial<DraftFoundation>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Modal title="Add construction area" onClose={onClose} wide>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Define the area and its foundations together. More foundations can be added later from the Foundation Register. Nothing is marked as started.</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Area name *"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Control Building" /></Field>
          <Field label="Identifier (optional)"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. A-100" /></Field>
        </div>
        <div className="space-y-2">
          <p className="t-label">Foundations</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_4.5rem_6rem_1.4fr_auto] items-end gap-2 phone:grid-cols-2">
              <Field label="Foundation Name"><Input aria-label={`Foundation ${i + 1} name`} value={r.number} onChange={(e) => set(i, { number: e.target.value })} placeholder="e.g. FND-101" /></Field>
              <Field label="Quantity"><Input aria-label={`Foundation ${i + 1} quantity`} inputMode="numeric" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></Field>
              <Field label="Plinths each"><Input aria-label={`Foundation ${i + 1} plinths per foundation`} inputMode="numeric" value={r.plinths} onChange={(e) => set(i, { plinths: e.target.value })} placeholder="Not known" /></Field>
              <Field label="Description"><Input aria-label={`Foundation ${i + 1} description`} value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></Field>
              <Button variant="ghost" aria-label={`Remove foundation ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} strokeWidth={1.5} /></Button>
            </div>
          ))}
          <Button onClick={() => setRows([...rows, { number: '', quantity: '1', description: '', plinths: '' }])}><Plus size={14} strokeWidth={1.5} />Add another foundation</Button>
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
  if (!access.can('structure.manage')) return null
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
  const [quantity, setQuantity] = useState(String(f ? foundationQuantity(f) : 1))
  const [draft, setDraft] = useState<ConfigDraft | null>(() => (f ? draftFromFoundation(f, state.plinths, (state.anchorageGroups ?? []).filter((g) => g.foundationId === f.id)) : null))
  const original = f && draftFromFoundation(f, state.plinths, (state.anchorageGroups ?? []).filter((g) => g.foundationId === f.id))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!f || !draft) return null
  const project = state.areas.find((a) => a.id === f.areaId)?.projectId
  const types = state.anchorageTypes.filter((t) => t.projectId === project)
  const go = async (steps: (() => Promise<string | null>)[], close = false) => {
    setSaving(true); setError(null)
    for (const step of steps) { const e = await step(); if (e) { setError(e); setSaving(false); return } }
    setSaving(false)
    if (close) onClose()
  }
  const q = parseQuantity(quantity)
  const qtyChanged = q !== foundationQuantity(f)
  const configChanged = JSON.stringify(draft) !== JSON.stringify(original)
  const changed = number.trim() !== f.number || description !== f.description || notes !== f.notes || qtyChanged || configChanged
  const preview = previewOf(draft, (cfg) => configureFoundation(id, { ...cfg, quantity: Number.isInteger(q) && q >= 1 ? q : foundationQuantity(f) })(state), (st) => st.foundations.find((x) => x.id === id))
  const save = () => {
    const cfg = configFromDraft(draft)
    if ('error' in cfg) { setError(cfg.error); return Promise.resolve() }
    return go([
      ...(number.trim() !== f.number ? [() => constructionStore.run(renameFoundation(id, number))] : []),
      ...(notes !== f.notes ? [() => constructionStore.run(editFoundation(id, { notes }))] : []),
      ...(description !== f.description || qtyChanged || configChanged ? [() => constructionStore.run(configureFoundation(id, { description, ...(qtyChanged ? { quantity: q } : {}), ...(configChanged ? cfg.config : {}) }))] : []),
    ], true)
  }
  return (
    <Modal title={`Foundation ${f.number}`} onClose={onClose} wide>
      <div className="space-y-4 p-6 text-[13px]">
        {f.archived && <p role="status" className="border-l-2 border-warn pl-3">Archived: hidden from pickers and the default register view. Every record keeps pointing at it.</p>}
        <p className="text-muted">Renaming changes the name shown everywhere. Materials, survey and QA/QC records are tied to the foundation itself, so none of them are affected. Changing the quantity never changes material quantities.</p>
        <Field label="Foundation Name"><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label="Foundation Quantity"><Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <FoundationConfigFields draft={draft} onChange={setDraft} types={types} quantity={Number.isInteger(q) && q >= 1 ? q : 1} preview={preview} />
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
