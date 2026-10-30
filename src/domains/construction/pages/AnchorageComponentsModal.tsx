import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { setAnchorageComponents } from '../commands'
import type { ComponentInput } from '../configActions'
import { constructionStore, useConstruction } from '../store'
import { anchorageInstances, itemsOf } from '../tracker/requirements'
import type { AnchorageComponent, AnchorageComponentKind, AnchorageType } from '../types'

const KIND_LABEL: Record<AnchorageComponentKind, string> = { bolt: 'Anchor bolts', 'sole-plate': 'Sole plate', template: 'Plywood template', 'embed-plate': 'Embed plate' }

interface Draft {
  id?: string; kind: AnchorageComponentKind; qty: string; label: string; spec: string; size: string
  diameter: string; length: string; lengthUnit: 'mm' | 'in'; thread: 'both-ends' | 'all-thread'; topThread: string; bottomThread: string; nutsPerBolt: string; washersPerBolt: string; nutSize: string; washerSize: string; centerHole: string
}
const blank = (kind: AnchorageComponentKind): Draft => ({ kind, qty: '1', label: '', spec: '', size: '', diameter: '', length: '', lengthUnit: 'mm', thread: 'both-ends', topThread: '', bottomThread: '', nutsPerBolt: '2', washersPerBolt: '2', nutSize: '', washerSize: '', centerHole: '' })
const fromComponent = (c: AnchorageComponent): Draft => ({
  id: c.id, kind: c.kind, qty: String(c.qty), label: c.label, spec: c.spec, size: c.size, diameter: c.diameter, length: c.length === null ? '' : String(c.length), lengthUnit: c.lengthUnit, thread: c.thread ?? 'both-ends',
  topThread: c.topThread === null ? '' : String(c.topThread), bottomThread: c.bottomThread === null ? '' : String(c.bottomThread), nutsPerBolt: String(c.nutsPerBolt), washersPerBolt: String(c.washersPerBolt), nutSize: c.nutSize, washerSize: c.washerSize, centerHole: c.centerHole ? String(c.centerHole) : '',
})
const num = (t: string) => (t.trim() === '' ? null : Number(t))
const toInput = (d: Draft): ComponentInput => ({
  id: d.id, kind: d.kind, qty: Number(d.qty), label: d.label, spec: d.spec, size: d.size,
  ...(d.kind === 'bolt' ? { diameter: d.diameter, length: num(d.length), lengthUnit: d.lengthUnit, thread: d.thread, topThread: d.thread === 'both-ends' ? num(d.topThread) : null, bottomThread: d.thread === 'both-ends' ? num(d.bottomThread) : null, nutsPerBolt: Number(d.nutsPerBolt || 0), washersPerBolt: Number(d.washersPerBolt || 0), nutSize: d.nutSize, washerSize: d.washerSize } : {}),
  ...(d.kind === 'sole-plate' ? { centerHole: num(d.centerHole), lengthUnit: d.lengthUnit } : {}),
})
const asComponent = (d: Draft, typeId: string): AnchorageComponent => ({
  id: d.id ?? 'draft', anchorageTypeId: typeId, kind: d.kind, qty: Number(d.qty) || 0, label: d.label, spec: d.spec, size: d.size, diameter: d.diameter, length: num(d.length), lengthUnit: d.lengthUnit,
  thread: d.kind === 'bolt' ? d.thread : null, topThread: num(d.topThread), bottomThread: num(d.bottomThread), nutsPerBolt: Number(d.nutsPerBolt) || 0, washersPerBolt: Number(d.washersPerBolt) || 0, nutSize: d.nutSize, washerSize: d.washerSize, centerHole: d.kind === 'sole-plate' ? num(d.centerHole) : null,
})

/**
 * What an anchorage type is made of. Not every anchorage has bolts: add only the components it has (an anchorage of embed plates alone is
 * fine), and several bolt configurations if it needs them. Quantities are per anchorage. Materials requirements for the whole project are
 * calculated from this and from where the type is used, and shown below as it is edited.
 */
