import { blankActivitiesFor } from './blankActivities'
import { dimsProblem, hasAnyDim } from './concrete'
import type { Reducer } from './actions'
import type { Activity, AnchorageComponent, AnchorageGroup, AnchorageType, ConstructionState, Dims, Foundation, FoundationBolt, FoundationEmbed, FoundationUnit, LibraryEmbedPlate, PlateSpec, Plinth } from './types'
import { plateText, plateAsComponent, samePlate } from './plates'

const fail = (error: string) => ({ error }) as const
const ok = (state: ConstructionState) => ({ state }) as const

export const MAX_PLINTHS = 100

/** One kind of plinth as entered on the form. `id` names an existing group (so its plinths and records are kept); absent = a new group. */
export interface GroupInput { id?: string; anchorageTypeId: string | null; count: number; dims?: Dims | null }
/** Anchor bolts installed in each footing, as entered on the form (a ComponentInput that is always a bolt). `id` names an existing entry; absent = new. */
export type FootingBoltInput = Omit<ComponentInput, 'kind'> & { mode?: 'per-foundation' | 'total' }
export const MAX_FOOTING_BOLTS = 10
/** An embed plate added directly to a foundation. `id` names an existing entry; absent = new. */
/** An embed plate entry: a library plate (`componentId`), or a plate created here (`plate`) saved only to this foundation or to the Anchorage Library. */
export interface FoundationEmbedInput { id?: string; componentId?: string; plate?: PlateSpec; save?: 'foundation' | 'library'; qty: number; mode: 'per-foundation' | 'total' }
const dimOk = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100_000
/** What is wrong with a plate specification created in the form, or null. */
export function plateProblem(p: PlateSpec | undefined): string | null {
  if (!p) return 'enter the plate thickness, width and length.'
  if (!dimOk(p.thickness) || !dimOk(p.width) || !dimOk(p.length)) return 'enter the plate thickness, width and length as numbers above 0.'
  if (p.unit !== 'mm' && p.unit !== 'in') return 'choose mm or inches.'
  const studs = [p.studCount, p.studDiameter, p.studLength].some((v) => v !== null && v !== undefined)
  if (studs) {
    if (!Number.isInteger(p.studCount) || (p.studCount as number) < 1 || (p.studCount as number) > 1000) return 'enter a whole number of headed studs (1 to 1,000), or leave the studs empty.'
    if (!dimOk(p.studDiameter)) return 'enter the stud diameter.'
    if (!dimOk(p.studLength)) return 'enter the stud length.'
  }
  return null
}
export const MAX_FOUNDATION_EMBEDS = 10
export interface FoundationConfig { footing?: Dims | null; plinthBase?: 'above-footing' | 'from-footing-base'; groups?: GroupInput[]; /** Absent = unchanged; a list replaces the foundation's footing bolts (empty = none). */ bolts?: FootingBoltInput[]; /** Absent = unchanged; a list replaces the foundation's embed plates (empty = none). */ embeds?: FoundationEmbedInput[] }

export const groupsOf = (s: ConstructionState, foundationId: string): AnchorageGroup[] => (s.anchorageGroups ?? []).filter((g) => g.foundationId === foundationId)

const cleanDims = (d: Dims | null | undefined): Dims | null => (hasAnyDim(d) ? { length: d!.length ?? null, width: d!.width ?? null, height: d!.height ?? null, unit: d!.unit } : null)
const projectOfFoundation = (s: ConstructionState, f: Foundation) => s.areas.find((a) => a.id === f.areaId)?.projectId

/** True when something has been recorded on the plinth, so removing it would destroy a record. */
export function plinthTouched(s: ConstructionState, p: Plinth): boolean {
  if (p.notes || hasAnyDim(p.dims)) return true
  if ((s.pourItems ?? []).some((i) => i.plinthId === p.id)) return true
  if (s.allocations.some((a) => a.plinthId === p.id) || s.plinthReady.some((r) => r.plinthId === p.id)) return true
  return s.activities.some((a) => a.plinthId === p.id && !(a.status === 'not-started' && a.plannedDate === null && a.actualDate === null && a.notes === ''))
}

