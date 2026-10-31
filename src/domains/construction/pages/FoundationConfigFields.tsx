import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { hasAnyDim, LENGTH_UNITS, volumeLabel, type FoundationConcrete } from '../concrete'
import type { AnchorageComponent, AnchorageGroup, AnchorageType, Dims, Foundation, FoundationBolt, FoundationEmbed, LengthUnit, Plinth } from '../types'
import type { FoundationConfig, FoundationEmbedInput, FootingBoltInput, GroupInput } from '../configActions'
import { itemsOf } from '../tracker/requirements'

/** Text-box state for a set of dimensions. */
export interface DimsDraft { length: string; width: string; height: string; unit: LengthUnit }
export interface GroupDraft { id?: string; typeId: string; count: string; dims: DimsDraft }
/** Text-box state for one set of anchor bolts installed in each footing. */
export interface BoltDraft {
  id?: string; qty: string; diameter: string; length: string; lengthUnit: 'mm' | 'in'; thread: 'both-ends' | 'all-thread'; topThread: string; bottomThread: string; spec: string
  nutsPerBolt: string; nutSize: string; washersPerBolt: string; washerSize: string
}
export const blankBolt = (): BoltDraft => ({ qty: '4', diameter: '', length: '', lengthUnit: 'mm', thread: 'both-ends', topThread: '', bottomThread: '', spec: '', nutsPerBolt: '2', nutSize: '', washersPerBolt: '2', washerSize: '' })
const boltDraft = (b: FoundationBolt): BoltDraft => ({ id: b.id, qty: String(b.qty), diameter: b.diameter, length: b.length === null ? '' : String(b.length), lengthUnit: b.lengthUnit, thread: b.thread ?? 'both-ends', topThread: b.topThread === null ? '' : String(b.topThread), bottomThread: b.bottomThread === null ? '' : String(b.bottomThread), spec: b.spec, nutsPerBolt: String(b.nutsPerBolt), nutSize: b.nutSize, washersPerBolt: String(b.washersPerBolt), washerSize: b.washerSize })
const numOrNull = (t: string) => (t.trim() === '' ? null : Number(t))
const boltInput = (d: BoltDraft): FootingBoltInput => ({
  id: d.id, qty: Number(d.qty), diameter: d.diameter, length: numOrNull(d.length), lengthUnit: d.lengthUnit, thread: d.thread, topThread: d.thread === 'both-ends' ? numOrNull(d.topThread) : null, bottomThread: d.thread === 'both-ends' ? numOrNull(d.bottomThread) : null,
  spec: d.spec, nutsPerBolt: Number(d.nutsPerBolt || 0), washersPerBolt: Number(d.washersPerBolt || 0), nutSize: d.nutSize, washerSize: d.washerSize,
})
/** Text-box state for one embed plate configuration on a foundation. */
export interface EmbedDraft { id?: string; componentId: string; qty: string; mode: 'per-foundation' | 'total' }
const embedDraft = (e: FoundationEmbed): EmbedDraft => ({ id: e.id, componentId: e.componentId, qty: String(e.qty), mode: e.mode })
const embedInput = (d: EmbedDraft): FoundationEmbedInput => ({ id: d.id, componentId: d.componentId, qty: Number(d.qty), mode: d.mode })
/** A library embed plate the form can offer: the component and the anchorage type that defines it. */
export interface EmbedOption { component: AnchorageComponent; type: AnchorageType }
export const embedOptionLabel = (o: EmbedOption) => { const it = itemsOf({ ...o.component, qty: 1 })[0]; return `${o.type.code} · ${[it.name !== 'Embed plate' ? it.name : '', it.size, it.spec].filter(Boolean).join(' · ') || 'Embed plate'}` }
export interface ConfigDraft { footing: DimsDraft; plinthBase: 'above-footing' | 'from-footing-base'; groups: GroupDraft[]; bolts: BoltDraft[]; embeds: EmbedDraft[] }