export function AnchorageComponentsModal({ type, onClose }: { type: AnchorageType; onClose: () => void }) {
  const { state } = useConstruction()
  const existing = (state.anchorageComponents ?? []).filter((c) => c.anchorageTypeId === type.id)
  const [list, setList] = useState<Draft[]>(existing.map(fromComponent))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (i: number, patch: Partial<Draft>) => { setList((l) => l.map((d, j) => (j === i ? { ...d, ...patch } : d))); setError('') }
  const instances = anchorageInstances(state).filter((x) => x.typeId === type.id).reduce((t, x) => t + x.instances, 0)
  const totals = new Map<string, { label: string; each: number }>()
  for (const d of list) for (const it of itemsOf(asComponent(d, type.id))) {
    const k = `${it.category}|${it.name}|${it.spec}|${it.size}`
    const label = [it.name, it.spec, it.size].filter(Boolean).join(' · ')
    totals.set(k, { label, each: (totals.get(k)?.each ?? 0) + it.each })
  }
  const save = async () => {
    setSaving(true); setError('')
    const e = await constructionStore.run(setAnchorageComponents(type.id, list.map(toInput)))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title={`Configure ${type.code}`} onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        <p className="text-muted">What one anchorage of this type is made of. Quantities are per anchorage (per plinth that uses it). Materials requirements are calculated from this and from the foundations; nothing already ordered or delivered is changed.</p>
        {list.length === 0 && <p className="border-l-2 border-line pl-3 text-muted">No components yet. Add the bolts, plates or template this anchorage needs.</p>}
        {list.map((d, i) => (
          <fieldset key={d.id ?? `new-${i}`} className="space-y-3 rounded-nx border border-line p-3" aria-label={`Component ${i + 1}: ${KIND_LABEL[d.kind]}`}>
            <legend className="px-1 text-xs font-medium">{KIND_LABEL[d.kind]}</legend>
            {d.kind === 'bolt' ? (
              <>
                <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
                  <Field label="Bolts per anchorage *"><Input aria-label={`Bolts per anchorage ${i + 1}`} inputMode="numeric" value={d.qty} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
                  <Field label="Diameter *"><Input aria-label={`Bolt diameter ${i + 1}`} value={d.diameter} onChange={(e) => set(i, { diameter: e.target.value })} placeholder="e.g. M25 or 3/4&quot;" /></Field>
                  <Field label="Total length *"><Input aria-label={`Bolt length ${i + 1}`} inputMode="decimal" value={d.length} onChange={(e) => set(i, { length: e.target.value })} placeholder="e.g. 900" /></Field>
                  <Field label="Length unit"><Select aria-label={`Length unit ${i + 1}`} value={d.lengthUnit} onChange={(e) => set(i, { lengthUnit: e.target.value as 'mm' | 'in' })}><option value="mm">mm</option><option value="in">inches</option></Select></Field>
                </div>
                <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
                  <Field label="Thread"><Select aria-label={`Thread ${i + 1}`} value={d.thread} onChange={(e) => set(i, { thread: e.target.value as Draft['thread'] })}><option value="both-ends">Threaded both ends</option><option value="all-thread">All-thread</option></Select></Field>
                  {d.thread === 'both-ends' && <Field label={`Top thread (${d.lengthUnit})`}><Input aria-label={`Top thread ${i + 1}`} inputMode="decimal" value={d.topThread} onChange={(e) => set(i, { topThread: e.target.value })} /></Field>}
                  {d.thread === 'both-ends' && <Field label={`Bottom thread (${d.lengthUnit})`}><Input aria-label={`Bottom thread ${i + 1}`} inputMode="decimal" value={d.bottomThread} onChange={(e) => set(i, { bottomThread: e.target.value })} /></Field>}
                  <Field label="Grade / material (optional)"><Input aria-label={`Bolt grade ${i + 1}`} value={d.spec} onChange={(e) => set(i, { spec: e.target.value })} placeholder="e.g. ASTM F1554 Gr.55" /></Field>
                </div>
                <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
                  <Field label="Nuts per bolt"><Input aria-label={`Nuts per bolt ${i + 1}`} inputMode="numeric" value={d.nutsPerBolt} onChange={(e) => set(i, { nutsPerBolt: e.target.value })} /></Field>
                  <Field label="Nut size"><Input aria-label={`Nut size ${i + 1}`} value={d.nutSize} onChange={(e) => set(i, { nutSize: e.target.value })} placeholder={d.diameter || 'Same as the bolt'} /></Field>
                  <Field label="Washers per bolt"><Input aria-label={`Washers per bolt ${i + 1}`} inputMode="numeric" value={d.washersPerBolt} onChange={(e) => set(i, { washersPerBolt: e.target.value })} /></Field>
                  <Field label="Washer size"><Input aria-label={`Washer size ${i + 1}`} value={d.washerSize} onChange={(e) => set(i, { washerSize: e.target.value })} placeholder={d.diameter || 'Same as the bolt'} /></Field>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
                <Field label="Quantity per anchorage *"><Input aria-label={`Quantity ${i + 1}`} inputMode="numeric" value={d.qty} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
                <Field label="Name (optional)"><Input aria-label={`Name ${i + 1}`} value={d.label} onChange={(e) => set(i, { label: e.target.value })} placeholder={KIND_LABEL[d.kind]} /></Field>
                <Field label="Specification"><Input aria-label={`Specification ${i + 1}`} value={d.spec} onChange={(e) => set(i, { spec: e.target.value })} placeholder={d.kind === 'template' ? '19 mm plywood' : 'e.g. CSA G40.21 350W'} /></Field>
                <Field label="Size"><Input aria-label={`Size ${i + 1}`} value={d.size} onChange={(e) => set(i, { size: e.target.value })} placeholder="e.g. 300 x 300 x 12 mm" /></Field>
                {d.kind === 'sole-plate' && <Field label="Centre hole diameter (optional)"><Input aria-label={`Centre hole diameter ${i + 1}`} inputMode="decimal" value={d.centerHole} onChange={(e) => set(i, { centerHole: e.target.value })} placeholder="e.g. 40" /></Field>}
                {d.kind === 'sole-plate' && <Field label="Centre hole unit"><Select aria-label={`Centre hole unit ${i + 1}`} value={d.lengthUnit} onChange={(e) => set(i, { lengthUnit: e.target.value as 'mm' | 'in' })}><option value="mm">mm</option><option value="in">inches</option></Select></Field>}
              </div>
            )}
            <div className="flex justify-end"><Button variant="ghost" aria-label={`Remove component ${i + 1}`} onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 size={15} strokeWidth={1.5} />Remove</Button></div>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Add a component">
          {(Object.keys(KIND_LABEL) as AnchorageComponentKind[]).map((k) => <Button key={k} onClick={() => { setList([...list, blank(k)]); setError('') }}><Plus size={14} strokeWidth={1.5} />{KIND_LABEL[k]}</Button>)}
        </div>

        {totals.size > 0 && (
          <div aria-live="polite" className="rounded-nx bg-hover p-3 text-xs">
            <p className="t-label mb-1">Materials this gives</p>
            <ul className="space-y-0.5">
              {[...totals.values()].map((t) => <li key={t.label}>{t.label}: <span className="font-medium">{t.each.toLocaleString('en-CA')} per anchorage</span>{instances > 0 && <> · <span className="font-medium">{(t.each * instances).toLocaleString('en-CA')}</span> for the {instances.toLocaleString('en-CA')} anchorage{instances === 1 ? '' : 's'} using {type.code} today</>}</li>)}
            </ul>
            {instances === 0 && <p className="mt-1 text-muted">No plinths use {type.code} yet. Assign it to a foundation’s plinths to see the project total.</p>}
          </div>
        )}
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex gap-2"><Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save configuration'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  )
}
