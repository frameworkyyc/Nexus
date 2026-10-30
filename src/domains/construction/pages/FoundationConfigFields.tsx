import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { hasAnyDim, LENGTH_UNITS, volumeLabel, type FoundationConcrete } from '../concrete'
import type { AnchorageGroup, AnchorageType, Dims, Foundation, LengthUnit, Plinth } from '../types'
import type { FoundationConfig, GroupInput } from '../configActions'

/** Text-box state for a set of dimensions. */
export interface DimsDraft { length: string; width: string; height: string; unit: LengthUnit }
export interface GroupDraft { id?: string; typeId: string; count: string; dims: DimsDraft }
export interface ConfigDraft { footing: DimsDraft; plinthBase: 'above-footing' | 'from-footing-base'; groups: GroupDraft[] }

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
export function draftFromFoundation(f: Foundation, plinths: Plinth[], groups: AnchorageGroup[]): ConfigDraft {
  const mine = plinths.filter((p) => p.foundationId === f.id)
  const list: GroupDraft[] = groups.length
    ? groups.map((g) => ({ id: g.id, typeId: g.anchorageTypeId ?? '', count: String(g.count), dims: dimsDraft(g.dims) }))
    : [...new Set(mine.map((p) => p.anchorageTypeId ?? ''))].map((t) => ({ typeId: t, count: String(mine.filter((p) => (p.anchorageTypeId ?? '') === t).length), dims: dimsDraft(null) }))
  return { footing: dimsDraft(f.footing), plinthBase: f.plinthBase ?? 'above-footing', groups: list }
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
  return { config: { footing: foot.dims, plinthBase: d.plinthBase, groups } }
}

export const totalPlinthsOf = (d: ConfigDraft) => d.groups.reduce((t, g) => t + (Number.isInteger(Number(g.count)) && Number(g.count) > 0 ? Number(g.count) : 0), 0)

export function DimsRow({ label, value, onChange, idPrefix }: { label: string; value: DimsDraft; onChange: (d: DimsDraft) => void; idPrefix: string }) {
  const set = (k: 'length' | 'width' | 'height') => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[1fr_1fr_1fr_5rem] items-end gap-2">
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
export function FoundationConfigFields({ draft, onChange, types, quantity, preview }: {
  draft: ConfigDraft
  onChange: (d: ConfigDraft) => void
  types: AnchorageType[]
  quantity: number
  preview: FoundationConcrete | string | null
}) {
  const setGroup = (i: number, patch: Partial<GroupDraft>) => onChange({ ...draft, groups: draft.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) })
  const taken = (i: number) => new Set(draft.groups.filter((_, j) => j !== i).map((g) => g.typeId))
  const total = totalPlinthsOf(draft)
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="t-label">Footing dimensions (optional)</legend>
        <DimsRow label="Footing dimensions" value={draft.footing} onChange={(footing) => onChange({ ...draft, footing })} idPrefix="footing" />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="t-label">Anchorage configuration</legend>
        <p className="text-xs text-muted">How many plinths each foundation has, by anchorage type. Leave the type blank until it is known.</p>
        {draft.groups.map((g, i) => (
          <div key={g.id ?? `new-${i}`} role="group" aria-label={`Anchorage group ${i + 1}`} className="space-y-2 rounded-nx border border-line p-3">
            <div className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
              <Field label="Anchorage type">
                <Select aria-label={`Anchorage type, group ${i + 1}`} value={g.typeId} onChange={(e) => setGroup(i, { typeId: e.target.value })}>
                  <option value="">Not assigned yet</option>
                  {types.filter((t) => !t.archived || t.id === g.typeId).map((t) => <option key={t.id} value={t.id} disabled={taken(i).has(t.id)}>{t.code}{t.archived ? ' (archived)' : ''}</option>)}
                </Select>
              </Field>
              <Field label="Plinths"><Input aria-label={`Plinths, group ${i + 1}`} inputMode="numeric" value={g.count} onChange={(e) => setGroup(i, { count: e.target.value })} /></Field>
              <Button variant="ghost" aria-label={`Remove group ${i + 1}`} disabled={draft.groups.length === 0} onClick={() => onChange({ ...draft, groups: draft.groups.filter((_, j) => j !== i) })}><Trash2 size={15} strokeWidth={1.5} /></Button>
            </div>
            <details open={hasAnyDim(configDims(g.dims))}>
              <summary className="cursor-pointer text-xs text-muted">Default plinth dimensions (optional)</summary>
              <div className="mt-2"><DimsRow label={`Plinth dimensions, group ${i + 1}`} value={g.dims} onChange={(dims) => setGroup(i, { dims })} idPrefix={`group-${i}`} /></div>
            </details>
          </div>
        ))}
        <Button onClick={() => onChange({ ...draft, groups: [...draft.groups, { typeId: '', count: '1', dims: dimsDraft(null, draft.groups[0]?.dims.unit ?? 'mm') }] })}><Plus size={14} strokeWidth={1.5} />Add anchorage group</Button>
        <p className="text-xs text-muted" aria-live="polite">
          {draft.groups.length === 0 ? 'No plinths entered: the plinth count is not known yet.' : <>Plinths per foundation: <span className="font-medium text-ink">{total}</span> · Total plinths: <span className="font-medium text-ink">{(total * quantity).toLocaleString('en-CA')}</span> ({quantity.toLocaleString('en-CA')} × {total})</>}
        </p>
      </fieldset>

      {draft.groups.length > 0 && (
        <Field label="Plinth height is measured">
          <Select aria-label="Plinth height is measured" value={draft.plinthBase} onChange={(e) => onChange({ ...draft, plinthBase: e.target.value as ConfigDraft['plinthBase'] })}>
            <option value="above-footing">From the top of the footing (separate concrete)</option>
            <option value="from-footing-base">From the bottom of the footing (the part inside the footing is not counted twice)</option>
          </Select>
        </Field>
      )}

      <div aria-live="polite" className="rounded-nx bg-hover p-3 text-xs">
        <p className="t-label mb-1">Concrete</p>
        {preview === null ? <p className="text-muted">Enter dimensions to calculate concrete.</p> : typeof preview === 'string' ? <p className="text-muted">{preview}</p> : <ConcreteSummary c={preview} />}
      </div>
    </div>
  )
}

const configDims = (d: DimsDraft): Dims | null => { const r = dimsFrom(d, ''); return 'dims' in r ? r.dims : null }

/** Compact concrete summary; says what is missing instead of showing a misleading total. */
export function ConcreteSummary({ c }: { c: FoundationConcrete }) {
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