export function configProblem(s: ConstructionState, f: Foundation, cfg: FoundationConfig): string | null {
  const bad = dimsProblem(cfg.footing, 'Footing')
  if (bad) return bad
  if (cfg.plinthBase !== undefined && cfg.plinthBase !== 'above-footing' && cfg.plinthBase !== 'from-footing-base') return 'Choose how plinth height is measured.'
  if (cfg.bolts !== undefined) {
    if (!Array.isArray(cfg.bolts) || cfg.bolts.length > MAX_FOOTING_BOLTS) return `A foundation can have up to ${MAX_FOOTING_BOLTS} anchor bolt configurations.`
    for (const [i, b] of cfg.bolts.entries()) {
      if (b.mode !== undefined && b.mode !== 'per-foundation' && b.mode !== 'total') return `Anchor bolts ${i + 1}: choose per foundation or total.`
      const p = componentProblem({ ...b, kind: 'bolt' }, i + 1)
      if (p) return p.replace(/^Component \d+:/, `Anchor bolts ${i + 1}:`).replace('per anchorage', b.mode === 'total' ? 'in total' : 'per footing')
      if (b.id && !(s.foundationBolts ?? []).some((x) => x.id === b.id && x.foundationId === f.id)) return `Anchor bolts ${i + 1} no longer exist. Reload and try again.`
    }
  }
  if (cfg.embeds !== undefined) {
    if (!Array.isArray(cfg.embeds) || cfg.embeds.length > MAX_FOUNDATION_EMBEDS) return `A foundation can have up to ${MAX_FOUNDATION_EMBEDS} embed plate configurations.`
    const choices = new Set(embedChoices(s, projectOfFoundation(s, f)).map((x) => x.component.id))
    const seen = new Set<string>()
    for (const [i, e] of cfg.embeds.entries()) {
      const at = `Embed plates ${i + 1}`
      if (!e || typeof e !== 'object') return `${at}: choose an embed plate.`
      if (e.mode !== 'per-foundation' && e.mode !== 'total') return `${at}: choose per foundation or total.`
      if (!Number.isInteger(e.qty) || e.qty < 1 || e.qty > 1_000_000) return `${at}: enter a whole number of 1 or more.`
      if (e.componentId) {
        const existing = (s.foundationEmbeds ?? []).some((x) => x.foundationId === f.id && x.componentId === e.componentId)
        if (!choices.has(e.componentId) && !existing) return `${at}: choose an embed plate from the Anchorage Library.`
      } else {
        const bad = plateProblem(e.plate)
        if (bad) return `${at}: ${bad}`
        if (e.save !== undefined && e.save !== 'foundation' && e.save !== 'library') return `${at}: choose where to save the plate.`
      }
      const key = `${e.componentId || plateText(e.plate as PlateSpec)}|${e.mode}`
      if (seen.has(key)) return `${at}: that embed plate is already listed with the same quantity method. Combine them.`
      seen.add(key)
      if (e.id && !(s.foundationEmbeds ?? []).some((x) => x.id === e.id && x.foundationId === f.id)) return `${at} no longer exists. Reload and try again.`
    }
  }
  if (!cfg.groups) return null
  const types = new Set<string | null>()
  let total = 0
  const projectId = projectOfFoundation(s, f)
  for (const [i, g] of cfg.groups.entries()) {
    const label = `Anchorage group ${i + 1}`
    if (!Number.isInteger(g.count) || g.count < 1 || g.count > MAX_PLINTHS) return `${label}: enter a whole number of plinths from 1 to ${MAX_PLINTHS}.`
    total += g.count
    const key = g.anchorageTypeId ?? null
    if (types.has(key)) return key === null ? 'Only one group can be left without an anchorage type. Combine them.' : `${label}: that anchorage type is already in another group. Combine them into one group.`
    types.add(key)
    if (key !== null) {
      const t = s.anchorageTypes.find((x) => x.id === key)
      const existing = g.id ? (s.anchorageGroups ?? []).find((x) => x.id === g.id) : undefined
      if (!t || (t.projectId && t.projectId !== projectId)) return `${label}: choose an anchorage type from this project’s library.`
      if (t.archived && existing?.anchorageTypeId !== key) return `${label}: “${t.code}” is archived and cannot be used for new assignments.`
    }
    const d = dimsProblem(g.dims, `${label} dimensions`)
    if (d) return d
    if (g.id && !(s.anchorageGroups ?? []).some((x) => x.id === g.id && x.foundationId === f.id)) return `${label} no longer exists. Reload and try again.`
  }
  if (total > MAX_PLINTHS) return `A foundation can have at most ${MAX_PLINTHS} plinths.`
  return null
}

