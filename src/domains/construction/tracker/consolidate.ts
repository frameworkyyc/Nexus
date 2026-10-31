import type { ConstructionState } from '../types'
import { areaIdFor, CATEGORY_LABEL, CATEGORY_ORDER, allLines } from './selectors'
import { componentMap, embedComponent } from '../plates'
import { anchorageInstances, boltAsComponent, instancesOf, itemsOf, reqKey, type RefSource } from './requirements'
import type { ComponentCategory, GroupRef, TrackerLine, TrackerState } from './types'

/**
 * Materials consolidated by area and specification. The same item required on many foundations is one requirement here (Area → Material
 * category → Specification) with the foundations and anchorage types that make up its total kept as `contributions`, so a total can always be
 * traced to the records behind it. Materials and Procurement both read this, so they never disagree about what is required.
 */
export type ConsolidationSource = RefSource & Pick<ConstructionState, 'foundations'>

export interface Contribution {
  lineId: string
  /** Calculated from the Anchorage Library and foundations, entered by a person, or from the imported workbook. */
  source: 'calculated' | 'entered' | 'workbook'
  foundationId: string | null
  foundation: string
  anchorageTypeId: string | null
  anchorage: string
  qty: number
  /** Set when the quantity is one individual foundation's own embed plates (its identifier is part of `foundation`). */
  individual?: boolean
}

export interface Consolidated extends GroupRef {
  designation: string
  /** The material lines (calculated, entered or imported) that make up this requirement. */
  lines: TrackerLine[]
  required: number
  contributions: Contribution[]
  /** Every contributing line is a calculated requirement that no longer applies. */
  removed: boolean
}

