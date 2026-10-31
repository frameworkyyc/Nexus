import { displayName, specText } from '../tracker/consolidate'
import { availableToOrder, coveredQty, type ProcRow } from '../tracker/procurement'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../tracker/selectors'
import type { ComponentCategory } from '../tracker/types'

/** The area a requirement belongs to, as the Procurement page keys it (a requirement with no area record is keyed by its area name). */
export const areaKey = (r: Pick<ProcRow, 'areaId' | 'area'>) => r.areaId ?? `t:${r.area}`

/** Requirements that can still be put on a new order: required, not already covered by live orders or by anything received, and not already on the order being built. */
export const orderableRows = (rows: ProcRow[], taken: ReadonlySet<string> = new Set()): ProcRow[] =>
  rows.filter((r) => !r.orphan && r.required > 0 && availableToOrder(r) > 0 && !taken.has(r.key))

export interface AreaChoice { id: string; name: string; count: number }
/** Every area offered (so an area with nothing left to order can say so), with how many requirements in it can still be ordered. */
export function areaChoices(rows: ProcRow[], areas: { id: string; name: string }[], taken: ReadonlySet<string> = new Set()): AreaChoice[] {
  const open = orderableRows(rows, taken)
  const known = new Map<string, string>(areas.map((a) => [a.id, a.name]))
  for (const r of rows) if (!known.has(areaKey(r))) known.set(areaKey(r), r.area)
  return [...known].map(([id, name]) => ({ id, name, count: open.filter((r) => areaKey(r) === id).length }))
}

export interface CategoryChoice { category: ComponentCategory; label: string; count: number }
/** The material categories of one area that still have something to order, in the standard category order. Categories with nothing left are not offered. */
export function categoryChoices(rows: ProcRow[], areaId: string, taken: ReadonlySet<string> = new Set()): CategoryChoice[] {
  const open = orderableRows(rows, taken).filter((r) => areaKey(r) === areaId)
  return CATEGORY_ORDER.filter((c) => open.some((r) => r.category === c)).map((c) => ({ category: c, label: CATEGORY_LABEL[c], count: open.filter((r) => r.category === c).length }))
}

/** The materials of one area and category that can still be ordered, optionally narrowed by a search over their name, designation and specification. */
export function materialChoices(rows: ProcRow[], areaId: string, category: ComponentCategory, search = '', taken: ReadonlySet<string> = new Set()): ProcRow[] {
  const q = search.trim().toLowerCase()
  return orderableRows(rows, taken)
    .filter((r) => areaKey(r) === areaId && r.category === category && (!q || `${displayName(r)} ${specText(r)}`.toLowerCase().includes(q)))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)) || specText(a).localeCompare(specText(b)))
}

/** What the order form shows for a chosen requirement. */
export const orderFigures = (r: ProcRow) => ({ required: r.required, covered: coveredQty(r), available: availableToOrder(r) })

/** Combines lines that name the same requirement into one (their quantities added), keeping the order they first appeared in. */
export function mergeLines<T extends { key: string; qty: number }>(lines: T[]): T[] {
  const out = new Map<string, T>()
  for (const l of lines) { const hit = out.get(l.key); out.set(l.key, hit ? { ...hit, qty: hit.qty + l.qty } : { ...l }) }
  return [...out.values()]
}

/** Why a quantity cannot be ordered for this requirement, or null. */
export function quantityProblem(r: ProcRow | undefined, qty: number): string | null {
  if (!r) return 'This material is no longer required.'
  const { available } = orderFigures(r)
  if (!Number.isInteger(qty) || qty < 1) return 'Enter a whole number of 1 or more.'
  if (available === 0) return 'Already fully ordered.'
  if (qty > available) return `Only ${available.toLocaleString('en-CA')} available to order.`
  return null
}