const num = (v: number | null) => (v === null ? '' : String(v))
export const dimsDraft = (d: Dims | null | undefined, unit: LengthUnit = 'mm'): DimsDraft => ({ length: num(d?.length ?? null), width: num(d?.width ?? null), height: num(d?.height ?? null), unit: d?.unit ?? unit })
const parseDim = (t: string): number | null | 'bad' => { const x = t.trim(); if (x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : 'bad' }
/** Draft → dimensions; blank boxes stay unknown (never zero). */
export function dimsFrom(d: DimsDraft, label: string): { dims: Dims | null } | { error: string } {
  const l = parseDim(d.length), w = parseDim(d.width), h = parseDim(d.height)
  if (l === 'bad' || w === 'bad' || h === 'bad') return { error: `${label}: enter dimensions as numbers.` }
  return { dims: l === null && w === null && h === null ? null : { length: l, width: w, height: h, unit: d.unit } }
}

/** A draft from what is stored. Plinths that predate groups are shown as one group per anchorage assignment. */
export function draftFromFoundation(f: Foundation, plinths: Plinth[], groups: AnchorageGroup[], bolts: FoundationBolt[] = [], embeds: FoundationEmbed[] = []): ConfigDraft {
  const mine = plinths.filter((p) => p.foundationId === f.id)
  const list: GroupDraft[] = groups.length
    ? groups.map((g) => ({ id: g.id, typeId: g.anchorageTypeId ?? '', count: String(g.count), dims: dimsDraft(g.dims) }))
    : [...new Set(mine.map((p) => p.anchorageTypeId ?? ''))].map((t) => ({ typeId: t, count: String(mine.filter((p) => (p.anchorageTypeId ?? '') === t).length), dims: dimsDraft(null) }))
  return { footing: dimsDraft(f.footing), plinthBase: f.plinthBase ?? 'above-footing', groups: list, bolts: bolts.filter((b) => b.foundationId === f.id).map(boltDraft), embeds: embeds.filter((e) => e.foundationId === f.id).map(embedDraft) }
}

/** Draft → the command's configuration, or what is wrong with it. */
export function configFromDraft(d: ConfigDraft): { config: FoundationConfig } | { error: string } {
  const foot = dimsFrom(d.footing, 'Footing')
  if ('error' in foot) return foot
  const groups: GroupInput[] = []
  for (const [i, g] of d.groups.entries()) {
    const count = Number(g.count)
    if (g.count.trim() === '' || !Number.isInteger(count) || count < 1) return { error: `Anchorage group ${i + 1}: enter the number of plinths (a whole number of 1 or more).` }
    const dims = dimsFrom(g.dims, `Anchorage group ${i + 1} dimensions`)
    if ('error' in dims) return dims
    groups.push({ id: g.id, anchorageTypeId: g.typeId || null, count, dims: dims.dims })
  }
  return { config: { footing: foot.dims, plinthBase: d.plinthBase, groups, bolts: (d.bolts ?? []).map(boltInput), embeds: (d.embeds ?? []).map(embedInput) } }
}

export const totalPlinthsOf = (d: ConfigDraft) => d.groups.reduce((t, g) => t + (Number.isInteger(Number(g.count)) && Number(g.count) > 0 ? Number(g.count) : 0), 0)

/** Foundation name, quantity and description, together. */
export function FoundationBasics({ number, onNumber, quantity, onQuantity, description, onDescription, autoFocus, required }: {
  number: string; onNumber: (v: string) => void; quantity: string; onQuantity: (v: string) => void; description: string; onDescription: (v: string) => void; autoFocus?: boolean; required?: boolean
}) {
  return (
    <div className="grid items-end gap-x-3 gap-y-3 sm:grid-cols-[1fr_11rem]">
      <Field label={required ? 'Foundation Name *' : 'Foundation Name'}><Input autoFocus={autoFocus} value={number} onChange={(e) => onNumber(e.target.value)} placeholder="e.g. FND-101" /></Field>
      <Field label="Foundation Quantity"><Input inputMode="numeric" value={quantity} onChange={(e) => onQuantity(e.target.value)} /></Field>
      <div className="sm:col-span-2"><Field label="Description (optional)"><Input value={description} onChange={(e) => onDescription(e.target.value)} /></Field></div>
    </div>
  )
}

export function DimsRow({ label, value, onChange, idPrefix }: { label: string; value: DimsDraft; onChange: (d: DimsDraft) => void; idPrefix: string }) {
  const set = (k: 'length' | 'width' | 'height') => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  return (
    <div role="group" aria-label={label} className="grid max-w-lg grid-cols-[repeat(3,minmax(0,1fr))_5rem] items-end gap-2 phone:max-w-none">
      <Field label="Length"><Input id={`${idPrefix}-l`} inputMode="decimal" value={value.length} onChange={set('length')} placeholder="—" /></Field>
      <Field label="Width"><Input id={`${idPrefix}-w`} inputMode="decimal" value={value.width} onChange={set('width')} placeholder="—" /></Field>
      <Field label="Height"><Input id={`${idPrefix}-h`} inputMode="decimal" value={value.height} onChange={set('height')} placeholder="—" /></Field>
      <Field label="Unit"><Select aria-label={`${label} unit`} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as LengthUnit })}>{LENGTH_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
    </div>
  )
}

