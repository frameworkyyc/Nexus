import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { useState } from 'react'
import { hasAnyDim, LENGTH_UNITS, volumeLabel, type FoundationConcrete } from '../concrete'
import type { AnchorageComponent, AnchorageGroup, AnchorageType, Dims, Foundation, FoundationBolt, FoundationEmbed, LengthUnit, PlateSpec, Plinth } from '../types'
import type { FoundationConfig, FoundationEmbedInput, FootingBoltInput, GroupInput } from '../configActions'
import { itemsOf } from '../tracker/requirements'
import { plateText } from '../plates'

/** Text-box state for a set of dimensions. */
export interface DimsDraft { length: string; width: string; height: string; unit: LengthUnit }
export interface GroupDraft { id?: string; typeId: string; count: string; dims: DimsDraft }
/** Text-box state for one set of anchor bolts installed in each footing. */
export interface BoltDraft {
  id?: string; qty: string; diameter: string; length: string; lengthUnit: 'mm' | 'in'; thread: 'both-ends' | 'all-thread'; topThread: string; bottomThread: string; spec: string
  nutsPerBolt: string; nutSize: string; washersPerBolt: string; washerSize: string
  /** How the bolt quantity counts: per foundation (× the number of physical foundations) or a total. */
  mode: 'per-foundation' | 'total'
}
export const blankBolt = (): BoltDraft => ({ qty: '4', diameter: '', length: '', lengthUnit: 'mm', thread: 'both-ends', topThread: '', bottomThread: '', spec: '', nutsPerBolt: '2', nutSize: '', washersPerBolt: '2', washerSize: '', mode: 'per-foundation' })
const boltDraft = (b: FoundationBolt): BoltDraft => ({ id: b.id, qty: String(b.qty), diameter: b.diameter, length: b.length === null ? '' : String(b.length), lengthUnit: b.lengthUnit, thread: b.thread ?? 'both-ends', topThread: b.topThread === null ? '' : String(b.topThread), bottomThread: b.bottomThread === null ? '' : String(b.bottomThread), spec: b.spec, nutsPerBolt: String(b.nutsPerBolt), nutSize: b.nutSize, washersPerBolt: String(b.washersPerBolt), washerSize: b.washerSize, mode: b.mode ?? 'per-foundation' })
const numOrNull = (t: string) => (t.trim() === '' ? null : Number(t))
const boltInput = (d: BoltDraft): FootingBoltInput => ({
  id: d.id, qty: Number(d.qty), diameter: d.diameter, length: numOrNull(d.length), lengthUnit: d.lengthUnit, thread: d.thread, topThread: d.thread === 'both-ends' ? numOrNull(d.topThread) : null, bottomThread: d.thread === 'both-ends' ? numOrNull(d.bottomThread) : null,
  spec: d.spec, nutsPerBolt: Number(d.nutsPerBolt || 0), washersPerBolt: Number(d.washersPerBolt || 0), nutSize: d.nutSize, washerSize: d.washerSize, mode: d.mode,
})
/** Text-box state for a plate created in the form: size and optional headed studs. */
export interface PlateDraft { thickness: string; width: string; length: string; unit: 'mm' | 'in'; studCount: string; studDiameter: string; studLength: string }
export const blankPlate = (unit: 'mm' | 'in' = 'mm'): PlateDraft => ({ thickness: '', width: '', length: '', unit, studCount: '', studDiameter: '', studLength: '' })
const plateDraft = (p: PlateSpec): PlateDraft => ({ thickness: String(p.thickness), width: String(p.width), length: String(p.length), unit: p.unit, studCount: p.studCount === null ? '' : String(p.studCount), studDiameter: p.studDiameter === null ? '' : String(p.studDiameter), studLength: p.studLength === null ? '' : String(p.studLength) })
/** Text-box state for one embed plate configuration on a foundation. `componentId` empty = a plate created here (`plate`), saved to this foundation or to the library. */
export interface EmbedDraft { id?: string; componentId: string; qty: string; mode: 'per-foundation' | 'total'; plate?: PlateDraft; save?: 'foundation' | 'library' }
const embedDraft = (e: FoundationEmbed): EmbedDraft => ({ id: e.id, componentId: e.componentId, qty: String(e.qty), mode: e.mode, ...(e.plate ? { plate: plateDraft(e.plate), save: 'foundation' as const } : {}) })
const numOrNullStr = (t: string) => (t.trim() === '' ? null : Number(t))
const plateSpec = (d: PlateDraft): PlateSpec => ({ thickness: Number(d.thickness), width: Number(d.width), length: Number(d.length), unit: d.unit, studCount: numOrNullStr(d.studCount), studDiameter: numOrNullStr(d.studDiameter), studLength: numOrNullStr(d.studLength) })
const embedInput = (d: EmbedDraft): FoundationEmbedInput => (d.componentId || !d.plate
  ? { id: d.id, componentId: d.componentId, qty: Number(d.qty), mode: d.mode }
  : { id: d.id, plate: plateSpec(d.plate), save: d.save ?? 'foundation', qty: Number(d.qty), mode: d.mode })
