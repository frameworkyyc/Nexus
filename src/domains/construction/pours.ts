import { foundationConcrete, type FoundationConcrete } from './concrete'
import type { ConstructionState, Foundation, Pour, PourItem } from './types'

/** The component key of an item: 'footing' or the plinth id. One physical component = (foundation, unit number, key). */
export const itemKey = (i: Pick<PourItem, 'foundationId' | 'unit' | 'component' | 'plinthId'>) => `${i.foundationId}#${i.unit}#${i.plinthId ?? 'footing'}`
export const compKey = (foundationId: string, unit: number, plinthId: string | null) => `${foundationId}#${unit}#${plinthId ?? 'footing'}`

export const isOpen = (p: Pour) => p.status === 'planned' || p.status === 'scheduled'
export const PLAN_LABEL: Record<Pour['status'], string> = { planned: 'Planned', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' }

export const pourCounts = (s: ConstructionState) => ({ pours: s.pours ?? [], items: s.pourItems ?? [] })

export function concreteOf(s: ConstructionState, f: Foundation): FoundationConcrete {
  return foundationConcrete(f, s.plinths, (s.anchorageGroups ?? []).filter((g) => g.foundationId === f.id))
}

/** Planned volume (m³) of one component, from the foundation's current dimensions. null = cannot be calculated. */
export function componentVolume(c: FoundationConcrete, plinthId: string | null): number | null {
  return plinthId === null ? c.footing : c.plinths.find((p) => p.plinthId === plinthId)?.net ?? null
}

export type ComponentState = 'available' | 'planned' | 'partial' | 'completed'
export interface ComponentInfo { state: ComponentState; completedDate: string | null; inPour: Pour | null; pouredM3: number; override: string }

/** Where one physical component stands across every pour: never poured, planned in an open pour, partly poured, or completed. */
export function componentInfo(s: ConstructionState, foundationId: string, unit: number, plinthId: string | null): ComponentInfo {
  const key = compKey(foundationId, unit, plinthId)
  const pours = new Map((s.pours ?? []).map((p) => [p.id, p]))
  const items = (s.pourItems ?? []).filter((i) => itemKey(i) === key)
  const done = items.find((i) => i.completedDate)
  const pouredM3 = items.reduce((t, i) => t + (i.pouredM3 ?? 0), 0)
  if (done) return { state: 'completed', completedDate: done.completedDate, inPour: pours.get(done.pourId) ?? null, pouredM3, override: done.overrideReason }
  const open = items.find((i) => { const p = pours.get(i.pourId); return !!p && isOpen(p) })
  if (open) return { state: 'planned', completedDate: null, inPour: pours.get(open.pourId) ?? null, pouredM3, override: '' }
  return { state: pouredM3 > 0 ? 'partial' : 'available', completedDate: null, inPour: null, pouredM3, override: '' }
}

export const footingDone = (s: ConstructionState, foundationId: string, unit: number) => componentInfo(s, foundationId, unit, null).state === 'completed'

export interface PourTotals {
  footing: number
  plinths: number
  planned: number
  /** Items whose volume could not be calculated (dimensions missing): the total is then a minimum, never presented as complete. */
  unknownItems: number
  withWaste: number
  poured: number
  completedItems: number
  items: number
}

export function pourTotals(pour: Pour, items: PourItem[]): PourTotals {
  const mine = items.filter((i) => i.pourId === pour.id)
  const t: PourTotals = { footing: 0, plinths: 0, planned: 0, unknownItems: 0, withWaste: 0, poured: 0, completedItems: 0, items: mine.length }
  for (const i of mine) {
    if (i.plannedM3 === null) t.unknownItems++
    else if (i.component === 'footing') t.footing += i.plannedM3
    else t.plinths += i.plannedM3
    t.poured += i.pouredM3 ?? 0
    if (i.completedDate) t.completedItems++
  }
  t.planned = t.footing + t.plinths
  t.withWaste = t.planned * (1 + pour.wastePct / 100)
  return t
}

/** Remaining volume for an item still to be poured (planned minus poured so far). null when the plan had no volume. */
export const remainingM3 = (i: PourItem) => (i.plannedM3 === null ? null : i.completedDate ? 0 : Math.max(0, i.plannedM3 - (i.pouredM3 ?? 0)))

export interface PourBreakdownRow { key: string; foundationId: string; label: string; component: 'footing' | 'plinth'; anchorageTypeId: string | null; count: number; m3: number; unknown: number }

/** Breakdown of a pour by foundation, component and anchorage type (footings carry no anchorage type). */
export function pourBreakdown(s: ConstructionState, pour: Pour): PourBreakdownRow[] {
  const rows = new Map<string, PourBreakdownRow>()
  for (const i of (s.pourItems ?? []).filter((x) => x.pourId === pour.id)) {
    const f = s.foundations.find((x) => x.id === i.foundationId)
    const plinth = i.plinthId ? s.plinths.find((p) => p.id === i.plinthId) : undefined
    const type = plinth?.anchorageTypeId ?? null
    const key = `${i.foundationId}|${i.component}|${type ?? ''}`
    const r = rows.get(key) ?? { key, foundationId: i.foundationId, label: f?.number ?? i.foundationId, component: i.component, anchorageTypeId: type, count: 0, m3: 0, unknown: 0 }
    r.count++
    if (i.plannedM3 === null) r.unknown++; else r.m3 += i.plannedM3
    rows.set(key, r)
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || (a.component === b.component ? 0 : a.component === 'footing' ? -1 : 1))
}