/**
 * Applies anchorage groups to a foundation, keeping every existing plinth (and its id, notes, dimensions, records) wherever the design allows:
 *  - a group keeps its plinths when its count is unchanged; its anchorage type and default dimensions simply change;
 *  - a larger count adds plinths after the existing ones; a smaller count removes the highest-numbered plinths of that group, but only if nothing
 *    has been recorded on them (otherwise the whole edit is refused);
 *  - a group left out is removed under the same rule.
 * Plinth numbers are never renumbered.
 */
export function applyGroups(s: ConstructionState, f: Foundation, inputs: GroupInput[]): ConstructionState | string {
  const oldGroups = groupsOf(s, f.id)
  const mine = s.plinths.filter((p) => p.foundationId === f.id)
  let plinths = s.plinths
  let activities = s.activities
  const groups: AnchorageGroup[] = []
  const removed: Plinth[] = []
  const added: Plinth[] = []
  const used = new Set(s.plinths.map((p) => p.id))
  let nextIndex = Math.max(0, ...mine.map((p) => p.index)) + 1

  for (const g of oldGroups) {
    if (inputs.some((i) => i.id === g.id)) continue
    removed.push(...mine.filter((p) => p.groupId === g.id))
  }
  // Plinths that belong to no group (older records) are adopted into the group of their anchorage assignment, or an unassigned one.
  const ungrouped = mine.filter((p) => !p.groupId || !oldGroups.some((g) => g.id === p.groupId))
  const adopted = new Map<string, string>()
  const makeId = (n: number) => { let id = `${f.id}-g${n}`; while (groups.some((g) => g.id === id) || (s.anchorageGroups ?? []).some((g) => g.id === id && g.foundationId !== f.id)) id = `${id}x`; return id }
  let gn = oldGroups.length

  for (const inp of inputs) {
    const existing = inp.id ? oldGroups.find((g) => g.id === inp.id) : undefined
    const id = existing?.id ?? makeId(++gn)
    const type = inp.anchorageTypeId ?? null
    const members = mine.filter((p) => p.groupId === id).sort((a, b) => a.index - b.index)
    const adoptees = existing ? [] : ungrouped.filter((p) => (p.anchorageTypeId ?? null) === type && !adopted.has(p.id))
    for (const p of adoptees) adopted.set(p.id, id)
    const have = [...members, ...adoptees]
    if (inp.count < have.length) removed.push(...have.slice(inp.count))
    for (let k = have.length; k < inp.count; k++) {
      let pid = `${f.id}-p${nextIndex}`
      while (used.has(pid)) pid += 'x'
      used.add(pid)
      added.push({ id: pid, foundationId: f.id, index: nextIndex++, anchorageTypeId: type, notes: '', groupId: id, dims: null })
    }
    groups.push({ id, foundationId: f.id, anchorageTypeId: type, count: inp.count, dims: cleanDims(inp.dims) })
  }
  // Ungrouped plinths whose assignment has no group in the new design are removed under the same rule.
  for (const p of ungrouped) if (!adopted.has(p.id) && !removed.includes(p)) removed.push(p)

  const blocked = removed.find((p) => plinthTouched(s, p))
  if (blocked) return `Plinth ${blocked.index} has records (notes, dimensions, work, pours or allocated material), so it cannot be removed. Keep the plinth count, or clear those records first.`

  const rem = new Set(removed.map((p) => p.id))
  const byGroup = new Map(groups.map((g) => [g.id, g]))
  plinths = plinths.filter((p) => !rem.has(p.id)).map((p) => {
    if (p.foundationId !== f.id) return p
    const gid = adopted.get(p.id) ?? p.groupId ?? null
    const g = gid ? byGroup.get(gid) : undefined
    return g ? { ...p, groupId: g.id, anchorageTypeId: g.anchorageTypeId } : p
  })
  plinths = [...plinths, ...added]
  activities = [...activities.filter((a) => !(a.plinthId && rem.has(a.plinthId))), ...blankActivitiesFor(f, added).filter((a: Activity) => a.plinthId && added.some((p) => p.id === a.plinthId))]
  const total = groups.reduce((t, g) => t + g.count, 0)
  return {
    ...s, plinths, activities,
    anchorageGroups: [...(s.anchorageGroups ?? []).filter((g) => g.foundationId !== f.id), ...groups],
    foundations: s.foundations.map((x) => (x.id === f.id ? { ...x, plinthsPerFoundation: total } : x)),
  }
}

