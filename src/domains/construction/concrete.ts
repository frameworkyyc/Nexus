import type { AnchorageGroup, Dims, Foundation, LengthUnit, Plinth } from './types'
import { foundationQuantity } from './foundationQuantity'

/** Metres per unit. Every dimension is converted to metres before multiplying, so a volume never depends on the unit it was typed in. */
export const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft']
const METRES: Record<LengthUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 }
export const isLengthUnit = (u: unknown): u is LengthUnit => typeof u === 'string' && u in METRES
export const toMetres = (value: number, unit: LengthUnit) => value * METRES[unit]

export const hasAnyDim = (d: Dims | null | undefined) => !!d && (d.length !== null || d.width !== null || d.height !== null)
const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0

/** Rectangular volume in m³, or null unless length, width and height are all given and positive. Missing is never treated as zero. */
export function boxVolumeM3(d: Dims | null | undefined): number | null {
  if (!d || !valid(d.length) || !valid(d.width) || !valid(d.height)) return null
  return toMetres(d.length, d.unit) * toMetres(d.width, d.unit) * toMetres(d.height, d.unit)
}

/** What is wrong with a set of dimensions the user entered, or null. Blank is allowed (dimensions are optional). */
export function dimsProblem(d: Dims | null | undefined, label: string): string | null {
  if (!d) return null
  if (!isLengthUnit(d.unit)) return `${label}: choose a unit (mm, cm, m, in or ft).`
  for (const [k, v] of [['length', d.length], ['width', d.width], ['height', d.height]] as const) {
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1_000_000)) return `${label}: ${k} must be a number greater than zero, or left blank.`
  }
  return null
}

export const volumeLabel = (m3: number) => `${m3.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} m³`
export const dimsLabel = (d: Dims | null | undefined) => (hasAnyDim(d) ? `${d!.length ?? '?'} × ${d!.width ?? '?'} × ${d!.height ?? '?'} ${d!.unit}` : '')

export type PlinthSource = 'plinth' | 'group' | 'none'
export interface PlinthConcrete {
  plinthId: string
  index: number
  anchorageTypeId: string | null
  groupId: string | null
  dims: Dims | null
  source: PlinthSource
  /** Full box volume of the plinth, m³. null = dimensions missing. */
  gross: number | null
  /** Volume that is poured with the plinth (excludes any part inside the footing), m³. null = cannot be calculated. */
  net: number | null
  note: string
}

export interface FoundationConcrete {
  quantity: number
  /** Volume of one footing, m³. null = footing dimensions missing. */
  footing: number | null
  plinths: PlinthConcrete[]
  /** Sum of the plinths that can be calculated, per foundation. */
  plinthsKnown: number
  plinthsMissing: number
  /** Total per physical foundation; null while anything is missing. */
  perFoundation: number | null
  /** What can be said so far per foundation (known parts only) — always paired with `complete`. */
  perFoundationKnown: number
  complete: boolean
  /** Totals across the quantity. */
  totalFooting: number | null
  totalPlinths: number | null
  total: number | null
  totalKnown: number
  warnings: string[]
  missing: string[]
}

/** The dimensions a plinth really uses: its own override, else its anchorage group's default. An incomplete override is reported, not silently replaced. */
export function effectivePlinthDims(p: Plinth, groups: AnchorageGroup[]): { dims: Dims | null; source: PlinthSource } {
  if (hasAnyDim(p.dims)) return { dims: p.dims!, source: 'plinth' }
  const g = p.groupId ? groups.find((x) => x.id === p.groupId) : undefined
  if (g && hasAnyDim(g.dims)) return { dims: g.dims, source: 'group' }
  return { dims: null, source: 'none' }
}

/**
 * Concrete for one foundation designation, in m³: footing, each plinth, per physical foundation and across its quantity.
 *  - Footing and plinths are rectangular boxes. Anything not yet measured makes the total "incomplete" and is listed — it is never counted as zero.
 *  - `plinthBase: 'above-footing'` (default): a plinth's height is measured above the footing, so the volumes are separate.
 *  - `plinthBase: 'from-footing-base'`: the height includes the part inside the footing; that part is already in the footing volume and is
 *    deducted from the plinth so no concrete is counted twice.
 */
