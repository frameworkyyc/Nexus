import { componentMap, embedComponent } from '../plates'
import type { AnchorageComponent, ConstructionState, FoundationBolt } from '../types'
import type { AuditEntry, ComponentCategory, QtyBasis, QuantityCalc, RequirementPart, TrackerLine, TrackerState } from './types'

/**
 * Material requirements worked out from the Anchorage Library and the Foundation Register.
 *
 * An anchorage type lists what one anchorage needs (4 bolts, 2 nuts and 2 washers per bolt, 1 template…). Each plinth that uses the type is one
 * anchorage, and a foundation design stands for `quantity` physical foundations, so a design with 3 plinths of type A and a quantity of 12
 * has 36 anchorages of type A. Totals are grouped by area and specification: the same item on many foundations is one requirement.
 */
export type RefSource = Pick<ConstructionState, 'areas' | 'foundations' | 'plinths' | 'anchorageTypes'> & Partial<Pick<ConstructionState, 'anchorageComponents' | 'foundationBolts' | 'foundationUnits' | 'foundationEmbeds' | 'libraryEmbedPlates'>>

export interface Requirement {
  key: string
  id: string
  areaId: string
  areaName: string
  category: ComponentCategory
  name: string
  spec: string
  size: string
  required: number
  parts: RequirementPart[]
  anchorageCodes: string[]
  expression: string
  /** The anchorage designation it belongs to (OP1-D2), or '' for a generic material. */
  designation: string
}

/**
 * The key of a calculated requirement. Anchorage-specific components (bolts, nuts, washers, sole plates, templates and embed plates of an anchorage type)
 * carry their anchorage designation in the key, so OP1-D2's plywood templates and OP1-D3's stay separate requirements even when physically identical.
 * A material with no anchorage type (footing bolts, plates created in a foundation) is identified by its foundation's designation instead, so each foundation's own requirement stays distinguishable.
 */
export const reqKey = (areaId: string, it: { category: string; name: string; spec: string; size: string }, designation = '') =>
  `anchorage|${areaId}|${it.category}|${norm(it.name)}|${norm(it.spec)}|${norm(it.size)}${designation ? `|${norm(designation)}` : ''}`
/** The key a requirement had before designations were part of it (also the key of a generic requirement). */
export const legacyReqKey = (key: string, designation: string) => (designation ? key.slice(0, key.length - designation.trim().toLowerCase().replace(/\s+/g, ' ').length - 1) : key)

const fmt = (n: number) => n.toLocaleString('en-CA')
const num = (n: number | null) => (n === null ? '' : String(n))
const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')

/** A short stable id from the key, so the same requirement is found again and never duplicated. */
function hash(text: string) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}
export const requirementId = (key: string) => `req-${hash(key)}${hash(key.split('').reverse().join(''))}`

/** The specification line of an anchor bolt: size, length, thread configuration. */
export function boltSpec(c: AnchorageComponent): string {
  const unit = c.lengthUnit
  const thread = c.thread === 'all-thread' ? 'all-thread' : c.thread === 'both-ends' ? `threaded both ends${c.topThread !== null || c.bottomThread !== null ? ` (top ${num(c.topThread) || '—'}, bottom ${num(c.bottomThread) || '—'} ${unit})` : ''}` : ''
  return [`${c.diameter}${c.length !== null ? ` × ${num(c.length)} ${unit}` : ''}`, c.spec.trim(), thread].filter(Boolean).join(', ')
}