/** Sets a foundation's footing bolts to exactly `inputs`, keeping the id of any entry that is edited in place. */
export function applyBolts(s: ConstructionState, f: Foundation, inputs: FootingBoltInput[]): ConstructionState {
  const mine = (s.foundationBolts ?? []).filter((b) => b.foundationId === f.id)
  const used = new Set((s.foundationBolts ?? []).map((b) => b.id))
  const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  const next: FoundationBolt[] = []
  for (const [i, b] of inputs.entries()) {
    let id = b.id ?? ''
    if (!id) { let n = mine.length + i + 1; id = `${f.id}-b${n}`; while (used.has(id) || next.some((x) => x.id === id)) id = `${f.id}-b${++n}` }
    next.push({
      id, foundationId: f.id, qty: b.qty, spec: text(b.spec, 120), diameter: text(b.diameter, 30), length: b.length as number, lengthUnit: b.lengthUnit === 'in' ? 'in' : 'mm',
      thread: b.thread as 'both-ends' | 'all-thread', topThread: b.thread === 'both-ends' ? (b.topThread as number) : null, bottomThread: b.thread === 'both-ends' ? (b.bottomThread as number) : null,
      nutsPerBolt: b.nutsPerBolt ?? 0, washersPerBolt: b.washersPerBolt ?? 0, nutSize: text(b.nutSize, 30), washerSize: text(b.washerSize, 30), mode: b.mode === 'total' ? 'total' : 'per-foundation',
    })
  }
  return { ...s, foundationBolts: [...(s.foundationBolts ?? []).filter((b) => b.foundationId !== f.id), ...next] }
}

/** Sets a foundation's embed plates to exactly `inputs`, keeping the id of any entry edited in place. */
export function applyEmbeds(s: ConstructionState, f: Foundation, inputs: FoundationEmbedInput[], by = '', now = ''): ConstructionState {
  const mine = (s.foundationEmbeds ?? []).filter((e) => e.foundationId === f.id)
  const projectId = projectOfFoundation(s, f) ?? ''
  let library = s.libraryEmbedPlates ?? []
  const cleanPlate = (p: PlateSpec): PlateSpec => ({ thickness: p.thickness, width: p.width, length: p.length, unit: p.unit, studCount: p.studCount ?? null, studDiameter: p.studDiameter ?? null, studLength: p.studLength ?? null })
  /** The project's library plate with this specification, created if it does not exist yet (so a specification is never saved twice). */
  const libraryPlate = (p: PlateSpec): string => {
    const have = library.find((x) => x.projectId === projectId && samePlate(x, p))
    if (have) return have.id
    let n = library.length + 1
    let id = `lp-${projectId}-${n}`
    while (library.some((x) => x.id === id)) id = `lp-${projectId}-${++n}`
    const made: LibraryEmbedPlate = { ...cleanPlate(p), id, projectId, createdAt: now, createdBy: by }
    library = [...library, made]
    return id
  }
  const used = new Set((s.foundationEmbeds ?? []).map((e) => e.id))
  const next: FoundationEmbed[] = []
  for (const [i, e] of inputs.entries()) {
    let id = e.id ?? ''
    if (!id) { let n = mine.length + i + 1; id = `${f.id}-em${n}`; while (used.has(id) || next.some((x) => x.id === id)) id = `${f.id}-em${++n}` }
    if (e.componentId) next.push({ id, foundationId: f.id, componentId: e.componentId, qty: e.qty, mode: e.mode })
    else if (e.save === 'library') next.push({ id, foundationId: f.id, componentId: libraryPlate(e.plate as PlateSpec), qty: e.qty, mode: e.mode })
    else next.push({ id, foundationId: f.id, componentId: '', qty: e.qty, mode: e.mode, plate: cleanPlate(e.plate as PlateSpec) })
  }
  return { ...s, libraryEmbedPlates: library, foundationEmbeds: [...(s.foundationEmbeds ?? []).filter((e) => e.foundationId !== f.id), ...next] }
}

