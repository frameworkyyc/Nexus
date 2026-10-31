import { Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { setFoundationUnits } from '../commands'
import { embedChoices, MAX_UNIT_EMBEDS, type UnitInput } from '../configActions'
import { paths } from '../paths'
import { constructionStore, useConstruction } from '../store'
import { itemsOf } from '../tracker/requirements'
import type { AnchorageComponent, Foundation, FoundationUnit } from '../types'

const fmt = (n: number) => n.toLocaleString('en-CA')

/** "16 x 320 x 520 mm" or the specification: what tells one library embed plate from another. */
const plateText = (c: AnchorageComponent) => { const it = itemsOf({ ...c, qty: 1 })[0]; return [it.name !== 'Embed plate' ? it.name : '', it.size, it.spec].filter(Boolean).join(' · ') || 'Embed plate' }

/**
 * Individual foundations within a designation (A-1, A-2, B-1…), optional. They inherit the designation's footing, anchorage configuration and quantity;
 * each can have its own embed plates, chosen from the Anchorage Library. Shown compactly in the expanded Foundations row; managed in a form.
 */
export function IndividualFoundations({ foundation }: { foundation: Foundation }) {
  const { state } = useConstruction()
  const access = useAccess()
  const [open, setOpen] = useState(false)
  const units = (state.foundationUnits ?? []).filter((u) => u.foundationId === foundation.id)
  const quantity = foundation.quantity ?? 1
  const project = state.areas.find((a) => a.id === foundation.areaId)?.projectId
  const comps = new Map(embedChoices(state, project).map((x) => [x.component.id, x]))
  const all = new Map((state.anchorageComponents ?? []).map((c) => [c.id, c]))
  const codes = [...new Set(state.plinths.filter((p) => p.foundationId === foundation.id && p.anchorageTypeId).map((p) => state.anchorageTypes.find((t) => t.id === p.anchorageTypeId)?.code ?? ''))].filter(Boolean)
  const embedsText = (u: FoundationUnit) => u.embeds.map((e) => { const c = all.get(e.componentId); return `${fmt(e.qty)} × ${c ? plateText(c) : 'removed embed plate'}` }).join(' · ')
  const canManage = access.can('structure.manage')
  return (
    <div className="mt-4 border-t border-line pt-3 text-[13px]" role="region" aria-label={`Individual foundations of ${foundation.number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-label">Individual foundations{units.length > 0 && <span className="ml-2 font-normal normal-case tracking-normal text-muted">{fmt(units.length)} of {fmt(quantity)} listed</span>}</p>
        {canManage && <Button className="!h-8" onClick={() => setOpen(true)}>{units.length ? 'Manage' : <><Plus size={14} strokeWidth={1.5} />Add individual foundations</>}</Button>}
      </div>
      {units.length === 0 ? (
        <p className="mt-1 text-muted">Tracked as {fmt(quantity)} identical {quantity === 1 ? 'foundation' : 'foundations'}. Give them identifiers (A-1, B-2…) to record different embed plates.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-line border-y border-line" aria-label="Individual foundations">
            {units.map((u) => (
              <li key={u.id} className="grid grid-cols-[6rem_1fr] items-baseline gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[6rem_8rem_1fr]">
                <span className="font-medium">{u.label}</span>
                <span className="text-muted sm:order-none" title="Inherited from the designation">{codes.join(', ') || '—'}</span>
                <span className="col-span-2 min-w-0 sm:col-span-1" title={embedsText(u)}>{u.embeds.length ? <span className="block truncate">{embedsText(u)}</span> : <span className="text-muted">Shared configuration</span>}</span>
              </li>
            ))}
          </ul>
          {units.length < quantity && <p className="mt-1.5 text-xs text-muted">The other {fmt(quantity - units.length)} use the shared configuration.</p>}
        </>
      )}
      {open && <UnitsEditor foundation={foundation} projectId={project} units={units} choices={[...comps.values()]} onClose={() => setOpen(false)} />}
    </div>
  )
}

interface Row { key: string; id?: string; label: string; embeds: { componentId: string; qty: string }[] }
let rowSeq = 0
const newRow = (label: string): Row => ({ key: `r${rowSeq++}`, label, embeds: [] })

function UnitsEditor({ foundation, projectId, units, choices, onClose }: { foundation: Foundation; projectId?: string; units: FoundationUnit[]; choices: ReturnType<typeof embedChoices>; onClose: () => void }) {
  const quantity = foundation.quantity ?? 1
  const [rows, setRows] = useState<Row[]>(units.map((u) => ({ key: `r${rowSeq++}`, id: u.id, label: u.label, embeds: u.embeds.map((e) => ({ componentId: e.componentId, qty: String(e.qty) })) })))
  const [paste, setPaste] = useState('')
  const [prefix, setPrefix] = useState('')
  const [count, setCount] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkComp, setBulkComp] = useState('')
  const [bulkQty, setBulkQty] = useState('1')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const removedComp = (id: string) => !choices.some((c) => c.component.id === id)
  const label = (id: string) => { const c = choices.find((x) => x.component.id === id); return c ? `${c.type?.code ?? 'Library'} · ${plateText(c.component)}` : 'Removed embed plate' }
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const exists = (l: string) => rows.some((r) => r.label.toLowerCase() === l.toLowerCase())
  const addLabels = (labels: string[]) => {
    const fresh = [...new Set(labels.map((l) => l.trim()).filter(Boolean))].filter((l) => !exists(l))
    if (rows.length + fresh.length > quantity) { setError(`${foundation.number} has a quantity of ${fmt(quantity)}, so at most ${fmt(quantity)} individual foundations can be listed.`); return }
    setRows((rs) => [...rs, ...fresh.map(newRow)]); setError('')
  }
  const summary = useMemo(() => {
    const withPlates = rows.filter((r) => r.embeds.length > 0)
    return { listed: rows.length, withPlates: withPlates.length, plates: withPlates.reduce((a, r) => a + r.embeds.reduce((b, e) => b + (Number(e.qty) || 0), 0), 0) }
  }, [rows])
  const save = async () => {
    setSaving(true); setError('')
    const input: UnitInput[] = rows.map((r) => ({ id: r.id, label: r.label, embeds: r.embeds.map((e) => ({ componentId: e.componentId, qty: Number(e.qty) })) }))
    const e = await constructionStore.run(setFoundationUnits(foundation.id, input))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title={`Individual foundations · ${foundation.number}`} onClose={onClose} form>
      <div className="mx-auto max-w-[840px] space-y-5 p-6 text-[13px] phone:p-4">
        <p className="text-muted">Name the individual foundations within {foundation.number} (A-1, A-2, B-1…). They share its footing, anchorage configuration and quantity of {fmt(quantity)}; each can have its own embed plates from the Anchorage Library. An individual foundation with embed plates replaces the anchorage type’s embed plates for that footing, so nothing is counted twice. Leave this empty to track {foundation.number} as a whole.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Add identifiers (comma or line separated)"><div className="flex gap-2"><Textarea aria-label="Identifiers" rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="A-1, A-2, B-1, B-2" /><Button className="self-end" disabled={!paste.trim()} onClick={() => { addLabels(paste.split(/[,\n;]+/)); setPaste('') }}>Add</Button></div></Field>
          <Field label="Or a numbered series"><div className="flex items-end gap-2"><Input aria-label="Series prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Prefix, e.g. A-" /><Input aria-label="Series count" className="!w-20" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="How many" /><Button disabled={!prefix.trim() || !(Number(count) >= 1)} onClick={() => { const n = Math.min(500, Math.floor(Number(count))); const start = rows.filter((r) => r.label.toLowerCase().startsWith(prefix.trim().toLowerCase())).length; addLabels(Array.from({ length: n }, (_, i) => `${prefix.trim()}${start + i + 1}`)); setPrefix(''); setCount('') }}>Add</Button></div></Field>
        </div>

        {choices.length === 0 && <p role="status" className="border-l-2 border-warn pl-3">No embed plates are defined in the Anchorage Library yet. Add one to an anchorage type (Configure → Embed plate) to assign it here. <Link to={paths.anchorage(projectId ?? '')} className="underline underline-offset-4" onClick={onClose}>Anchorage types</Link></p>}

        {rows.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-nx bg-hover px-4 py-3" role="group" aria-label="Apply embed plates to selected">
            <Field label={`Embed plate for ${picked.size || 'selected'} selected`}><Select aria-label="Embed plate to apply" value={bulkComp} onChange={(e) => setBulkComp(e.target.value)}><option value="">Choose…</option>{choices.map((c) => <option key={c.component.id} value={c.component.id}>{c.type?.code ?? 'Library'} · {plateText(c.component)}</option>)}</Select></Field>
            <Field label="Quantity each"><Input aria-label="Quantity to apply" className="!w-24" inputMode="numeric" value={bulkQty} onChange={(e) => setBulkQty(e.target.value)} /></Field>
            <Button disabled={picked.size === 0 || !bulkComp || !(Number(bulkQty) >= 1)} onClick={() => setRows((rs) => rs.map((r) => (picked.has(r.key) ? { ...r, embeds: [{ componentId: bulkComp, qty: bulkQty }] } : r)))}>Apply to selected</Button>
            <Button variant="ghost" onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.key)))}>{picked.size === rows.length ? 'Clear selection' : 'Select all'}</Button>
          </div>
        )}

        <ul className="divide-y divide-line border-y border-line" aria-label="Individual foundations">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[auto_8rem_1fr_auto] items-start gap-3 py-2 phone:grid-cols-[auto_1fr_auto]">
              <input type="checkbox" aria-label={`Select ${r.label || 'row'}`} className="mt-2.5" checked={picked.has(r.key)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })} />
              <Input aria-label="Identifier" value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} />
              <div className="space-y-2 phone:col-span-3 phone:col-start-1 phone:row-start-2">
                {r.embeds.map((e, i) => (
                  <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
                    <Select aria-label={`Embed plate ${i + 1} of ${r.label}`} value={e.componentId} onChange={(ev) => set(r.key, { embeds: r.embeds.map((x, j) => (j === i ? { ...x, componentId: ev.target.value } : x)) })}>
                      {removedComp(e.componentId) && <option value={e.componentId}>{label(e.componentId)}</option>}
                      {choices.map((c) => <option key={c.component.id} value={c.component.id}>{c.type?.code ?? 'Library'} · {plateText(c.component)}</option>)}
                    </Select>
                    <Input aria-label={`Embed plate quantity ${i + 1} of ${r.label}`} inputMode="numeric" value={e.qty} onChange={(ev) => set(r.key, { embeds: r.embeds.map((x, j) => (j === i ? { ...x, qty: ev.target.value } : x)) })} />
                    <button type="button" aria-label={`Remove embed plate ${i + 1} of ${r.label}`} onClick={() => set(r.key, { embeds: r.embeds.filter((_, j) => j !== i) })} className="grid h-9 w-9 place-items-center text-muted hover:text-ink"><X size={14} strokeWidth={1.5} /></button>
                  </div>
                ))}
                {r.embeds.length === 0 && <p className="pt-2 text-muted">Shared configuration (no individual embed plates)</p>}
                {choices.length > 0 && r.embeds.length < MAX_UNIT_EMBEDS && <button type="button" className="text-xs text-muted underline underline-offset-4 hover:text-ink" onClick={() => set(r.key, { embeds: [...r.embeds, { componentId: choices.find((c) => !r.embeds.some((x) => x.componentId === c.component.id))?.component.id ?? choices[0].component.id, qty: '1' }] })}>+ Add embed plate</button>}
              </div>
              <button type="button" aria-label={`Remove ${r.label || 'row'}`} onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setPicked((p) => { const n = new Set(p); n.delete(r.key); return n }) }} className="grid h-9 w-9 place-items-center text-muted hover:text-ink phone:row-start-1 phone:col-start-3"><Trash2 size={15} strokeWidth={1.5} /></button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted" aria-live="polite">{fmt(summary.listed)} of {fmt(quantity)} listed{summary.listed < quantity ? ` · the other ${fmt(quantity - summary.listed)} use the shared configuration` : ''} · {fmt(summary.withPlates)} with their own embed plates ({fmt(summary.plates)} plates)</p>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save individual foundations'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  )
}