interface Item { category: ComponentCategory; name: string; spec: string; size: string; each: number }
/** What one anchorage of this component needs, as materials. A bolt gives the bolts themselves plus their nuts and washers. */
export function itemsOf(c: AnchorageComponent): Item[] {
  if (c.kind === 'bolt') {
    const out: Item[] = [{ category: 'bolt', name: 'Anchor bolt', spec: boltSpec(c), size: '', each: c.qty }]
    const nutSize = c.nutSize.trim() || c.diameter.trim()
    const washerSize = c.washerSize.trim() || c.diameter.trim()
    if (c.nutsPerBolt > 0) out.push({ category: 'nut', name: 'Nut', spec: nutSize, size: '', each: c.qty * c.nutsPerBolt })
    if (c.washersPerBolt > 0) out.push({ category: 'washer', name: 'Washer', spec: washerSize, size: '', each: c.qty * c.washersPerBolt })
    return out
  }
  const category: ComponentCategory = c.kind === 'sole-plate' ? 'sole-plate' : c.kind === 'top-plate' ? 'top-plate' : c.kind === 'template' ? 'template' : 'embed-plate'
  const base = c.kind === 'sole-plate' ? 'Sole plate' : c.kind === 'top-plate' ? 'Top plate' : c.kind === 'template' ? 'Plywood template' : 'Embed plate'
  // A top plate's size comes from its thickness, width and length (thickness × width × length), in its own unit.
  const size = c.kind === 'top-plate' && c.thickness && c.width && c.length ? `${num(c.thickness)} × ${num(c.width)} × ${num(c.length)} ${c.lengthUnit}` : c.size.trim()
  const hole = c.kind === 'sole-plate' && c.centerHole ? `centre hole Ø${num(c.centerHole)} ${c.lengthUnit}` : ''
  const studs = c.kind === 'embed-plate' && c.studCount && c.studDiameter && c.studLength ? `${c.studCount} headed stud${c.studCount === 1 ? '' : 's'} Ø${num(c.studDiameter)} × ${num(c.studLength)} ${c.lengthUnit}` : ''
  return [{ category, name: c.label.trim() || base, spec: [c.spec.trim(), hole, studs].filter(Boolean).join(', '), size, each: c.qty }]
}

/** A footing bolt as the anchorage component it is equivalent to (no anchorage type), so nuts, washers and the specification come out the same way. */
export const boltAsComponent = (b: FoundationBolt): AnchorageComponent => ({ ...b, anchorageTypeId: '', kind: 'bolt', label: '', size: '' })

/**
 * Footings of a foundation that have their own embed plates (an individual foundation with at least one embed plate from the library). For those
 * footings the individual list replaces the anchorage type's embed plates, so nothing is counted twice; the other footings keep the type's.
 */
export function overriddenFootings(c: RefSource, foundationId: string): number {
  const embeds = new Set([...componentMap(c).values()].filter((x) => x.kind === 'embed-plate').map((x) => x.id))
  return (c.foundationUnits ?? []).filter((u) => u.foundationId === foundationId && u.embeds.some((e) => embeds.has(e.componentId))).length
}

/** Physical anchorages of each type on each foundation: the foundation's quantity times its plinths of that type. */
export function anchorageInstances(c: RefSource) {
  const out: { foundationId: string; areaId: string; number: string; typeId: string; instances: number; /** The same, for embed plates only: footings with their own individual embed plates are not counted. */ embedInstances: number }[] = []
  for (const f of c.foundations) {
    if (f.archived) continue
    const qty = f.quantity ?? 1
    const embedQty = Math.max(0, qty - overriddenFootings(c, f.id))
    const byType = new Map<string, number>()
    for (const p of c.plinths) if (p.foundationId === f.id && p.anchorageTypeId) byType.set(p.anchorageTypeId, (byType.get(p.anchorageTypeId) ?? 0) + 1)
    for (const [typeId, n] of byType) out.push({ foundationId: f.id, areaId: f.areaId, number: f.number, typeId, instances: qty * n, embedInstances: embedQty * n })
  }
  return out
}

/** True when this foundation lists the embed plate directly, which then replaces what its anchorage types supply of the same plate (never both). */
export const embedReplaced = (c: RefSource, foundationId: string, componentId: string) => (c.foundationEmbeds ?? []).some((e) => e.foundationId === foundationId && e.componentId === componentId)
/** Instances of an anchorage component on one foundation row: embed plates skip footings with their own plates and plates the foundation lists directly. */
export const instancesOf = (c: RefSource, row: { foundationId: string; instances: number; embedInstances: number }, comp: AnchorageComponent) =>
  comp.kind !== 'embed-plate' ? row.instances : embedReplaced(c, row.foundationId, comp.id) ? 0 : row.embedInstances