/** Quantity can only fall to the highest physical foundation that has no pour records. */
export function quantityBelowPours(s: ConstructionState, foundationId: string, quantity: number): string | null {
  const top = Math.max(0, ...(s.pourItems ?? []).filter((i) => i.foundationId === foundationId).map((i) => i.unit))
  if (top > quantity) return `Foundation ${top} of this design already has pour records, so the quantity cannot go below ${top}.`
  const listed = (s.foundationUnits ?? []).filter((u) => u.foundationId === foundationId).length
  return listed > quantity ? `${listed} individual foundations are listed for this design, so the quantity cannot go below ${listed}. Remove some of them first.` : null
}

/**
 * Sets a foundation's footing dimensions, how plinth height is measured and/or its anchorage groups in one step. Dimensions are optional and
 * can be edited at any time; nothing recorded on existing plinths is lost (see applyGroups).
 */
export const configureFoundation = (id: string, cfg: FoundationConfig & { description?: string; quantity?: number }): Reducer => (s, ctx) => {
  const f = s.foundations.find((x) => x.id === id)
  if (!f) return fail('Foundation not found.')
  const bad = configProblem(s, f, cfg)
  if (bad) return fail(bad)
  if (cfg.quantity !== undefined) {
    if (!Number.isInteger(cfg.quantity) || cfg.quantity < 1 || cfg.quantity > 1_000_000) return fail('Quantity must be a whole number of 1 or more.')
    const q = quantityBelowPours(s, id, cfg.quantity)
    if (q) return fail(q)
  }
  let next: ConstructionState = {
    ...s,
    foundations: s.foundations.map((x) => (x.id === id ? {
      ...x,
      ...(cfg.description !== undefined ? { description: String(cfg.description).trim().slice(0, 300) } : {}),
      ...(cfg.quantity !== undefined ? { quantity: cfg.quantity } : {}),
      ...(cfg.footing !== undefined ? { footing: cleanDims(cfg.footing) } : {}),
      ...(cfg.plinthBase !== undefined ? { plinthBase: cfg.plinthBase } : {}),
    } : x)),
  }
  if (cfg.groups) {
    const r = applyGroups(next, next.foundations.find((x) => x.id === id)!, cfg.groups)
    if (typeof r === 'string') return fail(r)
    next = r
  }
  if (cfg.embeds) next = applyEmbeds(next, next.foundations.find((x) => x.id === id)!, cfg.embeds, String(ctx?.actor ?? ''), String(ctx?.now ?? new Date().toISOString()))
  if (cfg.bolts) next = applyBolts(next, next.foundations.find((x) => x.id === id)!, cfg.bolts)
  return ok(next)
}

/** Sets (or clears, with null) the individual dimensions of one plinth. They replace its group's default for that plinth only. */
export const setPlinthDims = (plinthId: string, dims: Dims | null): Reducer => (s) => {
  const p = s.plinths.find((x) => x.id === plinthId)
  if (!p) return fail('Plinth not found.')
  const bad = dimsProblem(dims, 'Plinth dimensions')
  if (bad) return fail(bad)
  return ok({ ...s, plinths: s.plinths.map((x) => (x.id === plinthId ? { ...x, dims: cleanDims(dims) } : x)) })
}

/* ── Anchorage components ───────────────────────────────────────────────── */

export interface ComponentInput {
  id?: string
  kind: AnchorageComponent['kind']
  qty: number
  label?: string
  spec?: string
  size?: string
  diameter?: string
  length?: number | null
  lengthUnit?: 'mm' | 'in'
  thread?: 'both-ends' | 'all-thread' | null
  topThread?: number | null
  bottomThread?: number | null
  nutsPerBolt?: number
  washersPerBolt?: number
  nutSize?: string
  washerSize?: string
  centerHole?: number | null
  thickness?: number | null
  width?: number | null
  studCount?: number | null
  studDiameter?: number | null
  studLength?: number | null
}