const norm = (t: string | null | undefined) => (t ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export const CATEGORY_TITLE: Record<ComponentCategory, string> = { ...CATEGORY_LABEL }

/** The key that makes two materials "the same": same area, category, name, specification, size and unit. */
export function groupKey(areaKey: string, l: Pick<TrackerLine, 'category' | 'component' | 'specification' | 'size' | 'unit'>, designation = ''): string {
  return [areaKey, l.category, norm(l.component), norm(l.specification), norm(l.size), norm(l.unit) || 'ea', ...(designation ? [norm(designation)] : [])].join('|')
}

/**
 * The anchorage designation a material line belongs to. Anchorage-specific components (bolts, nuts, washers, sole plates, templates, embed plates of an
 * anchorage type) stay separate per designation even when physically identical; a generic material has none and consolidates by specification.
 */
export const designationOf = (l: Pick<TrackerLine, 'origin' | 'designation' | 'category' | 'anchorageType'>): string =>
  l.origin === 'anchorage' ? (l.designation ?? '') : l.category !== 'other' ? (l.anchorageType ?? '').trim() : ''

/** "OP1-D2 Anchor bolt": the material's name with its designation in front. */
export const displayName = (g: { name: string; designation?: string }) => (g.designation ? `${g.designation} ${g.name}` : g.name)

/** Where each calculated line's total comes from, foundation by foundation. */
function calculatedContributions(l: TrackerLine, c: ConsolidationSource): Contribution[] {
  const out: Contribution[] = []
  const typeOf = new Map(c.anchorageTypes.map((t) => [t.id, t]))
  const foundationOf = new Map(c.foundations.map((f) => [f.id, f]))
  for (const i of anchorageInstances(c)) {
    for (const comp of (c.anchorageComponents ?? []).filter((x) => x.anchorageTypeId === i.typeId)) {
      const instances = instancesOf(c, i, comp)
      if (instances === 0) continue
      for (const it of itemsOf(comp)) {
        if (reqKey(i.areaId, it, typeOf.get(i.typeId)?.code ?? '') !== l.deriveKey) continue
        const existing = out.find((x) => x.foundationId === i.foundationId && x.anchorageTypeId === i.typeId && !x.individual)
        const qty = it.each * instances
        if (existing) existing.qty += qty
        else out.push({ lineId: l.id, source: 'calculated', foundationId: i.foundationId, foundation: foundationOf.get(i.foundationId)?.number ?? i.number, anchorageTypeId: i.typeId, anchorage: typeOf.get(i.typeId)?.code ?? '', qty })
      }
    }
  }
  const compById = componentMap(c)
  for (const u of c.foundationUnits ?? []) {
    const f = foundationOf.get(u.foundationId)
    if (!f || f.archived) continue
    for (const e of u.embeds) {
      const comp = compById.get(e.componentId)
      if (!comp || comp.kind !== 'embed-plate') continue
      for (const it of itemsOf({ ...comp, qty: e.qty })) {
        if (reqKey(f.areaId, it, typeOf.get(comp.anchorageTypeId)?.code ?? '') !== l.deriveKey) continue
        out.push({ lineId: l.id, source: 'calculated', foundationId: f.id, foundation: `${f.number} · ${u.label}`, anchorageTypeId: comp.anchorageTypeId, anchorage: typeOf.get(comp.anchorageTypeId)?.code ?? f.number, qty: it.each, individual: true })
      }
    }
  }
  for (const fe of c.foundationEmbeds ?? []) {
    const f = foundationOf.get(fe.foundationId)
    const comp = embedComponent(fe, compById)
    if (!f || f.archived || !comp || comp.kind !== 'embed-plate') continue
    for (const it of itemsOf({ ...comp, qty: fe.qty })) {
      if (reqKey(f.areaId, it, typeOf.get(comp.anchorageTypeId)?.code ?? '') !== l.deriveKey) continue
      const qty = it.each * (fe.mode === 'total' ? 1 : (f.quantity ?? 1))
      const existing = out.find((x) => x.foundationId === f.id && x.anchorageTypeId === comp.anchorageTypeId && !x.individual)
      if (existing) existing.qty += qty
      else out.push({ lineId: l.id, source: 'calculated', foundationId: f.id, foundation: f.number, anchorageTypeId: comp.anchorageTypeId, anchorage: typeOf.get(comp.anchorageTypeId)?.code ?? f.number, qty })
    }
  }
  for (const fb of c.foundationBolts ?? []) {
    const f = foundationOf.get(fb.foundationId)
    if (!f || f.archived) continue
    for (const it of itemsOf(boltAsComponent(fb))) {
      if (reqKey(f.areaId, it, '') !== l.deriveKey) continue
      const existing = out.find((x) => x.foundationId === f.id && x.anchorageTypeId === null)
      const qty = it.each * (fb.mode === 'total' ? 1 : f.quantity ?? 1)
      if (existing) existing.qty += qty
      else out.push({ lineId: l.id, source: 'calculated', foundationId: f.id, foundation: f.number, anchorageTypeId: null, anchorage: 'Footing', qty })
    }
  }
  return out
}

/**
 * All active materials, consolidated. `catalogAreas` resolves a material's area to a project area (by link, else by name) so a line
 * entered with the area typed in and a calculated line for the same area land in one group.
 */
export function consolidate(s: TrackerState, c: ConsolidationSource): Consolidated[] {
  const groups = new Map<string, Consolidated>()
  for (const l of allLines(s)) {
    if (l.archived) continue
    const areaId = l.areaId ?? areaIdFor(c.areas, l.area)
    const areaKey = areaId ?? `t:${norm(l.area)}`
    const designation = designationOf(l)
    const key = groupKey(areaKey, l, designation)
    const g = groups.get(key) ?? { key, designation, areaId: areaId ?? null, area: areaId ? c.areas.find((a) => a.id === areaId)?.name ?? l.area : l.area, category: l.category, name: l.component, specification: l.specification ?? '', size: l.size ?? '', unit: l.unit || 'ea', lines: [], required: 0, contributions: [], removed: true }
    g.lines.push(l)
    g.required += l.requiredQty
    if (!l.requirementRemoved) g.removed = false
    if (l.origin === 'anchorage' && l.deriveKey) g.contributions.push(...calculatedContributions(l, c))
    else if (l.requiredQty > 0) {
      const f = l.foundationId ? c.foundations.find((x) => x.id === l.foundationId) : c.foundations.find((x) => areaId && x.areaId === areaId && norm(x.number) === norm(l.footingType))
      g.contributions.push({ lineId: l.id, source: l.origin === 'manual' ? 'entered' : 'workbook', foundationId: f?.id ?? null, foundation: f?.number ?? l.footingType, anchorageTypeId: l.anchorageTypeId ?? null, anchorage: l.anchorageType, qty: l.requiredQty })
    }
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => a.area.localeCompare(b.area, 'en', { numeric: true }) || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name, 'en', { numeric: true }) || a.specification.localeCompare(b.specification, 'en', { numeric: true }))
}

