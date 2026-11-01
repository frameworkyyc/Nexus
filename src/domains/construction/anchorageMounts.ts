import type { ConstructionState, Foundation, FoundationAnchorage, InstallMethod, MountGroupId } from './types'

/**
 * Where anchorage goes, and how many of it there are. The physical structure and the anchorage on it are separate:
 *  - a foundation design stands for `quantity` physical foundations; each has ONE footing (pad) and its plinths (each set of identical plinths has a count);
 *  - anchorage groups, individual anchor bolts and embed plates are each mounted on the footing or on every plinth of one set.
 * Footing quantity is the foundation quantity; plinth quantity is the number of plinth records; anchorage quantities are `qty` per mount on top of those.
 */
export type MountSource = Pick<ConstructionState, 'foundations' | 'plinths'> & Partial<Pick<ConstructionState, 'anchorageGroups' | 'foundationAnchorages'>>

/** Plinths in one set, on one physical foundation. */
export const plinthsInSet = (c: Pick<ConstructionState, 'plinths'>, groupId: string): number => c.plinths.filter((p) => p.groupId === groupId).length

/** How many things a per-mount quantity is multiplied by on a design: its physical foundations when the mount is the footing, times the plinths in the set otherwise. */
export function mountCount(c: Pick<ConstructionState, 'plinths'>, f: Pick<Foundation, 'quantity'>, mountGroupId: MountGroupId | undefined): number {
  const physical = f.quantity ?? 1
  return mountGroupId ? physical * plinthsInSet(c, mountGroupId) : physical
}

export interface MountedAnchorage {
  foundationId: string
  /** 'footing' or 'plinths' (every plinth of the set `mountGroupId`). */
  mount: 'footing' | 'plinths'
  mountGroupId: MountGroupId
  typeId: string
  qty: number
  /** Anchorages of this group on ONE physical foundation: qty × (1 footing, or the plinths in the set). */
  perFoundation: number
  /** How this group's anchor bolts are installed. */
  method: InstallMethod
}

/**
 * Every anchorage group of every foundation. Data from before groups were mounted (no `foundationAnchorages`) is read the old way: each plinth with an anchorage type
 * is one anchorage on that plinth. Plinths that belong to no set are always read that way, so a plinth given a type directly still counts.
 */
export function resolveAnchorages(c: MountSource, foundationId?: string): MountedAnchorage[] {
  const out: MountedAnchorage[] = []
  const stored = c.foundationAnchorages
  const sets = new Set((c.anchorageGroups ?? []).map((g) => g.id))
  for (const a of stored ?? []) {
    if (foundationId && a.foundationId !== foundationId) continue
    const plinths = a.mountGroupId ? plinthsInSet(c, a.mountGroupId) : 1
    out.push({ foundationId: a.foundationId, mount: a.mountGroupId ? 'plinths' : 'footing', mountGroupId: a.mountGroupId, typeId: a.anchorageTypeId, qty: a.qty, perFoundation: a.qty * plinths, method: a.installMethod ?? 'wet-set' })
  }
  const legacy = new Map<string, MountedAnchorage>()
  for (const p of c.plinths) {
    if (!p.anchorageTypeId || (foundationId && p.foundationId !== foundationId)) continue
    if (stored !== undefined && p.groupId && sets.has(p.groupId)) continue
    const key = `${p.foundationId}|${p.anchorageTypeId}`
    const e = legacy.get(key) ?? { foundationId: p.foundationId, mount: 'plinths' as const, mountGroupId: p.groupId ?? null, typeId: p.anchorageTypeId, qty: 1, perFoundation: 0, method: 'wet-set' as InstallMethod }
    e.perFoundation += 1
    legacy.set(key, e)
  }
  return [...out, ...legacy.values()]
}

/** Anchorage groups mounted on one footing or one set of plinths, in order. */
export const anchoragesOn = (c: Pick<ConstructionState, 'foundationAnchorages'>, foundationId: string, mountGroupId: MountGroupId): FoundationAnchorage[] =>
  (c.foundationAnchorages ?? []).filter((a) => a.foundationId === foundationId && (a.mountGroupId ?? null) === mountGroupId)

/** The anchorage type a set of plinths is known by in older views: its first anchorage's, or null when it has none. */
export const primaryType = (c: Pick<ConstructionState, 'foundationAnchorages'>, foundationId: string, groupId: string): string | null => anchoragesOn(c, foundationId, groupId)[0]?.anchorageTypeId ?? null

/** What the anchor bolt installation tracking needs from the configuration. */
export type BoltSource = MountSource & Partial<Pick<ConstructionState, 'anchorageComponents' | 'foundationBolts'>>

/** Whether an anchorage type contains anchor bolts (a bolt component of one or more per anchorage). */
export const typeHasBolts = (c: Partial<Pick<ConstructionState, 'anchorageComponents'>>, typeId: string): boolean =>
  (c.anchorageComponents ?? []).some((x) => x.anchorageTypeId === typeId && x.kind === 'bolt' && x.qty > 0)

/**
 * Where anchor bolts are required, and by which installation methods: for each footing (owner = the foundation id) and each plinth (owner = the plinth id),
 * the methods of the anchorage groups whose type contains bolts and of the individual anchor bolts mounted there. An owner with no bolts is absent, so it
 * has no installation activity at all. Several groups with different methods on one owner each keep their own method.
 */
export function boltOwners(c: BoltSource): Map<string, Set<InstallMethod>> {
  const out = new Map<string, Set<InstallMethod>>()
  const add = (owner: string, m: InstallMethod) => { const s = out.get(owner) ?? new Set<InstallMethod>(); s.add(m); out.set(owner, s) }
  const plinthsOf = (groupId: string | null, foundationId: string) => (groupId ? c.plinths.filter((p) => p.groupId === groupId) : c.plinths.filter((p) => p.foundationId === foundationId && !p.groupId))
  const ownersOf = (foundationId: string, mount: 'footing' | 'plinths', groupId: string | null, legacyType?: string) =>
    mount === 'footing' ? [foundationId] : plinthsOf(groupId, foundationId).filter((p) => !legacyType || p.anchorageTypeId === legacyType).map((p) => p.id)
  for (const a of resolveAnchorages(c)) if (typeHasBolts(c, a.typeId)) for (const o of ownersOf(a.foundationId, a.mount, a.mountGroupId, c.foundationAnchorages === undefined || !a.mountGroupId ? a.typeId : undefined)) add(o, a.method)
  for (const b of c.foundationBolts ?? []) {
    if (b.qty < 1) continue
    for (const o of ownersOf(b.foundationId, b.mountGroupId ? 'plinths' : 'footing', b.mountGroupId ?? null)) add(o, b.installMethod ?? 'wet-set')
  }
  return out
}