const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1_000_000
export const MAX_COMPONENTS = 20

/** Why a component cannot be saved, or null. Not every anchorage has bolts: an anchorage of embed plates alone is fine. */
export function componentProblem(c: ComponentInput, n: number): string | null {
  const at = `Component ${n}`
  if (!['bolt', 'sole-plate', 'top-plate', 'template', 'embed-plate'].includes(c.kind)) return `${at}: choose bolts, a sole plate, a top plate, a template or an embed plate.`
  if (!Number.isInteger(c.qty) || c.qty < 1 || c.qty > 1000) return `${at}: enter a whole number of 1 to 1,000 per anchorage.`
  if (c.kind === 'sole-plate') {
    if (c.centerHole !== null && c.centerHole !== undefined && !pos(c.centerHole)) return `${at}: enter the centre hole diameter as a number above 0, or leave it empty.`
    if (c.lengthUnit !== undefined && c.lengthUnit !== 'mm' && c.lengthUnit !== 'in') return `${at}: choose mm or inches for the centre hole.`
  }
  if (c.kind === 'top-plate') {
    // A top plate is a plain plate: thickness, width and length, and no centre hole.
    if (!pos(c.thickness)) return `${at}: enter the top plate thickness as a number above 0.`
    if (!pos(c.width)) return `${at}: enter the top plate width as a number above 0.`
    if (!pos(c.length)) return `${at}: enter the top plate length as a number above 0.`
    if (c.lengthUnit !== undefined && c.lengthUnit !== 'mm' && c.lengthUnit !== 'in') return `${at}: choose mm or inches for the top plate dimensions.`
  }
  if (c.kind === 'embed-plate') {
    const any = [c.studCount, c.studDiameter, c.studLength].some((v) => v !== null && v !== undefined)
    if (any) {
      if (!Number.isInteger(c.studCount) || (c.studCount as number) < 1 || (c.studCount as number) > 1000) return `${at}: enter a whole number of studs per plate (1 to 1,000), or leave the headed studs empty.`
      if (!pos(c.studDiameter)) return `${at}: enter the stud diameter.`
      if (!pos(c.studLength)) return `${at}: enter the stud length.`
    }
    if (c.lengthUnit !== undefined && c.lengthUnit !== 'mm' && c.lengthUnit !== 'in') return `${at}: choose mm or inches for the studs.`
  }
  if (c.kind !== 'bolt') return null
  if (!text(c.diameter, 30)) return `${at}: enter the bolt diameter (for example M25 or 3/4").`
  if (!pos(c.length)) return `${at}: enter the total bolt length.`
  if (c.lengthUnit !== undefined && c.lengthUnit !== 'mm' && c.lengthUnit !== 'in') return `${at}: choose mm or inches for the length.`
  if (c.thread !== 'both-ends' && c.thread !== 'all-thread') return `${at}: choose threaded both ends or all-thread.`
  if (c.thread === 'both-ends') {
    if (!pos(c.topThread) || !pos(c.bottomThread)) return `${at}: enter the top and bottom thread lengths.`
    if ((c.topThread as number) + (c.bottomThread as number) > (c.length as number)) return `${at}: the top and bottom threads are longer than the bolt.`
  }
  for (const [k, v] of [['nuts', c.nutsPerBolt ?? 0], ['washers', c.washersPerBolt ?? 0]] as const) if (!Number.isInteger(v) || v < 0 || v > 10) return `${at}: enter 0 to 10 ${k} per bolt.`
  return null
}

/**
 * Sets what an anchorage type is made of, replacing its list of components. A component that keeps its id is edited in place; the list may be
 * empty. Requirements in Materials are recalculated from this the next time they are read or changed — orders and deliveries are never touched.
 */
