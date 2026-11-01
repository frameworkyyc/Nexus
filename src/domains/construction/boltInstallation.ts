import { BOLT_ACTIVITY_KEY, BOLT_KEYS, INSTALL_METHOD_LABEL, isDone } from './config'
import { anchoragesOn, resolveAnchorages } from './anchorageMounts'
import { foundationQuantity } from './foundationQuantity'
import { boltAsComponent, boltSpec } from './tracker/requirements'
import type { Activity, ConstructionState, Foundation, InstallMethod } from './types'

const plural = (n: number, word: string) => `${n.toLocaleString('en-CA')} ${word}${n === 1 ? '' : 's'}`
const methodOf = (a: Pick<Activity, 'key'>): InstallMethod | null => (Object.entries(BOLT_ACTIVITY_KEY).find(([, k]) => k === a.key)?.[0] as InstallMethod | undefined) ?? null
export const isBoltActivity = (a: Pick<Activity, 'key'>) => BOLT_KEYS.includes(a.key)

export interface BoltLine {
  /** "OP1-A11 × 2" or "Individual anchor bolts". */
  source: string
  /** Anchor bolts of this source on this footing or plinth, per physical foundation, or null for a total that is not per foundation. */
  perFoundation: number | null
  /** Across all the physical foundations of the design. */
  total: number
  /** "M30 × 1200 mm, all-thread". */
  spec: string
}

/** The anchor bolts one installation activity covers: the anchorage groups whose type contains bolts and the individual bolts mounted on that footing or plinth with that installation method. */
export function boltLines(s: ConstructionState, f: Foundation, a: Activity): BoltLine[] {
  const method = methodOf(a)
  if (!method) return []
  const qty = foundationQuantity(f)
  const plinth = a.plinthId ? s.plinths.find((p) => p.id === a.plinthId) : undefined
  const mount: string | null = a.plinthId ? plinth?.groupId ?? null : null
  const out: BoltLine[] = []
  const code = (id: string) => s.anchorageTypes.find((t) => t.id === id)?.code ?? id
  const groups = s.foundationAnchorages !== undefined
    ? anchoragesOn(s, f.id, mount).filter((x) => (x.installMethod ?? 'wet-set') === method).map((x) => ({ typeId: x.anchorageTypeId, qty: x.qty }))
    : resolveAnchorages(s, f.id).filter((x) => x.mount === 'plinths' && x.method === method && (!plinth || x.typeId === plinth.anchorageTypeId)).map((x) => ({ typeId: x.typeId, qty: 1 }))
  for (const g of groups) {
    const bolts = (s.anchorageComponents ?? []).filter((c) => c.anchorageTypeId === g.typeId && c.kind === 'bolt' && c.qty > 0)
    if (!bolts.length) continue
    const per = bolts.reduce((t, c) => t + c.qty * g.qty, 0)
    out.push({ source: g.qty === 1 ? code(g.typeId) : `${code(g.typeId)} × ${g.qty}`, perFoundation: per, total: per * qty, spec: bolts.map(boltSpec).join(' + ') })
  }
  for (const b of s.foundationBolts ?? []) {
    if (b.foundationId !== f.id || (b.mountGroupId ?? null) !== mount || (b.installMethod ?? 'wet-set') !== method) continue
    out.push({ source: 'Individual anchor bolts', perFoundation: b.mode === 'total' ? null : b.qty, total: b.mode === 'total' ? b.qty : b.qty * qty, spec: boltSpec(boltAsComponent(b)) })
  }
  return out
}

/** One line per source: "4 anchor bolts · individual · 5/8" × 250 mm, all-thread". */
export const boltLineText = (l: BoltLine): string => `${plural(l.total, 'anchor bolt')} · ${l.source}${l.spec ? ` · ${l.spec}` : ''}`

/** The installation activities of a foundation that are not yet complete, as "4 post-installed anchor bolts outstanding" (wet-set first, since those go in before the pour). */
export function outstandingBolts(s: ConstructionState, f: Foundation, acts: Activity[], statusOf: (a: Activity) => string): string[] {
  const totals: Record<InstallMethod, number> = { 'wet-set': 0, 'post-installed': 0 }
  for (const a of acts) {
    const m = methodOf(a)
    if (!m || isDone(statusOf(a) as never)) continue
    totals[m] += boltLines(s, f, a).reduce((t, l) => t + l.total, 0)
  }
  return (['wet-set', 'post-installed'] as InstallMethod[]).filter((m) => acts.some((a) => methodOf(a) === m && !isDone(statusOf(a) as never))).map((m) => `${totals[m] ? plural(totals[m], `${INSTALL_METHOD_LABEL[m].toLowerCase()} anchor bolt`) : `${INSTALL_METHOD_LABEL[m]} anchor bolts`} outstanding`)
}