/** A library embed plate the form can offer: the component and the anchorage type that defines it (none for a plate saved to the library on its own). */
export interface EmbedOption { component: AnchorageComponent; type: AnchorageType | null }
export const embedOptionLabel = (o: EmbedOption) => { const it = itemsOf({ ...o.component, qty: 1 })[0]; return `${o.type?.code ?? 'Library'} · ${[it.name !== 'Embed plate' ? it.name : '', it.size, it.spec].filter(Boolean).join(' · ') || 'Embed plate'}` }
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
  for (const [i, e] of (d.embeds ?? []).entries()) {
    if (e.componentId || !e.plate) continue
    const nums = [e.plate.thickness, e.plate.width, e.plate.length, e.plate.studCount, e.plate.studDiameter, e.plate.studLength].filter((t) => t.trim() !== '')
    if (nums.some((t) => !Number.isFinite(Number(t)))) return { error: `Embed plates ${i + 1}: enter the plate and stud sizes as numbers.` }
  }
  return { config: { footing: foot.dims, plinthBase: d.plinthBase, groups, bolts: (d.bolts ?? []).map(boltInput), embeds: (d.embeds ?? []).map(embedInput) } }
}

export const totalPlinthsOf = (d: ConfigDraft) => d.groups.reduce((t, g) => t + (Number.isInteger(Number(g.count)) && Number(g.count) > 0 ? Number(g.count) : 0), 0)

