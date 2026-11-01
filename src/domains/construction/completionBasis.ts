import { percentOf } from '@/lib/format'
import { isConstructionCategory, isDone, getDef } from './config'
import { concreteOf, compKey, componentVolume, itemKey } from './pours'
import { effectiveStatus, foundationActivities, progressOf, type Index } from './selectors'
import { foundationQuantity } from './foundationQuantity'
import type { ConstructionState, Foundation } from './types'

/**
 * What a completion percentage is weighted by.
 *  - type:   the existing calculation. Every footing and every plinth record is one element worth the same; quantity and size are ignored.
 *  - count:  each foundation designation is weighted by how many individual foundations it stands for (its quantity).
 *  - volume: each footing and plinth is weighted by its concrete volume (m³) across the quantity.
 * Under every basis an element's own completion is the same: the average of its rebar (built and installed, split evenly), forming and pouring stages.
 * Count and volume also credit concrete actually poured (see `pourFraction`), so a half-poured designation is not shown as untouched or as finished.
 */
export type CompletionBasis = 'type' | 'count' | 'volume'
export const DEFAULT_BASIS: CompletionBasis = 'type'
export const COMPLETION_BASES: { id: CompletionBasis; label: string; short: string; description: string }[] = [
  { id: 'type', label: 'Foundation type', short: 'Type', description: 'Existing calculation: every footing and plinth record counts equally, whatever its quantity or size.' },
  { id: 'count', label: 'Foundation count', short: 'Count', description: 'Each foundation type counts by how many individual foundations it represents.' },
  { id: 'volume', label: 'Concrete volume', short: 'Volume', description: 'Each footing and plinth counts by its concrete volume in m³. Where concrete has been recorded as poured, the volume actually poured counts.' },
]
export const isBasis = (v: unknown): v is CompletionBasis => v === 'type' || v === 'count' || v === 'volume'

interface Element {
  foundationId: string
  plinthId: string | null
  /** The stage average from activity statuses alone (what `progressOf` uses). */
  fraction: number
  /** The same, with the pouring stage raised to the concrete actually poured, where pours are recorded. */
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

/** One designation's footing and plinth elements. Owners are found exactly as `progressOf` finds them, so the type basis matches it to the digit. */
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
  return [...owners.values()].map(({ plinthId, acts }) => {
    const done = (key: string) => { const a = acts.find((x) => x.key === key); return a && isDone(effectiveStatus(idx, a)) ? 1 : 0 }
    const stages = (poured: number) => ((done('rebarBuilt') + done('rebarInstalled')) / 2 + done('formed') + poured) / 3
    const perUnit = componentVolume(concrete, plinthId)
    return {
      foundationId: f.id,
      plinthId,
      fraction: stages(done('poured')),
      credited: stages(Math.max(done('poured'), pourFraction(idx.state, f.id, plinthId, quantity, perUnit))),
      volume: perUnit === null ? null : perUnit * quantity,
    }
  })
}

export interface BasisResult {
  basis: CompletionBasis
  /** Whole percent, or null when it cannot be worked out (no foundations to weight, or no concrete volume known) — never shown as 0%. The type basis is `progressOf` unchanged. */
  percent: number | null
  /** The figures the percentage is made of: `done` of `total`, in `unit`. Equal weighting of partial work, so `done` can be fractional. */
  done: number
  total: number
  unit: 'footings and plinths' | 'foundations' | 'm³'
  /** Volume basis only: elements left out because their concrete volume is unknown, and the designations they belong to. null = nothing missing. */
  missing: { elements: number; of: number; foundations: string[]; knownM3: number } | null
}

/** Completion of a set of foundation designations under one basis. */
export function completionOf(idx: Index, foundations: Foundation[], basis: CompletionBasis): BasisResult {
  if (basis === 'type') {
    const acts = foundations.flatMap((f) => foundationActivities(idx, f))
    const els = foundations.flatMap((f) => elementsOf(idx, f))
    return { basis, percent: progressOf(idx, acts), done: els.reduce((t, e) => t + e.fraction, 0), total: els.length, unit: 'footings and plinths', missing: null }
  }
  if (basis === 'count') {
    let done = 0
    let total = 0
    for (const f of foundations) {
      const els = elementsOf(idx, f)
      if (!els.length) continue
      const q = foundationQuantity(f)
      done += q * (els.reduce((t, e) => t + e.credited, 0) / els.length)
      total += q
    }
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
  const digits = r.unit === 'm³' ? 1 : Number.isInteger(r.done) && Number.isInteger(r.total) ? 0 : 1
  return `${fmt(r.done, digits)} of ${fmt(r.total, digits)} ${r.unit}`
}
/** What is left out of a volume figure, in words; null when nothing is. */
export function basisWarning(r: BasisResult): string | null {
  if (!r.missing) return null
  const m = r.missing
  const where = m.foundations.length <= 3 ? m.foundations.join(', ') : `${m.foundations.slice(0, 3).join(', ')} and ${m.foundations.length - 3} more`
  return `Concrete volume is not entered for ${m.elements} of ${m.of} footings and plinths (${where}). They are left out of this figure, not counted as zero.`
}
