import type { Foundation, Plinth } from './types'

/**
 * A foundation row is a DESIGNATION: one name that may stand for several physical foundations (`quantity`). Plinths per foundation is
 * what each individual foundation has. Totals are always calculated (quantity × plinths per foundation), never entered. An unknown
 * plinth count stays unknown — it is not treated as zero.
 */
export const foundationQuantity = (f: Foundation) => f.quantity ?? 1

/** Plinths on each physical foundation, or null when not known. Without a stored value it is the number of plinth records the foundation has. */
export function plinthsPerFoundation(f: Foundation, plinthRecords: number): number | null {
  return f.plinthsPerFoundation === undefined ? plinthRecords : f.plinthsPerFoundation
}

/**
 * Plinths on each physical foundation, from its anchorage groups when it has them (the sum of the groups' counts), otherwise from the stored
 * count / plinth records as before. null = not known. The register's total is this × the foundation quantity.
 */
export function plinthsPerFoundationFromGroups(f: Foundation, plinthRecords: number, groups: { count: number }[]): number | null {
  return groups.length > 0 ? groups.reduce((t, g) => t + g.count, 0) : plinthsPerFoundation(f, plinthRecords)
}

export function totalPlinths(f: Foundation, plinthRecords: number): number | null {
  const per = plinthsPerFoundation(f, plinthRecords)
  return per === null ? null : foundationQuantity(f) * per
}

export interface FoundationTotals {
  /** Distinct foundation names (designations). */
  designations: number
  /** Physical foundations: the sum of quantities. */
  physical: number
  /** Plinths counted only for designations whose plinth count is known. */
  knownPlinths: number
  /** Designations whose plinth count is not known, and so are left out of `knownPlinths`. */
  unknownDesignations: number
}

export function foundationTotals(foundations: Foundation[], plinths: Plinth[]): FoundationTotals {
  const count = new Map<string, number>()
  for (const p of plinths) count.set(p.foundationId, (count.get(p.foundationId) ?? 0) + 1)
  const t: FoundationTotals = { designations: foundations.length, physical: 0, knownPlinths: 0, unknownDesignations: 0 }
  for (const f of foundations) {
    t.physical += foundationQuantity(f)
    const total = totalPlinths(f, count.get(f.id) ?? 0)
    if (total === null) t.unknownDesignations++
    else t.knownPlinths += total
  }
  return t
}

