import { componentProblem } from './configActions'
import type { ConstructionState } from './types'

/** Why an anchorage type is not fully configured, or null when it is. Reuses the component validation used when saving the configuration. */
export function anchorageIssue(s: Pick<ConstructionState, 'anchorageComponents'>, typeId: string): string | null {
  const mine = (s.anchorageComponents ?? []).filter((c) => c.anchorageTypeId === typeId)
  if (mine.length === 0) return 'no components defined yet'
  for (let i = 0; i < mine.length; i++) {
    const p = componentProblem(mine[i], i + 1)
    if (p) return p.replace(/^Component (\d+): e/, 'component $1: e').replace(/\.$/, '')
  }
  return null
}

/** One line per anchorage type used by a foundation (its anchorage groups or plinths) that is not fully configured. Empty when nothing is missing. */
export function foundationAnchorageIssues(s: Pick<ConstructionState, 'anchorageComponents' | 'anchorageTypes' | 'anchorageGroups' | 'plinths'>, foundationId: string): string[] {
  const ids = new Set<string>()
  for (const g of s.anchorageGroups ?? []) if (g.foundationId === foundationId && g.anchorageTypeId) ids.add(g.anchorageTypeId)
  for (const p of s.plinths) if (p.foundationId === foundationId && p.anchorageTypeId) ids.add(p.anchorageTypeId)
  const out: string[] = []
  for (const id of ids) {
    const t = s.anchorageTypes.find((x) => x.id === id)
    const why = t && !t.archived ? anchorageIssue(s, id) : null
    if (t && why) out.push(`${t.code}: ${why}`)
  }
  return out.sort()
}
