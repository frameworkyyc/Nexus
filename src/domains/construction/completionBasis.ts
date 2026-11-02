import { percentOf } from '@/lib/format'
import { INSTALL_KEYS, isConstructionCategory, isDone, getDef } from './config'
import { concreteOf, compKey, componentVolume, itemKey } from './pours'
import { elementStages, effectiveStatus, foundationActivities, type Index } from './selectors'
import { foundationQuantity } from './foundationQuantity'
import type { ConstructionState, Foundation } from './types'

/**
 * What a completion percentage is weighted by. Only the weighting differs: under every basis a designation's progress is built from the same
 * construction stages of its footing and plinth records (rebar built and installed split evenly, forming, pouring, and anchor bolt installation where bolts are required; each record is the average of
 * its stages, a designation is the average of its records), with the pouring stage raised to the concrete actually poured where pours are recorded.
 *  - type:   each foundation designation (one code, whatever its quantity, plinth count or size) counts once. 50% done contributes half, finished contributes all.
 *  - count:  each designation is weighted by how many physical foundations it represents (its quantity).
 *  - volume: each footing and plinth record is weighted by its concrete volume (m³) across the quantity.
 */
export type CompletionBasis = 'type' | 'count' | 'volume'
export const DEFAULT_BASIS: CompletionBasis = 'type'
export const COMPLETION_BASES: { id: CompletionBasis; label: string; short: string; description: string }[] = [
  { id: 'type', label: 'Foundation type', short: 'Type', description: 'Each foundation type counts equally, whatever its quantity, number of plinths or size. Partial work counts in proportion.' },
  { id: 'count', label: 'Foundation count', short: 'Count', description: 'Each foundation type counts by how many individual foundations it represents.' },
  { id: 'volume', label: 'Concrete volume', short: 'Volume', description: 'Each footing and plinth counts by its concrete volume in m³. Where concrete has been recorded as poured, the volume actually poured counts.' },
]
export const isBasis = (v: unknown): v is CompletionBasis => v === 'type' || v === 'count' || v === 'volume'

interface Element {
  foundationId: string
  plinthId: string | null
  /** Stage average, 0–1: rebar (built and installed split evenly), forming and pouring, the pouring stage raised to the concrete actually poured where pours are recorded. */
  credited: number
  /** Concrete in m³ across the foundation's quantity; null = the dimensions needed are not entered (never treated as zero). */
  volume: number | null
}

/** Pour records by physical component, built once per state: completed at all, and concrete placed so far across every pour. */
const pourCache = new WeakMap<ConstructionState, Map<string, { completed: boolean; poured: number }>>()
function pourIndex(s: ConstructionState) {
  let m = pourCache.get(s)
  if (!m) {
    m = new Map()
    for (const i of s.pourItems ?? []) {
      const e = m.get(itemKey(i)) ?? { completed: false, poured: 0 }
      e.completed ||= !!i.completedDate
      e.poured += i.pouredM3 ?? 0
      m.set(itemKey(i), e)
    }
    pourCache.set(s, m)
  }
  return m
}

/**
 * How much of one element's concrete has been placed, 0–1, from the pour records: each physical component (unit 1..quantity) is complete,
 * or has placed so far / its volume. A component whose volume is unknown counts only when it is recorded complete. Pours are recorded per
 * component and recording replaces rather than adds, so nothing is counted twice.
 */
function pourFraction(s: ConstructionState, foundationId: string, plinthId: string | null, quantity: number, volumePerUnit: number | null): number {
  const poured = pourIndex(s)
  let sum = 0
  for (let unit = 1; unit <= quantity; unit++) {
    const c = poured.get(compKey(foundationId, unit, plinthId))
    if (!c) continue
    if (c.completed) sum += 1
    else if (volumePerUnit !== null && volumePerUnit > 0) sum += Math.min(1, c.poured / volumePerUnit)
  }
  return sum / quantity
}