export function foundationConcrete(f: Foundation, plinths: Plinth[], groups: AnchorageGroup[]): FoundationConcrete {
  const quantity = foundationQuantity(f)
  const footing = boxVolumeM3(f.footing)
  const footingHeightM = f.footing && valid(f.footing.height) ? toMetres(f.footing.height, f.footing.unit) : null
  const fromBase = (f.plinthBase ?? 'above-footing') === 'from-footing-base'
  const warnings: string[] = []
  const missing: string[] = []
  const rows = plinths.filter((p) => p.foundationId === f.id).sort((a, b) => a.index - b.index).map((p): PlinthConcrete => {
    const { dims, source } = effectivePlinthDims(p, groups)
    const gross = boxVolumeM3(dims)
    let net: number | null = gross
    if (gross !== null && fromBase) {
      const h = toMetres(dims!.height!, dims!.unit)
      const footprint = toMetres(dims!.length!, dims!.unit) * toMetres(dims!.width!, dims!.unit)
      if (footingHeightM === null) net = null
      else if (h <= footingHeightM) { net = 0; warnings.push(`Plinth ${p.index} is no taller than the footing, so all of it lies inside the footing and adds no concrete.`) }
      else net = footprint * (h - footingHeightM)
    }
    return { plinthId: p.id, index: p.index, anchorageTypeId: p.anchorageTypeId, groupId: p.groupId ?? null, dims, source, gross, net, note: p.notes }
  })
  if (footing === null) missing.push('footing dimensions')
  const plinthsMissing = rows.filter((r) => r.net === null).length
  if (plinthsMissing) missing.push(fromBase && footingHeightM === null && rows.some((r) => r.gross !== null && r.net === null) ? `footing height (needed to deduct the part of the plinths inside the footing) and ${plinthsMissing} plinth${plinthsMissing === 1 ? '' : 's'} with dimensions` : `${plinthsMissing} plinth${plinthsMissing === 1 ? '' : 's'} without complete dimensions`)
  const plinthsKnown = rows.reduce((t, r) => t + (r.net ?? 0), 0)
  // Overlap sanity: plinths cannot cover more than the footing they stand on.
  if (f.footing && valid(f.footing.length) && valid(f.footing.width)) {
    const footprint = toMetres(f.footing.length, f.footing.unit) * toMetres(f.footing.width, f.footing.unit)
    const covered = rows.reduce((t, r) => t + (r.dims && valid(r.dims.length) && valid(r.dims.width) ? toMetres(r.dims.length, r.dims.unit) * toMetres(r.dims.width, r.dims.unit) : 0), 0)
    if (covered > footprint * (1 + 1e-9)) warnings.push('The plinth footprints add up to more than the footing area. Check the dimensions.')
  }
  const complete = footing !== null && plinthsMissing === 0
  const perFoundationKnown = (footing ?? 0) + plinthsKnown
  const perFoundation = complete ? perFoundationKnown : null
  return {
    quantity, footing, plinths: rows, plinthsKnown, plinthsMissing, perFoundation, perFoundationKnown, complete,
    totalFooting: footing === null ? null : footing * quantity,
    totalPlinths: plinthsMissing ? null : plinthsKnown * quantity,
    total: perFoundation === null ? null : perFoundation * quantity,
    totalKnown: perFoundationKnown * quantity,
    warnings, missing,
  }
}

/** Plinth counts and volumes grouped by anchorage type (null = unassigned) for one foundation, per physical foundation and across its quantity. */
export function concreteByAnchorage(c: FoundationConcrete) {
  const m = new Map<string | null, { typeId: string | null; plinths: number; known: number; missing: number }>()
  for (const p of c.plinths) {
    const e = m.get(p.anchorageTypeId) ?? { typeId: p.anchorageTypeId, plinths: 0, known: 0, missing: 0 }
    e.plinths++; e.known += p.net ?? 0; if (p.net === null) e.missing++
    m.set(p.anchorageTypeId, e)
  }
  return [...m.values()].map((e) => ({ ...e, plinthsTotal: e.plinths * c.quantity, knownTotal: e.known * c.quantity }))
}
