import { blankActivitiesFor } from './blankActivities'
import { dimsProblem, hasAnyDim } from './concrete'
import type { Reducer } from './actions'
import type { Activity, AnchorageComponent, AnchorageGroup, ConstructionState, Dims, Foundation, Plinth } from './types'

const fail = (error: string) => ({ error }) as const
const ok = (state: ConstructionState) => ({ state }) as const

export const MAX_PLINTHS = 100

/** One kind of plinth as entered on the form. `id` names an existing group (so its plinths and records are kept); absent = a new group. */
export interface GroupInput { id?: string; anchorageTypeId: string | null; count: number; dims?: Dims | null }
export interface FoundationConfig { footing?: Dims | null; plinthBase?: 'above-footing' | 'from-footing-base'; groups?: GroupInput[] }

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

/** Quantity can only fall to the highest physical foundation that has no pour records. */
export function quantityBelowPours(s: ConstructionState, foundationId: string, quantity: number): string | null {
  const top = Math.max(0, ...(s.pourItems ?? []).filter((i) => i.foundationId === foundationId).map((i) => i.unit))
  return top > quantity ? `Foundation ${top} of this design already has pour records, so the quantity cannot go below ${top}.` : null
}

/**
 * Sets a foundation's footing dimensions, how plinth height is measured and/or its anchorage groups in one step. Dimensions are optional and
 * can be edited at any time; nothing recorded on existing plinths is lost (see applyGroups).
 */
export const configureFoundation = (id: string, cfg: FoundationConfig & { description?: string; quantity?: number }): Reducer => (s) => {
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
}

const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1_000_000
export const MAX_COMPONENTS = 20

/** Why a component cannot be saved, or null. Not every anchorage has bolts: an anchorage of embed plates alone is fine. */
export function componentProblem(c: ComponentInput, n: number): string | null {
  const at = `Component ${n}`
  if (!['bolt', 'sole-plate', 'template', 'embed-plate'].includes(c.kind)) return `${at}: choose bolts, a sole plate, a template or an embed plate.`
  if (!Number.isInteger(c.qty) || c.qty < 1 || c.qty > 1000) return `${at}: enter a whole number of 1 to 1,000 per anchorage.`
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
  const used = new Set((s.anchorageComponents ?? []).map((c) => c.id))
  const next: AnchorageComponent[] = []
  for (const [i, c] of components.entries()) {
    const bad = componentProblem(c, i + 1)
    if (bad) return fail(bad)
    if (c.id && !mine.some((m) => m.id === c.id)) return fail(`Component ${i + 1} no longer exists. Reload and try again.`)
    let id = c.id ?? ''
    if (!id) { let n = mine.length + i + 1; id = `ac-${anchorageTypeId}-${n}`; while (used.has(id) || next.some((x) => x.id === id)) id = `ac-${anchorageTypeId}-${++n}` }
    const bolt = c.kind === 'bolt'
    next.push({
      id, anchorageTypeId, kind: c.kind, qty: c.qty, label: text(c.label, 60), spec: text(c.spec, 120), size: text(c.size, 80),
      diameter: bolt ? text(c.diameter, 30) : '', length: bolt ? (c.length as number) : null, lengthUnit: c.lengthUnit === 'in' ? 'in' : 'mm',
      thread: bolt ? (c.thread as 'both-ends' | 'all-thread') : null, topThread: bolt && c.thread === 'both-ends' ? (c.topThread as number) : null, bottomThread: bolt && c.thread === 'both-ends' ? (c.bottomThread as number) : null,
      nutsPerBolt: bolt ? c.nutsPerBolt ?? 0 : 0, washersPerBolt: bolt ? c.washersPerBolt ?? 0 : 0, nutSize: bolt ? text(c.nutSize, 30) : '', washerSize: bolt ? text(c.washerSize, 30) : '',
    })
  }
  return ok({ ...s, anchorageComponents: [...(s.anchorageComponents ?? []).filter((c) => c.anchorageTypeId !== anchorageTypeId), ...next] })
}
