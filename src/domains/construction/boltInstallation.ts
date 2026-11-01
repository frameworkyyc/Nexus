import { INSTALL_ACTIVITY_KEY, INSTALL_KEYS, isDone, type InstallItem } from './config'
import { anchoragesOn, resolveAnchorages } from './anchorageMounts'
import { foundationQuantity } from './foundationQuantity'
import { componentMap, embedComponent } from './plates'
import { boltAsComponent, boltSpec } from './tracker/requirements'
import type { Activity, AnchorageComponent, ConstructionState, Foundation } from './types'

const plural = (n: number, word: string) => `${n.toLocaleString('en-CA')} ${word}${n === 1 ? '' : 's'}`
const itemOf = (a: Pick<Activity, 'key'>): InstallItem | null => (Object.entries(INSTALL_ACTIVITY_KEY).find(([, k]) => k === a.key)?.[0] as InstallItem | undefined) ?? null
const WORD: Record<InstallItem, string> = { bolts: 'anchor bolt', embeds: 'embed plate' }
/** Whether an activity is a post-install activity (anchor bolts or embed plates installed after the pour). */
export const isBoltActivity = (a: Pick<Activity, 'key'>) => INSTALL_KEYS.includes(a.key)

export interface BoltLine {
  /** "OP1-A11 × 2", "Individual anchor bolts" or "Individual embed plates". */
  source: string
  /** Components of this source on this footing or plinth, per physical foundation, or null for a total that is not per foundation. */
  perFoundation: number | null
  /** Across all the physical foundations of the design. */
  total: number
  /** "M30 × 1200 mm, all-thread" or the plate size. */
  spec: string
  item: InstallItem
}

const isItem = (c: AnchorageComponent, item: InstallItem) => c.qty > 0 && c.kind === (item === 'bolts' ? 'bolt' : 'embed-plate')

/** The post-installed components one installation activity covers: the Post-Install anchorage groups whose type contains them and the Post-Install individual bolts or embed plates mounted on that footing or plinth. */
export function boltLines(s: ConstructionState, f: Foundation, a: Activity): BoltLine[] {
  const item = itemOf(a)
  if (!item) return []
  const qty = foundationQuantity(f)
  const plinth = a.plinthId ? s.plinths.find((p) => p.id === a.plinthId) : undefined
  const mount: string | null = a.plinthId ? plinth?.groupId ?? null : null
  const out: BoltLine[] = []
  const code = (id: string) => s.anchorageTypes.find((t) => t.id === id)?.code ?? id
  const groups = s.foundationAnchorages !== undefined
    ? anchoragesOn(s, f.id, mount).filter((x) => x.installMethod === 'post-installed').map((x) => ({ typeId: x.anchorageTypeId, qty: x.qty }))
    : resolveAnchorages(s, f.id).filter((x) => x.mount === 'plinths' && x.method === 'post-installed' && (!plinth || x.typeId === plinth.anchorageTypeId)).map((x) => ({ typeId: x.typeId, qty: 1 }))
  for (const g of groups) {
    const parts = (s.anchorageComponents ?? []).filter((c) => c.anchorageTypeId === g.typeId && isItem(c, item))
    if (!parts.length) continue
    const per = parts.reduce((t, c) => t + c.qty * g.qty, 0)
    out.push({ item, source: g.qty === 1 ? code(g.typeId) : `${code(g.typeId)} × ${g.qty}`, perFoundation: per, total: per * qty, spec: item === 'bolts' ? parts.map(boltSpec).join(' + ') : parts.map((c) => c.size).filter(Boolean).join(' + ') })
  }
  if (item === 'bolts') {
    for (const b of s.foundationBolts ?? []) {
      if (b.foundationId !== f.id || (b.mountGroupId ?? null) !== mount || b.installMethod !== 'post-installed') continue
      out.push({ item, source: 'Individual anchor bolts', perFoundation: b.mode === 'total' ? null : b.qty, total: b.mode === 'total' ? b.qty : b.qty * qty, spec: boltSpec(boltAsComponent(b)) })
    }
  } else {
    const byId = componentMap(s)
    for (const e of s.foundationEmbeds ?? []) {
      if (e.foundationId !== f.id || (e.mountGroupId ?? null) !== mount || e.installMethod !== 'post-installed') continue
      out.push({ item, source: 'Individual embed plates', perFoundation: e.mode === 'total' ? null : e.qty, total: e.mode === 'total' ? e.qty : e.qty * qty, spec: embedComponent(e, byId)?.size ?? '' })
    }
  }
  return out
}

/** One line per source: "4 anchor bolts · individual · 5/8" × 250 mm, all-thread". */
export const boltLineText = (l: BoltLine): string => `${plural(l.total, WORD[l.item])} · ${l.source}${l.spec ? ` · ${l.spec}` : ''}`

/** The post-install activities of a foundation that are not yet complete, as "4 post-installed anchor bolts outstanding". */
export function outstandingBolts(s: ConstructionState, f: Foundation, acts: Activity[], statusOf: (a: Activity) => string): string[] {
  const totals: Record<InstallItem, number> = { bolts: 0, embeds: 0 }
  const open = new Set<InstallItem>()
  for (const a of acts) {
    const i = itemOf(a)
    if (!i || isDone(statusOf(a) as never)) continue
    open.add(i)
    totals[i] += boltLines(s, f, a).reduce((t, l) => t + l.total, 0)
  }
  return (['bolts', 'embeds'] as InstallItem[]).filter((i) => open.has(i)).map((i) => `${totals[i] ? plural(totals[i], `post-installed ${WORD[i]}`) : `Post-installed ${WORD[i]}s`} outstanding`)
}