export function deriveRequirements(c: RefSource): Requirement[] {
  const comps = c.anchorageComponents ?? []
  const typeOf = new Map(c.anchorageTypes.map((t) => [t.id, t]))
  const areaOf = new Map(c.areas.map((a) => [a.id, a]))
  const groups = new Map<string, Requirement>()
  const typeInstances = new Map<string, ReturnType<typeof anchorageInstances>>() // `${areaId}|${typeId}` → that type's rows in the area
  for (const i of anchorageInstances(c)) { const k = `${i.areaId}|${i.typeId}`; typeInstances.set(k, [...(typeInstances.get(k) ?? []), i]) }
  for (const [ak, rowsOfType] of typeInstances) {
    const [areaId, typeId] = ak.split('|')
    const area = areaOf.get(areaId)
    const type = typeOf.get(typeId)
    if (!area || !type) continue
    for (const comp of comps.filter((x) => x.anchorageTypeId === typeId)) {
      const instances = rowsOfType.reduce((a, r) => a + instancesOf(c, r, comp), 0)
      if (instances === 0) continue
      for (const it of itemsOf(comp)) {
        const key = reqKey(areaId, it, type.code)
        const g = groups.get(key) ?? { key, id: requirementId(key), areaId, areaName: area.name, category: it.category, name: it.name, spec: it.spec, size: it.size, required: 0, parts: [], anchorageCodes: [], expression: '', designation: type.code }
        const part = g.parts.find((p) => p.anchorageTypeId === typeId && p.instances === instances)
        if (part) { part.each += it.each } else g.parts.push({ anchorageTypeId: typeId, code: type.code, instances, each: it.each })
        g.required += it.each * instances
        groups.set(key, g)
      }
    }
  }
  // Bolts installed directly in footings: footing quantity × bolts per footing. They join the same requirement as an identical specification from
  // the Anchorage Library (same key), so a material is never listed twice.
  for (const fb of c.foundationBolts ?? []) {
    const f = c.foundations.find((x) => x.id === fb.foundationId)
    const area = f && !f.archived ? areaOf.get(f.areaId) : undefined
    if (!f || !area) continue
    const total = fb.mode === 'total'
    const footings = total ? 1 : f.quantity ?? 1
    const sentinel = total ? '#bolt-total' : ''
    for (const it of itemsOf(boltAsComponent(fb))) {
      const key = reqKey(area.id, it, f.number)
      const g = groups.get(key) ?? { key, id: requirementId(key), areaId: area.id, areaName: area.name, category: it.category, name: it.name, spec: it.spec, size: it.size, required: 0, parts: [], anchorageCodes: [], expression: '', designation: f.number }
      const part = g.parts.find((p) => p.anchorageTypeId === sentinel && p.each === it.each)
      if (part) part.instances += footings; else g.parts.push({ anchorageTypeId: sentinel, code: 'Footing', instances: footings, each: it.each })
      g.required += it.each * footings
      groups.set(key, g)
    }
  }
  // Embed plates chosen for individual foundations (A-1, A-2…): each is one footing needing that many of a library embed plate. They merge into the
  // same requirement as an identical library embed plate, so a specification is never listed twice.
  const compById = componentMap(c)
  for (const u of c.foundationUnits ?? []) {
    const f = c.foundations.find((x) => x.id === u.foundationId)
    const area = f && !f.archived ? areaOf.get(f.areaId) : undefined
    if (!f || !area) continue
    for (const e of u.embeds) {
      const comp = compById.get(e.componentId)
      if (!comp || comp.kind !== 'embed-plate') continue
      const code = typeOf.get(comp.anchorageTypeId)?.code ?? f.number
      for (const it of itemsOf({ ...comp, qty: e.qty })) {
        const key = reqKey(area.id, it, typeOf.get(comp.anchorageTypeId)?.code || f.number)
        const g = groups.get(key) ?? { key, id: requirementId(key), areaId: area.id, areaName: area.name, category: it.category, name: it.name, spec: it.spec, size: it.size, required: 0, parts: [], anchorageCodes: [], expression: '', designation: typeOf.get(comp.anchorageTypeId)?.code || f.number }
        const part = g.parts.find((p) => p.anchorageTypeId === '#unit' && p.each === it.each && p.code === code)
        if (part) part.instances += 1; else g.parts.push({ anchorageTypeId: '#unit', code, instances: 1, each: it.each })
        g.required += it.each
        groups.set(key, g)
      }
    }
  }
  // Embed plates added directly to a foundation: per foundation (× its footings) or a total. Same requirement key as the library's identical plate.
  for (const fe of c.foundationEmbeds ?? []) {
    const f = c.foundations.find((x) => x.id === fe.foundationId)
    const area = f && !f.archived ? areaOf.get(f.areaId) : undefined
    const comp = embedComponent(fe, compById)
    if (!f || !area || !comp || comp.kind !== 'embed-plate') continue
    const code = typeOf.get(comp.anchorageTypeId)?.code ?? f.number
    const each = fe.mode === 'per-foundation'
    for (const it of itemsOf({ ...comp, qty: fe.qty })) {
      const key = reqKey(area.id, it, typeOf.get(comp.anchorageTypeId)?.code || f.number)
      const g = groups.get(key) ?? { key, id: requirementId(key), areaId: area.id, areaName: area.name, category: it.category, name: it.name, spec: it.spec, size: it.size, required: 0, parts: [], anchorageCodes: [], expression: '', designation: typeOf.get(comp.anchorageTypeId)?.code || f.number }
      const id = each ? '#embed-each' : '#embed-total'
      const n = each ? (f.quantity ?? 1) : 1
      const part = g.parts.find((p) => p.anchorageTypeId === id && p.each === it.each && p.code === code)
      if (part) part.instances += n; else g.parts.push({ anchorageTypeId: id, code, instances: n, each: it.each })
      g.required += it.each * n
      groups.set(key, g)
    }
  }
  return [...groups.values()].map((g) => {
    g.parts.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
    g.anchorageCodes = g.parts.map((p) => p.code)
    g.expression = `${g.parts.map((p) => (p.anchorageTypeId === '' ? `${fmt(p.each)} per footing × ${fmt(p.instances)} footing${p.instances === 1 ? '' : 's'}` : p.anchorageTypeId === '#unit' ? `${fmt(p.each)} on each of ${fmt(p.instances)} individual foundation${p.instances === 1 ? '' : 's'}` : p.anchorageTypeId === '#embed-each' ? `${fmt(p.each)} per foundation × ${fmt(p.instances)} foundation${p.instances === 1 ? '' : 's'}` : p.anchorageTypeId === '#embed-total' ? `${fmt(p.each * p.instances)} in total` : p.anchorageTypeId === '#bolt-total' ? `${fmt(p.each * p.instances)} extra on the footings, in total` : `${fmt(p.each)} per anchorage × ${fmt(p.instances)} ${p.code}`)).join(' + ')}${g.parts.length > 1 ? ` = ${fmt(g.required)}` : ''}`
    return g
  }).sort((a, b) => a.areaName.localeCompare(b.areaName, 'en') || a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.spec.localeCompare(b.spec))
}