export const setAnchorageComponents = (anchorageTypeId: string, components: ComponentInput[]): Reducer => (s) => {
  const t = s.anchorageTypes.find((x) => x.id === anchorageTypeId)
  if (!t) return fail('Anchorage type not found.')
  if (!Array.isArray(components) || components.length > MAX_COMPONENTS) return fail(`An anchorage type can have up to ${MAX_COMPONENTS} components.`)
  const mine = (s.anchorageComponents ?? []).filter((c) => c.anchorageTypeId === anchorageTypeId)
  for (const m of mine) {
    if (components.some((c) => c.id === m.id && c.kind === 'embed-plate')) continue
    const n = (s.foundationUnits ?? []).filter((u) => u.embeds.some((e) => e.componentId === m.id)).length
    if (n > 0) return fail(`This ${m.kind === 'embed-plate' ? 'embed plate' : 'component'} is used by ${n} individual foundation${n === 1 ? '' : 's'}. Remove it from them first.`)
    const d = (s.foundationEmbeds ?? []).filter((e) => e.componentId === m.id).length
    if (d > 0) return fail(`This embed plate is used by ${d} foundation${d === 1 ? '' : 's'} (added directly on the foundation). Remove it from them first.`)
  }
  const used = new Set((s.anchorageComponents ?? []).map((c) => c.id))
  const next: AnchorageComponent[] = []
  for (const [i, c] of components.entries()) {
    const bad = componentProblem(c, i + 1)
    if (bad) return fail(bad)
    if (c.id && !mine.some((m) => m.id === c.id)) return fail(`Component ${i + 1} no longer exists. Reload and try again.`)
    let id = c.id ?? ''
    if (!id) { let n = mine.length + i + 1; id = `ac-${anchorageTypeId}-${n}`; while (used.has(id) || next.some((x) => x.id === id)) id = `ac-${anchorageTypeId}-${++n}` }
    const bolt = c.kind === 'bolt'
    const top = c.kind === 'top-plate'
    const unit = c.lengthUnit === 'in' ? 'in' : 'mm'
    next.push({
      id, anchorageTypeId, kind: c.kind, qty: c.qty, label: text(c.label, 60), spec: text(c.spec, 120), size: top ? `${c.thickness} × ${c.width} × ${c.length} ${unit}` : text(c.size, 80),
      diameter: bolt ? text(c.diameter, 30) : '', length: bolt || top ? (c.length as number) : null, lengthUnit: unit,
      thread: bolt ? (c.thread as 'both-ends' | 'all-thread') : null, topThread: bolt && c.thread === 'both-ends' ? (c.topThread as number) : null, bottomThread: bolt && c.thread === 'both-ends' ? (c.bottomThread as number) : null,
      nutsPerBolt: bolt ? c.nutsPerBolt ?? 0 : 0, washersPerBolt: bolt ? c.washersPerBolt ?? 0 : 0, nutSize: bolt ? text(c.nutSize, 30) : '', washerSize: bolt ? text(c.washerSize, 30) : '',
      centerHole: c.kind === 'sole-plate' && pos(c.centerHole) ? (c.centerHole as number) : null,
      thickness: top ? (c.thickness as number) : null, width: top ? (c.width as number) : null,
      studCount: c.kind === 'embed-plate' && pos(c.studLength) ? (c.studCount as number) : null, studDiameter: c.kind === 'embed-plate' && pos(c.studLength) ? (c.studDiameter as number) : null, studLength: c.kind === 'embed-plate' && pos(c.studLength) ? (c.studLength as number) : null,
    })
  }
  return ok({ ...s, anchorageComponents: [...(s.anchorageComponents ?? []).filter((c) => c.anchorageTypeId !== anchorageTypeId), ...next] })
}

/* ── Individual foundations ─────────────────────────────────────────────── */

export interface UnitInput { id?: string; label: string; notes?: string; embeds?: { id?: string; componentId: string; qty: number }[] }
export const MAX_UNITS = 500
export const MAX_UNIT_EMBEDS = 10