/** One designation's footing and plinth elements: an owner (footing or plinth record) with at least one construction activity. */
function elementsOf(idx: Index, f: Foundation): Element[] {
  const owners = new Map<string, { plinthId: string | null; acts: ReturnType<typeof foundationActivities> }>()
  for (const a of foundationActivities(idx, f)) {
    if (!isConstructionCategory(getDef(a.scope, a.key).category)) continue
    const key = a.plinthId ?? a.foundationId
    const e = owners.get(key) ?? { plinthId: a.plinthId, acts: [] }
    e.acts.push(a)
    owners.set(key, e)
  }
  if (!owners.size) return []
  const quantity = foundationQuantity(f)
  const concrete = concreteOf(idx.state, f)
  return [...owners.values()].flatMap(({ plinthId, acts }): Element[] => {
    const done = (key: string) => { const a = acts.find((x) => x.key === key); return a ? (isDone(effectiveStatus(idx, a)) ? 1 : 0) : null }
    const bolts = acts.filter((x) => INSTALL_KEYS.includes(x.key)).map((x) => (isDone(effectiveStatus(idx, x)) ? 1 : 0))
    const stages = (poured: number) => elementStages(done, bolts, poured)
    const perUnit = componentVolume(concrete, plinthId)
    const credited = stages(Math.max(done('poured') ?? 0, pourFraction(idx.state, f.id, plinthId, quantity, perUnit)))
    // Nothing of this footing or plinth is part of the project's scope: it neither adds to nor dilutes the completion.
    return credited === null ? [] : [{ foundationId: f.id, plinthId, credited, volume: perUnit === null ? null : perUnit * quantity }]
  })
}

export interface BasisResult {
  basis: CompletionBasis
  /** Whole percent, or null when it cannot be worked out (no foundations to weight, or no concrete volume known) — never shown as 0%. The type basis is `progressOf` unchanged. */
  percent: number | null
  /** The figures the percentage is made of: `done` of `total`, in `unit`. Equal weighting of partial work, so `done` can be fractional. */
  done: number
  total: number
  unit: 'foundation types' | 'foundations' | 'm³'
  /** Volume basis only: elements left out because their concrete volume is unknown, and the designations they belong to. null = nothing missing. */
  missing: { elements: number; of: number; foundations: string[]; knownM3: number } | null
}

/** Completion of a set of foundation designations under one basis. */
export function completionOf(idx: Index, foundations: Foundation[], basis: CompletionBasis): BasisResult {
  if (basis !== 'volume') {
    // One figure per designation (the average of its footing and plinth records); only the weight differs.
    let done = 0
    let total = 0
    for (const f of foundations) {
      const els = elementsOf(idx, f)
      if (!els.length) continue
      const w = basis === 'count' ? foundationQuantity(f) : 1
      done += w * (els.reduce((t, e) => t + e.credited, 0) / els.length)
      total += w
    }
    if (basis === 'type') return { basis, percent: percentOf(done, total), done, total, unit: 'foundation types', missing: null }
    return { basis, percent: percentOf(done, total), done, total, unit: 'foundations', missing: null }
  }
  let done = 0
  let total = 0
  let unknown = 0
  let all = 0
  const names = new Set<string>()
  for (const f of foundations) {
    for (const e of elementsOf(idx, f)) {
      all++
      if (e.volume === null) { unknown++; names.add(f.number); continue }
      done += e.volume * e.credited
      total += e.volume
    }
  }
  const missing = unknown ? { elements: unknown, of: all, foundations: [...names], knownM3: total } : null
  return { basis, percent: percentOf(done, total), done, total, unit: 'm³', missing }
}

const fmt = (n: number, digits: number) => n.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
/** "14.9 of 24 foundations", "412.6 of 665.0 m³": the figures behind the percentage. */
export function basisFigures(r: BasisResult): string {
  if (r.total === 0 && r.unit === 'm³') return 'No concrete volumes entered yet'
  const digits = (n: number) => (r.unit === 'm³' || !Number.isInteger(n) ? 1 : 0)
  return `${fmt(r.done, digits(r.done))} of ${fmt(r.total, digits(r.total))} ${r.unit}`
}
/** What is left out of a volume figure, in words; null when nothing is. */
export function basisWarning(r: BasisResult): string | null {
  if (!r.missing) return null
  const m = r.missing
  const where = m.foundations.length <= 3 ? m.foundations.join(', ') : `${m.foundations.slice(0, 3).join(', ')} and ${m.foundations.length - 3} more`
  return `Concrete volume is not entered for ${m.elements} of ${m.of} footings and plinths (${where}). They are left out of this figure, not counted as zero.`
}