/* ── Quantities entered per anchorage / plinth / footing ─────────────────── */

export const BASIS_LABEL: Record<QtyBasis, string> = {
  fixed: 'Fixed total', 'per-anchorage': 'Per anchorage', 'per-plinth': 'Per plinth', 'per-footing': 'Per footing',
}
const UNIT_WORD: Record<QtyBasis, [string, string]> = { fixed: ['', ''], 'per-anchorage': ['anchorage', 'anchorages'], 'per-plinth': ['plinth', 'plinths'], 'per-footing': ['footing', 'footings'] }

/**
 * How many of the chosen thing a foundation has: footings are its physical foundations, plinths are the quantity times its plinths, and
 * anchorages are the plinths that use the chosen anchorage type. null = it cannot be counted (nothing chosen, or the plinths are not known).
 */
export function multiplierFor(c: RefSource, basis: QtyBasis, foundationId: string | null | undefined, anchorageTypeId: string | null | undefined): { count: number; note?: string } | { error: string } {
  if (basis === 'fixed') return { count: 1 }
  const f = c.foundations.find((x) => x.id === foundationId)
  if (!f) return { error: 'Choose the foundation this quantity is counted on.' }
  const qty = f.quantity ?? 1
  if (basis === 'per-footing') return { count: qty }
  const mine = c.plinths.filter((p) => p.foundationId === f.id)
  if (basis === 'per-plinth') return mine.length === 0 ? { error: `${f.number} has no plinths yet, so a per-plinth quantity cannot be calculated.` } : { count: qty * mine.length }
  if (!anchorageTypeId) return { error: 'Choose the anchorage type this quantity is counted per.' }
  const n = mine.filter((p) => p.anchorageTypeId === anchorageTypeId).length
  return n === 0 ? { error: `${f.number} has no plinths with that anchorage type.` } : { count: qty * n }
}