/**
 * Footing dimensions and anchorage groups for a foundation design. Dimensions are optional; each group says how many plinths use an
 * anchorage type from the project's library (or none yet) and may carry default plinth dimensions.
 */
export function FoundationConfigFields({ draft, onChange, types, quantity, preview, onCreateType, embedOptions = [], anchorageHref }: {
  draft: ConfigDraft
  onChange: (d: ConfigDraft) => void
  types: AnchorageType[]
  quantity: number
  preview: FoundationConcrete | string | null
  /** The Anchorage Library's embed plates, to choose from. */
  embedOptions?: EmbedOption[]
  anchorageHref?: string
  /** Adds a type to the project's Anchorage Library and resolves to its id (or why not). Absent = the user may not create types. */
  onCreateType?: (code: string) => Promise<{ id: string } | { error: string }>
}) {
  const [typeError, setTypeError] = useState<{ group: number; message: string } | null>(null)
  const setGroup = (i: number, patch: Partial<GroupDraft>) => onChange({ ...draft, groups: draft.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) })
  const taken = (i: number) => new Set(draft.groups.filter((_, j) => j !== i).map((g) => g.typeId))
  const total = totalPlinthsOf(draft)
  const boltsPerFooting = (draft.bolts ?? []).reduce((t, b) => t + (Number.isInteger(Number(b.qty)) && Number(b.qty) > 0 ? Number(b.qty) : 0), 0)
  const norm = (c: string) => c.trim().replace(/\s+/g, ' ').toLowerCase()
  /** Picks the existing type with that code, or adds it to the project's library; the new type is selected in this group. Duplicates are never created. */
  const createType = async (i: number, code: string) => {
    setTypeError(null)
    const existing = types.find((t) => norm(t.code) === norm(code))
    if (existing) {
      if (taken(i).has(existing.id)) setTypeError({ group: i, message: `${existing.code} is already in another group. Combine them into one group.` })
      else if (existing.archived) setTypeError({ group: i, message: `${existing.code} exists but is archived. Restore it in the Anchorage Library first.` })
      else setGroup(i, { typeId: existing.id })
      return
    }
    const r = await onCreateType!(code)
    if ('error' in r) setTypeError({ group: i, message: r.error }); else setGroup(i, { typeId: r.id })
  }
  return (
    <div className="space-y-6">
      <fieldset className="min-w-0 space-y-2 border-t border-line pt-5">
        <legend className="t-label mb-2 p-0">Footing dimensions (optional)</legend>
        <DimsRow label="Footing dimensions" value={draft.footing} onChange={(footing) => onChange({ ...draft, footing })} idPrefix="footing" />
      </fieldset>

      <fieldset className="min-w-0 space-y-3 border-t border-line pt-5">
        <legend className="t-label mb-1 p-0">Anchorage configuration</legend>
        <p className="text-xs text-muted">How many plinths each foundation has, by anchorage type. Leave the type blank until it is known.</p>
        {draft.groups.map((g, i) => (
          <div key={g.id ?? `new-${i}`} role="group" aria-label={`Anchorage group ${i + 1}`} className="space-y-3 rounded-nx border border-line p-4 phone:p-3">
            <div className="grid grid-cols-[1fr_6rem_auto] items-end gap-3 phone:grid-cols-[1fr_5rem_auto] phone:gap-2">
              <Field label="Anchorage type">
                <SearchSelect label={`Anchorage type, group ${i + 1}`} value={g.typeId} emptyLabel="Not assigned yet" placeholder="Type or choose a code…"
                  options={types.filter((t) => (!t.archived || t.id === g.typeId) && !taken(i).has(t.id)).map((t) => ({ value: t.id, label: t.code, hint: t.description || undefined }))}
                  onChange={(v) => { setTypeError(null); setGroup(i, { typeId: v }) }}
                  onCreate={onCreateType ? (code) => void createType(i, code) : undefined} createLabel={(t) => `Add new anchorage type “${t}”`} />
              </Field>
              <Field label="Plinths"><Input aria-label={`Plinths, group ${i + 1}`} inputMode="numeric" value={g.count} onChange={(e) => setGroup(i, { count: e.target.value })} /></Field>
              <Button variant="ghost" aria-label={`Remove group ${i + 1}`} disabled={draft.groups.length === 0} onClick={() => onChange({ ...draft, groups: draft.groups.filter((_, j) => j !== i) })}><Trash2 size={15} strokeWidth={1.5} /></Button>
            </div>
            {typeError?.group === i && <p role="alert" className="text-xs text-bad">{typeError.message}</p>}
            <details open={hasAnyDim(configDims(g.dims))} className="border-t border-line pt-3">
              <summary className="cursor-pointer text-xs text-muted">Plinth dimensions for this group (optional)</summary>
              <div className="mt-3"><DimsRow label={`Plinth dimensions, group ${i + 1}`} value={g.dims} onChange={(dims) => setGroup(i, { dims })} idPrefix={`group-${i}`} /></div>
            </details>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Button onClick={() => onChange({ ...draft, groups: [...draft.groups, { typeId: '', count: '1', dims: dimsDraft(null, draft.groups[0]?.dims.unit ?? 'mm') }] })}><Plus size={14} strokeWidth={1.5} />Add anchorage group</Button>
          <p className="text-xs text-muted" aria-live="polite">
            {draft.groups.length === 0 ? 'No plinths entered: the plinth count is not known yet.' : <>Plinths per foundation: <span className="font-medium text-ink">{total}</span> · Total plinths: <span className="font-medium text-ink">{(total * quantity).toLocaleString('en-CA')}</span> ({quantity.toLocaleString('en-CA')} × {total})</>}
          </p>
        </div>
        {draft.groups.length > 0 && (
          <div className="max-w-xl pt-1">
            <Field label="Plinth height is measured">
              <Select aria-label="Plinth height is measured" value={draft.plinthBase} onChange={(e) => onChange({ ...draft, plinthBase: e.target.value as ConfigDraft['plinthBase'] })}>
                <option value="above-footing">From the top of the footing (separate concrete)</option>
                <option value="from-footing-base">From the bottom of the footing (the part inside the footing is not counted twice)</option>
              </Select>
            </Field>
          </div>
        )}
      </fieldset>

      <fieldset className="min-w-0 space-y-3 border-t border-line pt-5">
        <legend className="t-label mb-1 p-0">Footing anchor bolts</legend>
        <p className="text-xs text-muted">Bolts installed directly in each footing. No plinth or anchorage type is needed, and quantities are per footing. A foundation can have these, plinths, both or neither.</p>
        {(draft.bolts ?? []).map((b, i) => <BoltCard key={b.id ?? `bolt-${i}`} index={i} value={b} onChange={(v) => onChange({ ...draft, bolts: draft.bolts.map((x, j) => (j === i ? v : x)) })} onRemove={() => onChange({ ...draft, bolts: draft.bolts.filter((_, j) => j !== i) })} />)}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Button onClick={() => onChange({ ...draft, bolts: [...(draft.bolts ?? []), blankBolt()] })}><Plus size={14} strokeWidth={1.5} />Add anchor bolts</Button>
          {(draft.bolts ?? []).length > 0 && <p className="text-xs text-muted" aria-live="polite">Bolts per footing: <span className="font-medium text-ink">{boltsPerFooting}</span> · Total bolts: <span className="font-medium text-ink">{(boltsPerFooting * quantity).toLocaleString('en-CA')}</span> ({quantity.toLocaleString('en-CA')} × {boltsPerFooting})</p>}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-3 border-t border-line pt-5">
        <legend className="t-label mb-1 p-0">Embed plates</legend>
        <p className="text-xs text-muted">Embed plates from the Anchorage Library, added directly to this foundation: no anchorage group or plinth is needed. Count each per foundation or as a total.</p>
        {(draft.embeds ?? []).map((e, i) => <EmbedCard key={e.id ?? `embed-${i}`} index={i} value={e} quantity={quantity} options={embedOptions} supplied={suppliedByTypes(draft, embedOptions, e.componentId)} onChange={(v) => onChange({ ...draft, embeds: draft.embeds.map((x, j) => (j === i ? v : x)) })} onRemove={() => onChange({ ...draft, embeds: draft.embeds.filter((_, j) => j !== i) })} />)}
        {embedOptions.length === 0 && <p role="status" className="border-l-2 border-warn pl-3 text-xs">No embed plates are defined yet. Add one to an anchorage type in the Anchorage Library (Configure → Embed plate), then choose it here.{anchorageHref && <> <Link to={anchorageHref} className="underline underline-offset-4">Anchorage types</Link></>}</p>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Button disabled={embedOptions.length === 0} onClick={() => onChange({ ...draft, embeds: [...(draft.embeds ?? []), { componentId: embedOptions.find((o) => !(draft.embeds ?? []).some((x) => x.componentId === o.component.id))?.component.id ?? embedOptions[0].component.id, qty: '1', mode: 'per-foundation' }] })}><Plus size={14} strokeWidth={1.5} />Add embed plates</Button>
          {(draft.embeds ?? []).length > 0 && <p className="text-xs text-muted" aria-live="polite">Embed plates required: <span className="font-medium text-ink">{embedTotal(draft.embeds, quantity).toLocaleString('en-CA')}</span></p>}
        </div>
      </fieldset>

      <div aria-live="polite" className="rounded-nx bg-hover px-4 py-3 text-xs">
        <p className="t-label mb-1">Concrete</p>
        {preview === null ? <p className="text-muted">Enter dimensions to calculate concrete.</p> : typeof preview === 'string' ? <p className="text-muted">{preview}</p> : <ConcreteSummary c={preview} compact />}
      </div>
    </div>
  )
}

/** One set of anchor bolts per footing: size, thread layout, and the nuts and washers each bolt takes. */
function BoltCard({ index, value: b, onChange, onRemove }: { index: number; value: BoltDraft; onChange: (v: BoltDraft) => void; onRemove: () => void }) {
  const n = index + 1
  const set = (patch: Partial<BoltDraft>) => onChange({ ...b, ...patch })
  const grid = 'grid grid-cols-2 items-end gap-3 sm:grid-cols-4'
  return (
    <div role="group" aria-label={`Anchor bolts ${n}`} className="space-y-3 rounded-nx border border-line p-4 phone:p-3">
      <div className={grid}>
        <Field label="Bolts per footing *"><Input aria-label={`Bolts per footing ${n}`} inputMode="numeric" value={b.qty} onChange={(e) => set({ qty: e.target.value })} /></Field>
        <Field label="Diameter *"><Input aria-label={`Bolt diameter ${n}`} value={b.diameter} onChange={(e) => set({ diameter: e.target.value })} placeholder={'e.g. M25 or 3/4"'} /></Field>
        <Field label="Total length *"><Input aria-label={`Bolt length ${n}`} inputMode="decimal" value={b.length} onChange={(e) => set({ length: e.target.value })} placeholder="e.g. 900" /></Field>
        <Field label="Length unit"><Select aria-label={`Length unit ${n}`} value={b.lengthUnit} onChange={(e) => set({ lengthUnit: e.target.value as 'mm' | 'in' })}><option value="mm">mm</option><option value="in">inches</option></Select></Field>
      </div>
      <div className={grid}>
        <Field label="Thread"><Select aria-label={`Thread ${n}`} value={b.thread} onChange={(e) => set({ thread: e.target.value as BoltDraft['thread'] })}><option value="both-ends">Threaded both ends</option><option value="all-thread">All-thread</option></Select></Field>
        {b.thread === 'both-ends' && <Field label={`Top thread (${b.lengthUnit})`}><Input aria-label={`Top thread ${n}`} inputMode="decimal" value={b.topThread} onChange={(e) => set({ topThread: e.target.value })} /></Field>}
        {b.thread === 'both-ends' && <Field label={`Bottom thread (${b.lengthUnit})`}><Input aria-label={`Bottom thread ${n}`} inputMode="decimal" value={b.bottomThread} onChange={(e) => set({ bottomThread: e.target.value })} /></Field>}
        <Field label="Grade / material"><Input aria-label={`Bolt grade ${n}`} value={b.spec} onChange={(e) => set({ spec: e.target.value })} placeholder="e.g. ASTM F1554 Gr.55" /></Field>
      </div>
      <div className={grid}>
        <Field label="Nuts per bolt"><Input aria-label={`Nuts per bolt ${n}`} inputMode="numeric" value={b.nutsPerBolt} onChange={(e) => set({ nutsPerBolt: e.target.value })} /></Field>
        <Field label="Nut size"><Input aria-label={`Nut size ${n}`} value={b.nutSize} onChange={(e) => set({ nutSize: e.target.value })} placeholder={b.diameter || 'Same as the bolt'} /></Field>
        <Field label="Washers per bolt"><Input aria-label={`Washers per bolt ${n}`} inputMode="numeric" value={b.washersPerBolt} onChange={(e) => set({ washersPerBolt: e.target.value })} /></Field>
        <Field label="Washer size"><Input aria-label={`Washer size ${n}`} value={b.washerSize} onChange={(e) => set({ washerSize: e.target.value })} placeholder={b.diameter || 'Same as the bolt'} /></Field>
      </div>
      <div className="flex justify-end"><Button variant="ghost" aria-label={`Remove anchor bolts ${n}`} onClick={onRemove}><Trash2 size={15} strokeWidth={1.5} />Remove</Button></div>
    </div>
  )
}

const embedCount = (e: EmbedDraft, quantity: number) => { const n = Number(e.qty); return Number.isInteger(n) && n >= 1 ? (e.mode === 'per-foundation' ? n * quantity : n) : 0 }
const embedTotal = (embeds: EmbedDraft[], quantity: number) => embeds.reduce((t, e) => t + embedCount(e, quantity), 0)
/** The anchorage type, among those chosen on this form, that already supplies this embed plate (so a direct entry replaces it). */
const suppliedByTypes = (draft: ConfigDraft, options: EmbedOption[], componentId: string) => {
  const o = options.find((x) => x.component.id === componentId)
  return o && draft.groups.some((g) => g.typeId === o.type.id) ? o.type.code : ''
}

/** One embed plate configuration: which library plate, how many, and whether that is per foundation or a total. The total is shown as you type. */
function EmbedCard({ index, value: e, quantity, options, supplied, onChange, onRemove }: { index: number; value: EmbedDraft; quantity: number; options: EmbedOption[]; supplied: string; onChange: (v: EmbedDraft) => void; onRemove: () => void }) {
  const n = index + 1
  const q = Number(e.qty)
  const valid = Number.isInteger(q) && q >= 1
  const known = options.some((o) => o.component.id === e.componentId)
  return (
    <div role="group" aria-label={`Embed plates ${n}`} className="space-y-3 rounded-nx border border-line p-4 phone:p-3">
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_7rem_11rem]">
        <div className="col-span-2 sm:col-span-1"><Field label="Embed plate type *"><Select aria-label={`Embed plate type ${n}`} value={e.componentId} onChange={(ev) => onChange({ ...e, componentId: ev.target.value })}>{!known && <option value={e.componentId}>Removed embed plate</option>}{options.map((o) => <option key={o.component.id} value={o.component.id}>{embedOptionLabel(o)}</option>)}</Select></Field></div>
        <Field label="Quantity *"><Input aria-label={`Embed plate quantity ${n}`} inputMode="numeric" value={e.qty} onChange={(ev) => onChange({ ...e, qty: ev.target.value })} /></Field>
        <Field label="Quantity is"><Select aria-label={`Quantity method ${n}`} value={e.mode} onChange={(ev) => onChange({ ...e, mode: ev.target.value as EmbedDraft['mode'] })}><option value="per-foundation">Per foundation</option><option value="total">Total</option></Select></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-[13px]">{!valid ? <span className="text-muted">Enter a whole number of 1 or more.</span> : e.mode === 'per-foundation' ? <><span className="text-muted">{q.toLocaleString('en-CA')} per foundation × {quantity.toLocaleString('en-CA')} foundation{quantity === 1 ? '' : 's'} = </span><span className="font-medium">{(q * quantity).toLocaleString('en-CA')} plates required</span></> : <><span className="text-muted">{q.toLocaleString('en-CA')} in total across all {quantity.toLocaleString('en-CA')} = </span><span className="font-medium">{q.toLocaleString('en-CA')} plate{q === 1 ? '' : 's'} required</span></>}</p>
        <Button variant="ghost" aria-label={`Remove embed plates ${n}`} onClick={onRemove}><Trash2 size={15} strokeWidth={1.5} />Remove</Button>
      </div>
      {supplied && <p role="note" className="border-l-2 border-warn pl-3 text-xs">{supplied} already supplies this plate on this foundation. This entry replaces it, so nothing is counted twice.</p>}
    </div>
  )
}

const configDims = (d: DimsDraft): Dims | null => { const r = dimsFrom(d, ''); return 'dims' in r ? r.dims : null }

/** Compact concrete summary; says what is missing instead of showing a misleading total. */
export function ConcreteSummary({ c, compact = false }: { c: FoundationConcrete; compact?: boolean }) {
  if (compact) {
    const item = (k: string, v: string, strong = false) => <div key={k}><dt className="text-muted">{k}</dt><dd className={strong ? 'font-medium' : ''}>{v}</dd></div>
    return (
      <div className="space-y-1.5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
          {item('Footing', c.footing === null ? 'dimensions missing' : volumeLabel(c.footing))}
          {item('Plinths', c.plinthsMissing ? `${volumeLabel(c.plinthsKnown)} known, ${c.plinthsMissing} missing` : volumeLabel(c.plinthsKnown))}
          {c.complete ? item('Per foundation', volumeLabel(c.perFoundation!), true) : item('Per foundation', `${volumeLabel(c.perFoundationKnown)} known`)}
          {c.complete ? item(`All ${c.quantity.toLocaleString('en-CA')}`, volumeLabel(c.total!), true) : item(`All ${c.quantity.toLocaleString('en-CA')}`, 'not available')}
        </dl>
        {!c.complete && <p className="text-muted">Total not available — missing {c.missing.join(' and ')}.</p>}
        {c.warnings.map((w) => <p key={w} role="status" className="text-warn">{w}</p>)}
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      <p>Footing: <span className="font-medium">{c.footing === null ? 'dimensions missing' : volumeLabel(c.footing)}</span> · Plinths: <span className="font-medium">{c.plinthsMissing ? `${volumeLabel(c.plinthsKnown)} known, ${c.plinthsMissing} missing` : volumeLabel(c.plinthsKnown)}</span></p>
      {c.complete
        ? <p>Per foundation <span className="font-medium">{volumeLabel(c.perFoundation!)}</span> · All {c.quantity.toLocaleString('en-CA')}: <span className="font-medium">{volumeLabel(c.total!)}</span></p>
        : <p className="text-muted">Total not available — missing {c.missing.join(' and ')}. Known so far: {volumeLabel(c.perFoundationKnown)} per foundation.</p>}
      {c.warnings.map((w) => <p key={w} role="status" className="text-warn">{w}</p>)}
    </div>
  )
}