/** The library embed plates a foundation's individual foundations may use: embed plate components of this project's (non-archived) anchorage types. */
export function embedChoices(s: ConstructionState, projectId: string | undefined): { component: AnchorageComponent; type: AnchorageType | null }[] {
  const types = new Map(s.anchorageTypes.filter((t) => !t.archived && (!t.projectId || t.projectId === projectId)).map((t) => [t.id, t]))
  const fromTypes = (s.anchorageComponents ?? []).filter((c) => c.kind === 'embed-plate' && types.has(c.anchorageTypeId)).map((c) => ({ component: c, type: types.get(c.anchorageTypeId) as AnchorageType | null }))
  // Plates saved to the library with no anchorage type behind them.
  const saved = (s.libraryEmbedPlates ?? []).filter((p) => p.projectId === projectId).map((p) => ({ component: plateAsComponent(p, p.id), type: null as AnchorageType | null }))
  return [...fromTypes, ...saved]
}

/**
 * Sets the individual foundations of one designation (A-1, A-2, B-1…) and the embed plates each needs, replacing the list. Optional: an empty list
 * means the designation is tracked as a whole, as before. Individual foundations inherit the designation's footing and anchorage configuration, so
 * they can never outnumber its quantity (the rest simply use the shared configuration). Ids are kept for entries edited in place.
 */
export const setFoundationUnits = (foundationId: string, units: UnitInput[]): Reducer => (s) => {
  const f = s.foundations.find((x) => x.id === foundationId)
  if (!f) return fail('Foundation not found.')
  if (!Array.isArray(units)) return fail('Nothing to save.')
  const quantity = f.quantity ?? 1
  if (units.length > MAX_UNITS) return fail(`List up to ${MAX_UNITS} individual foundations.`)
  if (units.length > quantity) return fail(`${f.number} has a quantity of ${quantity.toLocaleString('en-CA')}, so at most ${quantity.toLocaleString('en-CA')} individual foundations can be listed. Raise the quantity first.`)
  const choices = new Map(embedChoices(s, s.areas.find((a) => a.id === f.areaId)?.projectId).map((x) => [x.component.id, x]))
  const mine = (s.foundationUnits ?? []).filter((u) => u.foundationId === foundationId)
  const taken = new Set((s.foundationUnits ?? []).map((u) => u.id))
  const seen = new Set<string>()
  const next: FoundationUnit[] = []
  for (const [i, u] of units.entries()) {
    const label = String(u?.label ?? '').trim().replace(/\s+/g, ' ')
    if (!label || label.length > 30) return fail(`Individual foundation ${i + 1}: enter an identifier of 30 characters or fewer (for example A-1).`)
    if (seen.has(label.toLowerCase())) return fail(`Identifier ${label} is used more than once.`)
    seen.add(label.toLowerCase())
    if (u.id && !mine.some((m) => m.id === u.id)) return fail(`${label} no longer exists. Reload and try again.`)
    const embeds = u.embeds ?? []
    if (embeds.length > MAX_UNIT_EMBEDS) return fail(`${label}: up to ${MAX_UNIT_EMBEDS} embed plate types.`)
    const used = new Set<string>()
    const old = u.id ? mine.find((m) => m.id === u.id) : undefined
    for (const e of embeds) {
      const ok = choices.get(e.componentId) ?? (old?.embeds.some((x) => x.componentId === e.componentId) ? { component: null } : null)
      if (!ok) return fail(`${label}: choose an embed plate from the Anchorage Library.`)
      if (!Number.isInteger(e.qty) || e.qty < 1 || e.qty > 100) return fail(`${label}: enter a whole number of embed plates from 1 to 100.`)
      if (used.has(e.componentId)) return fail(`${label}: that embed plate is listed twice. Combine the quantities.`)
      used.add(e.componentId)
    }
    let id = u.id ?? ''
    if (!id) { let n = mine.length + i + 1; id = `${foundationId}-u${n}`; while (taken.has(id) || next.some((x) => x.id === id)) id = `${foundationId}-u${++n}` }
    const kept = new Map((old?.embeds ?? []).map((e) => [e.componentId, e.id]))
    next.push({ id, foundationId, label, notes: String(u.notes ?? '').trim().slice(0, 200), embeds: embeds.map((e, k) => ({ id: e.id ?? kept.get(e.componentId) ?? `${id}-e${k + 1}-${e.componentId.slice(-6)}`, componentId: e.componentId, qty: e.qty })) })
  }
  return ok({ ...s, foundationUnits: [...(s.foundationUnits ?? []).filter((u) => u.foundationId !== foundationId), ...next] })
}