export function scopedCalc(c: RefSource, basis: QtyBasis, each: number, foundationId: string | null | undefined, anchorageTypeId: string | null | undefined): { total: number; calc: QuantityCalc } | { error: string } {
  if (basis === 'fixed') return { total: each, calc: { kind: 'entered', formula: null, expression: 'Entered in Nexus', recomputed: null } }
  const m = multiplierFor(c, basis, foundationId, anchorageTypeId)
  if ('error' in m) return m
  const f = c.foundations.find((x) => x.id === foundationId)!
  const word = UNIT_WORD[basis][m.count === 1 ? 0 : 1]
  const total = each * m.count
  const where = basis === 'per-anchorage' ? `${c.anchorageTypes.find((t) => t.id === anchorageTypeId)?.code ?? 'anchorage'} on ${f.number}` : f.number
  return { total, calc: { kind: 'derived', formula: null, expression: `${fmt(each)} ${BASIS_LABEL[basis].toLowerCase()} × ${fmt(m.count)} ${word} (${where}) = ${fmt(total)}`, recomputed: total } }
}

/* ── Keeping lines up to date ───────────────────────────────────────────── */

const hasOps = (l: TrackerLine) => l.receipts.length > 0 || l.orderedQty !== null || l.confirmedNoReceipts || !!l.notes || !!l.supplier || !!l.supplierId || !!l.poRef || !!l.expectedDate || !!l.archived