/** Foundation name, quantity and description, together. */
export function FoundationBasics({ number, onNumber, quantity, onQuantity, description, onDescription, autoFocus, required, area }: {
  number: string; onNumber: (v: string) => void; quantity: string; onQuantity: (v: string) => void; description: string; onDescription: (v: string) => void; autoFocus?: boolean; required?: boolean
  /** When given, an Area selector is shown (editing a foundation can move it to another area of the project). */
  area?: { value: string; onChange: (id: string) => void; options: { id: string; name: string }[] }
}) {
  return (
    <div className="grid items-end gap-x-3 gap-y-3 sm:grid-cols-[1fr_11rem]">
      <Field label={required ? 'Foundation Name *' : 'Foundation Name'}><Input autoFocus={autoFocus} value={number} onChange={(e) => onNumber(e.target.value)} placeholder="e.g. FND-101" /></Field>
      <Field label="Foundation Quantity"><Input inputMode="numeric" value={quantity} onChange={(e) => onQuantity(e.target.value)} /></Field>
      {area && <div className="sm:col-span-2"><Field label="Area"><Select aria-label="Area" value={area.value} onChange={(e) => area.onChange(e.target.value)}>{area.options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field></div>}
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
export function FoundationConfigFields({ draft, onChange, types, quantity, preview, onCreateType, embedOptions = [], foundationName = '' }: {
  draft: ConfigDraft
  onChange: (d: ConfigDraft) => void
  types: AnchorageType[]
  quantity: number
  preview: FoundationConcrete | string | null
  /** The Anchorage Library's embed plates, to choose from. */
  embedOptions?: EmbedOption[]
  /** The foundation's name, shown in Materials for plates created here. */
  foundationName?: string
  /** Adds a type to the project's Anchorage Library and resolves to its id (or why not). Absent = the user may not create types. */
  onCreateType?: (code: string) => Promise<{ id: string } | { error: string }>
}) {
  const [typeError, setTypeError] = useState<{ group: number; message: string } | null>(null)
  const setGroup = (i: number, patch: Partial<GroupDraft>) => onChange({ ...draft, groups: draft.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) })
  const taken = (i: number) => new Set(draft.groups.filter((_, j) => j !== i).map((g) => g.typeId))
  const total = totalPlinthsOf(draft)
  const boltsTotal = (draft.bolts ?? []).reduce((t, b) => t + boltCount(b, quantity), 0)
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
        <p className="text-xs text-muted">Bolts installed directly in the footings. No plinth or anchorage type is needed. Count each per foundation or as a total (for example extra bolts on one footing); they are added to what the anchorage configuration already requires. A foundation can have these, plinths, both or neither.</p>
        {(draft.bolts ?? []).map((b, i) => <BoltCard key={b.id ?? `bolt-${i}`} index={i} quantity={quantity} value={b} onChange={(v) => onChange({ ...draft, bolts: draft.bolts.map((x, j) => (j === i ? v : x)) })} onRemove={() => onChange({ ...draft, bolts: draft.bolts.filter((_, j) => j !== i) })} />)}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Button onClick={() => onChange({ ...draft, bolts: [...(draft.bolts ?? []), blankBolt()] })}><Plus size={14} strokeWidth={1.5} />Add anchor bolts</Button>
          {(draft.bolts ?? []).length > 0 && <p className="text-xs text-muted" aria-live="polite">Anchor bolts required: <span className="font-medium text-ink">{boltsTotal.toLocaleString('en-CA')}</span></p>}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-3 border-t border-line pt-5">
        <legend className="t-label mb-1 p-0">Embed plates</legend>
        <p className="text-xs text-muted">Embed plates added directly to this foundation: choose one from the Anchorage Library or create a new one. No anchorage group, plinth or anchorage type is needed. Count each per foundation or as a total.</p>
        {(draft.embeds ?? []).map((e, i) => <EmbedCard key={e.id ?? `embed-${i}`} index={i} value={e} quantity={quantity} options={embedOptions} foundationName={foundationName} supplied={suppliedByTypes(draft, embedOptions, e.componentId)} onChange={(v) => onChange({ ...draft, embeds: draft.embeds.map((x, j) => (j === i ? v : x)) })} onRemove={() => onChange({ ...draft, embeds: draft.embeds.filter((_, j) => j !== i) })} />)}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Button onClick={() => onChange({ ...draft, embeds: [...(draft.embeds ?? []), embedOptions.length === 0 ? { componentId: '', qty: '1', mode: 'per-foundation', plate: blankPlate(), save: 'foundation' } : { componentId: embedOptions.find((o) => !(draft.embeds ?? []).some((x) => x.componentId === o.component.id))?.component.id ?? embedOptions[0].component.id, qty: '1', mode: 'per-foundation' }] })}><Plus size={14} strokeWidth={1.5} />Add embed plates</Button>
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
const boltCount = (b: BoltDraft, quantity: number) => { const n = Number(b.qty); return Number.isInteger(n) && n >= 1 ? (b.mode === 'per-foundation' ? n * quantity : n) : 0 }

function BoltCard({ index, value: b, quantity, onChange, onRemove }: { index: number; value: BoltDraft; quantity: number; onChange: (v: BoltDraft) => void; onRemove: () => void }) {
  const n = index + 1
  const set = (patch: Partial<BoltDraft>) => onChange({ ...b, ...patch })
  const grid = 'grid grid-cols-2 items-end gap-3 sm:grid-cols-4'
  return (
    <div role="group" aria-label={`Anchor bolts ${n}`} className="space-y-3 rounded-nx border border-line p-4 phone:p-3">
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[7rem_11rem_1fr]">
        <Field label="Quantity *"><Input aria-label={`Bolt quantity ${n}`} inputMode="numeric" value={b.qty} onChange={(e) => set({ qty: e.target.value })} /></Field>
        <Field label="Quantity is"><Select aria-label={`Bolt quantity method ${n}`} value={b.mode} onChange={(e) => set({ mode: e.target.value as BoltDraft['mode'] })}><option value="per-foundation">Per foundation</option><option value="total">Total</option></Select></Field>
        <p role="status" aria-live="polite" className="col-span-2 pb-2 text-[13px] sm:col-span-1">{(() => { const q = Number(b.qty); const ok = Number.isInteger(q) && q >= 1; if (!ok) return <span className="text-muted">Enter a whole number of 1 or more.</span>; const t = boltCount(b, quantity); return <><span className="text-muted">{b.mode === 'per-foundation' ? `${q.toLocaleString('en-CA')} per foundation × ${quantity.toLocaleString('en-CA')} foundation${quantity === 1 ? '' : 's'} = ` : `${q.toLocaleString('en-CA')} in total across all ${quantity.toLocaleString('en-CA')} = `}</span><span className="font-medium">{t.toLocaleString('en-CA')} bolt{t === 1 ? '' : 's'} required</span>{(Number(b.nutsPerBolt) > 0 || Number(b.washersPerBolt) > 0) && <span className="text-muted"> · {(t * (Number(b.nutsPerBolt) || 0)).toLocaleString('en-CA')} nuts · {(t * (Number(b.washersPerBolt) || 0)).toLocaleString('en-CA')} washers</span>}</> })()}</p>
      </div>
      <div className={grid}>
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
  return o?.type && draft.groups.some((g) => g.typeId === o.type?.id) ? o.type.code : ''
}

const NEW_PLATE = '__new'
/**
 * One embed plate configuration: a plate from the Anchorage Library, or a new one created here (size and headed studs, no anchorage type needed), how
 * many, and whether that is per foundation or a total. A new plate is saved to this foundation only, or to the library for other foundations to use.
 */
function EmbedCard({ index, value: e, quantity, options, foundationName, supplied, onChange, onRemove }: { index: number; value: EmbedDraft; quantity: number; options: EmbedOption[]; foundationName: string; supplied: string; onChange: (v: EmbedDraft) => void; onRemove: () => void }) {
  const n = index + 1
  const q = Number(e.qty)
  const valid = Number.isInteger(q) && q >= 1
  const creating = !e.componentId && !!e.plate
  const known = !e.componentId || options.some((o) => o.component.id === e.componentId)
  const p = e.plate
  const setPlate = (patch: Partial<PlateDraft>) => onChange({ ...e, plate: { ...(p ?? blankPlate()), ...patch } })
  const spec = p && ['thickness', 'width', 'length'].every((k) => Number(p[k as 'thickness']) > 0) ? plateText(plateSpec(p)) : ''
  const grid = 'grid grid-cols-2 items-end gap-3 sm:grid-cols-4'
  return (
    <div role="group" aria-label={`Embed plates ${n}`} className="space-y-3 rounded-nx border border-line p-4 phone:p-3">
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_7rem_11rem]">
        <div className="col-span-2 sm:col-span-1"><Field label="Embed plate type *">
          <Select aria-label={`Embed plate type ${n}`} value={creating ? NEW_PLATE : e.componentId} onChange={(ev) => ev.target.value === NEW_PLATE ? onChange({ ...e, componentId: '', plate: p ?? blankPlate(), save: e.save ?? 'foundation' }) : onChange({ ...e, componentId: ev.target.value, plate: undefined, save: undefined })}>
            {!known && <option value={e.componentId}>Removed embed plate</option>}
            {options.map((o) => <option key={o.component.id} value={o.component.id}>{embedOptionLabel(o)}</option>)}
            <option value={NEW_PLATE}>+ Create New Embed Plate</option>
          </Select></Field></div>
        <Field label="Quantity *"><Input aria-label={`Embed plate quantity ${n}`} inputMode="numeric" value={e.qty} onChange={(ev) => onChange({ ...e, qty: ev.target.value })} /></Field>
        <Field label="Quantity is"><Select aria-label={`Quantity method ${n}`} value={e.mode} onChange={(ev) => onChange({ ...e, mode: ev.target.value as EmbedDraft['mode'] })}><option value="per-foundation">Per foundation</option><option value="total">Total</option></Select></Field>
      </div>
      {creating && p && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className={grid}>
            <Field label="Plate thickness *"><Input aria-label={`Plate thickness ${n}`} inputMode="decimal" value={p.thickness} onChange={(ev) => setPlate({ thickness: ev.target.value })} placeholder="e.g. 16" /></Field>
            <Field label="Plate width *"><Input aria-label={`Plate width ${n}`} inputMode="decimal" value={p.width} onChange={(ev) => setPlate({ width: ev.target.value })} placeholder="e.g. 300" /></Field>
            <Field label="Plate length *"><Input aria-label={`Plate length ${n}`} inputMode="decimal" value={p.length} onChange={(ev) => setPlate({ length: ev.target.value })} placeholder="e.g. 300" /></Field>
            <Field label="Unit"><Select aria-label={`Plate unit ${n}`} value={p.unit} onChange={(ev) => setPlate({ unit: ev.target.value as 'mm' | 'in' })}><option value="mm">mm</option><option value="in">inches</option></Select></Field>
          </div>
          <div className={grid}>
            <Field label="Headed studs (optional)"><Input aria-label={`Headed studs ${n}`} inputMode="numeric" value={p.studCount} onChange={(ev) => setPlate({ studCount: ev.target.value })} placeholder="None" /></Field>
            <Field label={`Stud diameter (${p.unit})`}><Input aria-label={`Stud diameter ${n}`} inputMode="decimal" value={p.studDiameter} onChange={(ev) => setPlate({ studDiameter: ev.target.value })} placeholder="e.g. 19" /></Field>
            <Field label={`Stud length (${p.unit})`}><Input aria-label={`Stud length ${n}`} inputMode="decimal" value={p.studLength} onChange={(ev) => setPlate({ studLength: ev.target.value })} placeholder="e.g. 150" /></Field>
            <Field label="Save"><Select aria-label={`Save plate ${n}`} value={e.save ?? 'foundation'} onChange={(ev) => onChange({ ...e, save: ev.target.value as 'foundation' | 'library' })}><option value="foundation">Foundation specific</option><option value="library">Save to Anchorage Library</option></Select></Field>
          </div>
          <p className="text-xs text-muted">{spec ? <>Appears in Materials as <span className="font-medium text-ink">{foundationName || 'this foundation'}</span> · {spec}. </> : 'Enter the plate size to see how it will appear in Materials. '}{(e.save ?? 'foundation') === 'library' ? 'Saved to the library so other foundations can choose it.' : 'Kept on this foundation only.'}</p>
        </div>
      )}
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