export interface CategoryNode { category: ComponentCategory; label: string; groups: Consolidated[] }
export interface AreaNode { areaKey: string; areaId: string | null; name: string; categories: CategoryNode[]; groups: Consolidated[] }

/** Area → Material category → Specification. */
export function areaTree(groups: Consolidated[]): AreaNode[] {
  const areas = new Map<string, AreaNode>()
  for (const g of groups) {
    const areaKey = g.areaId ?? `t:${norm(g.area)}`
    const a = areas.get(areaKey) ?? { areaKey, areaId: g.areaId, name: g.area, categories: [], groups: [] }
    a.groups.push(g)
    let cat = a.categories.find((x) => x.category === g.category)
    if (!cat) { cat = { category: g.category, label: CATEGORY_TITLE[g.category], groups: [] }; a.categories.push(cat) }
    cat.groups.push(g)
    areas.set(areaKey, a)
  }
  for (const a of areas.values()) a.categories.sort((x, y) => CATEGORY_ORDER.indexOf(x.category) - CATEGORY_ORDER.indexOf(y.category))
  return [...areas.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
}

/** "ASTM F1554 Gr.36 · 3/4" x 460 mm" — what tells two specifications apart. */
export const specText = (g: Pick<GroupRef, 'specification' | 'size'>) => [g.specification, g.size].filter(Boolean).join(' · ')

/** An entered quantity that may not count every physical foundation, or that the Anchorage Library already counts. */
export interface EntryNote {
  lineId: string
  foundationId: string
  foundation: string
  entered: number
  footings: number
  /** What the same entry comes to when counted on every footing. */
  perFooting: number
  /** What the Anchorage Library already calculates for this foundation in this requirement (0 = nothing). */
  calculated: number
}

/**
 * Entered lines are fixed totals: Nexus counts exactly what was typed. On a foundation with several footings that is often a per-footing
 * figure ("4 bolts") entered once. These are listed so the person can see the difference and decide; nothing is changed automatically.
 */
export function entryNotes(g: Consolidated, c: Pick<ConstructionState, 'foundations'>, all: Consolidated[] = [g]): EntryNote[] {
  const out: EntryNote[] = []
  for (const l of g.lines) {
    if (l.origin !== 'manual' || (l.basis ?? 'fixed') !== 'fixed' || !l.foundationId || l.requiredQty <= 0) continue
    const f = c.foundations.find((x) => x.id === l.foundationId)
    const footings = f?.quantity ?? 1
    // Calculated quantity for the same foundation, category and (when the entered line names one) anchorage type, in any specification of the area.
    const calculated = all.filter((x) => x.areaId === g.areaId && x.category === g.category).flatMap((x) => x.contributions).filter((x) => x.source === 'calculated' && x.foundationId === l.foundationId && (!l.anchorageTypeId || x.anchorageTypeId === l.anchorageTypeId)).reduce((a, x) => a + x.qty, 0)
    if (footings > 1 || calculated > 0) out.push({ lineId: l.id, foundationId: l.foundationId, foundation: f?.number ?? l.footingType, entered: l.requiredQty, footings, perFooting: l.requiredQty * footings, calculated })
  }
  return out
}

/**
 * What a material is called in the list: the anchorage types that need it (several types that share an identical material are one line and
 * all are named), with the specification underneath. A material entered without an anchorage type is shown by its name.
 */
export function materialLabel(g: Consolidated): { title: string; sub: string } {
  if (g.designation) return { title: displayName(g), sub: specText(g) || g.unit }
  const codes = [...new Set(g.contributions.map((c) => c.anchorage).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const sub = specText(g) || (codes.length ? g.name : g.unit)
  return { title: codes.length ? codes.join(', ') : g.name, sub }
}