let seq = 0
const entry = (at: string, l: TrackerLine, action: AuditEntry['action'], summary: string, changes: AuditEntry['changes'] = []): AuditEntry =>
  ({ id: `au-req-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, by: '', action, materialId: l.id, label: l.component, summary, changes })

/**
 * Brings calculated requirements and "per anchorage / plinth / footing" quantities up to date with the foundations and the Anchorage
 * Library. Only the required quantity and its calculation are touched: orders, receipts, suppliers, dates and notes are never changed. A
 * requirement that stops applying is removed if nothing was ever recorded against it, otherwise kept and marked so. With `log` the
 * changes are written to the material history (by the system); the display-only refresh leaves the history alone.
 */
export function refreshRequirements(s: TrackerState, c: RefSource | undefined, opts: { log: boolean; at?: string } = { log: false }): TrackerState {
  if (!c) return s
  const at = opts.at ?? new Date().toISOString()
  const log: AuditEntry[] = []
  const reqs = deriveRequirements(c)
  const byKey = new Map(reqs.map((r) => [r.key, r]))
  // A calculated line saved before requirements were separated by designation has the old key. When exactly one requirement now stands for it (and no
  // existing line already has that requirement), it continues as that requirement: same line, same orders and deliveries, new key. A line the old key
  // cannot be matched to alone (several designations used to share it) is kept, marked no longer required, with everything recorded on it.
  const exact = new Set((s.manual ?? []).filter((l) => l.origin === 'anchorage' && l.deriveKey && byKey.has(l.deriveKey)).map((l) => l.deriveKey as string))
  const byLegacy = new Map<string, Requirement[]>()
  for (const r of reqs) if (r.designation) byLegacy.set(legacyReqKey(r.key, r.designation), [...(byLegacy.get(legacyReqKey(r.key, r.designation)) ?? []), r])
  let changed = false
  const next: TrackerLine[] = []
  const seen = new Set<string>()
  for (const l of s.manual ?? []) {
    if (l.origin === 'anchorage' && l.deriveKey) {
      let r = byKey.get(l.deriveKey)
      if (!r) { const cand = (byLegacy.get(l.deriveKey) ?? []).filter((x) => !exact.has(x.key)); if (cand.length === 1) { r = cand[0]; exact.add(r.key); changed = true } }
      seen.add(r?.key ?? l.deriveKey)
      if (!r) {
        if (!hasOps(l)) { changed = true; continue } // never ordered or received: simply no longer a requirement
        if (!l.requirementRemoved || l.requiredQty !== 0) {
          changed = true
          if (opts.log) log.push(entry(at, l, 'quantity', `No longer required (the anchorage configuration changed); ${l.requiredQty.toLocaleString('en-CA')} was required. Orders and deliveries are kept.`, [{ field: 'Required', from: String(l.requiredQty), to: '0' }]))
          next.push({ ...l, requiredQty: 0, requirementRemoved: true, breakdown: [] })
        } else next.push(l)
        continue
      }
      const calc: QuantityCalc = { kind: 'derived', formula: null, expression: r.expression, recomputed: r.required }
      const updated: TrackerLine = { ...l, deriveKey: r.key, designation: r.designation, requiredQty: r.required, calc, breakdown: r.parts, anchorageType: r.anchorageCodes.join(', '), area: r.areaName, areaId: r.areaId, requirementRemoved: false }
      if (l.deriveKey !== r.key || (l.designation ?? '') !== r.designation || l.requiredQty !== r.required || l.calc.expression !== r.expression || l.requirementRemoved || l.area !== r.areaName || l.anchorageType !== updated.anchorageType) {
        changed = true
        if (opts.log && l.requiredQty !== r.required) log.push(entry(at, l, 'quantity', `Required quantity recalculated ${l.requiredQty.toLocaleString('en-CA')} → ${r.required.toLocaleString('en-CA')} (${r.expression})`, [{ field: 'Required', from: String(l.requiredQty), to: String(r.required) }]))
        next.push(updated)
      } else next.push(l)
      continue
    }
    if (l.origin === 'manual' && l.basis && l.basis !== 'fixed' && l.qtyEach != null && !l.archived) {
      const r = scopedCalc(c, l.basis, l.qtyEach, l.foundationId, l.anchorageTypeId)
      if (!('error' in r) && (r.total !== l.requiredQty || r.calc.expression !== l.calc.expression)) {
        changed = true
        if (opts.log && r.total !== l.requiredQty) log.push(entry(at, l, 'quantity', `Required quantity recalculated ${l.requiredQty.toLocaleString('en-CA')} → ${r.total.toLocaleString('en-CA')} (${r.calc.expression})`, [{ field: 'Required', from: String(l.requiredQty), to: String(r.total) }]))
        next.push({ ...l, requiredQty: r.total, calc: r.calc })
        continue
      }
    }
    next.push(l)
  }
  for (const r of reqs) {
    if (seen.has(r.key)) continue
    changed = true
    const line: TrackerLine = {
      id: r.id, origin: 'anchorage', deriveKey: r.key, designation: r.designation, breakdown: r.parts, source: { sheet: 'Anchorage library', row: 0 }, area: r.areaName, footingType: '', anchorageType: r.anchorageCodes.join(', '), footings: 0, plinths: 0, bolts: 0,
      component: r.name, category: r.category, requiredQty: r.required, calc: { kind: 'derived', formula: null, expression: r.expression, recomputed: r.required }, sourceStatus: '', sourceNotes: [],
      orderedQty: null, receipts: [], confirmedNoReceipts: false, notes: '', description: '', specification: r.spec, size: r.size, unit: 'ea', poRef: '', expectedDate: null, archived: false,
      areaId: r.areaId, foundationId: null, anchorageTypeId: r.parts.length === 1 && !r.parts[0].anchorageTypeId.startsWith('#') ? r.parts[0].anchorageTypeId || null : null, supplierId: null, supplier: '', createdAt: at, createdBy: '',
    }
    if (opts.log) log.push(entry(at, line, 'created', `Calculated from the anchorage library: ${r.required.toLocaleString('en-CA')} required (${r.expression})`))
    next.push(line)
  }
  if (!changed) return s
  return { ...s, manual: next, history: opts.log ? [...(s.history ?? []), ...log] : s.history }
}

/**
 * The calculated requirements worked out a second, deliberately plain way: for every foundation, footing quantity × plinths of the type ×
 * quantity of each item per anchorage, counted straight from the plinth records. Used to check `deriveRequirements`; both must agree.
 */
export function expectedTotals(c: RefSource): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of c.foundations) {
    if (f.archived) continue
    const footings = f.quantity ?? 1
    const all = componentMap(c)
    const overridden = (c.foundationUnits ?? []).filter((u) => u.foundationId === f.id && u.embeds.some((e) => all.get(e.componentId)?.kind === 'embed-plate')).length
    for (const p of c.plinths) {
      if (p.foundationId !== f.id || !p.anchorageTypeId) continue
      for (const comp of (c.anchorageComponents ?? []).filter((x) => x.anchorageTypeId === p.anchorageTypeId)) {
        const n = comp.kind === 'embed-plate' ? ((c.foundationEmbeds ?? []).some((e) => e.foundationId === f.id && e.componentId === comp.id) ? 0 : Math.max(0, footings - overridden)) : footings
        for (const it of itemsOf(comp)) {
          const key = reqKey(f.areaId, it, c.anchorageTypes.find((t) => t.id === p.anchorageTypeId)?.code ?? '')
          out.set(key, (out.get(key) ?? 0) + n * it.each)
        }
      }
    }
    for (const e of (c.foundationEmbeds ?? []).filter((x) => x.foundationId === f.id)) {
      const comp = embedComponent(e, all)
      if (!comp || comp.kind !== 'embed-plate') continue
      for (const it of itemsOf({ ...comp, qty: e.qty })) {
        const key = reqKey(f.areaId, it, c.anchorageTypes.find((t) => t.id === comp.anchorageTypeId)?.code || f.number)
        out.set(key, (out.get(key) ?? 0) + it.each * (e.mode === 'total' ? 1 : footings))
      }
    }
    for (const u of (c.foundationUnits ?? []).filter((x) => x.foundationId === f.id)) {
      for (const e of u.embeds) {
        const comp = all.get(e.componentId)
        if (!comp || comp.kind !== 'embed-plate') continue
        for (const it of itemsOf({ ...comp, qty: e.qty })) {
          const key = reqKey(f.areaId, it, c.anchorageTypes.find((t) => t.id === comp.anchorageTypeId)?.code || f.number)
          out.set(key, (out.get(key) ?? 0) + it.each)
        }
      }
    }
    for (const b of (c.foundationBolts ?? []).filter((x) => x.foundationId === f.id)) {
      for (const it of itemsOf(boltAsComponent(b))) {
        const key = reqKey(f.areaId, it, f.number)
        out.set(key, (out.get(key) ?? 0) + (b.mode === 'total' ? 1 : footings) * it.each)
      }
    }
  }
  return out
}
