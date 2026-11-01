import { itemsOf } from '../tracker/requirements'
import { anchoragesOn } from '../anchorageMounts'
import { foundationQuantity } from '../foundationQuantity'
import type { ConstructionState, MountGroupId } from '../types'
import { useConstruction } from '../store'

const plural = (n: number, word: string) => `${n.toLocaleString('en-CA')} ${word}${n === 1 ? '' : 's'}`

/** "OP1-A11 × 2 · OP1-B2" — the anchorage groups mounted on the footing or on each plinth of a set; '' when there are none. Older data shows each set's single type. */
export function mountedAnchorageText(s: Pick<ConstructionState, 'anchorageTypes' | 'foundationAnchorages' | 'anchorageGroups'>, foundationId: string, mount: MountGroupId): string {
  const code = (id: string) => s.anchorageTypes.find((t) => t.id === id)?.code ?? id
  const rows = anchoragesOn(s, foundationId, mount)
  if (rows.length) return rows.map((a) => (a.qty === 1 ? code(a.anchorageTypeId) : `${code(a.anchorageTypeId)} × ${a.qty}`)).join(' · ')
  const legacy = mount ? (s.anchorageGroups ?? []).find((g) => g.id === mount)?.anchorageTypeId : null
  return !s.foundationAnchorages && legacy ? code(legacy) : ''
}

/** What each footing and each set of plinths carries, with the totals those anchorage groups need across every physical foundation. */
export function MountedAnchorage({ foundationId }: { foundationId: string }) {
  const { state } = useConstruction()
  const f = state.foundations.find((x) => x.id === foundationId)
  if (!f) return null
  const qty = foundationQuantity(f)
  const sets = (state.anchorageGroups ?? []).filter((g) => g.foundationId === foundationId)
  const mounts: { key: string; label: string; mount: MountGroupId; count: number; unit: string }[] = [
    { key: 'footing', label: 'Footing', mount: null, count: qty, unit: 'footing' },
    ...sets.map((g, i) => ({ key: g.id, label: `Plinths ${i + 1} (${g.count} per foundation)`, mount: g.id, count: qty * state.plinths.filter((p) => p.groupId === g.id).length, unit: 'plinth' })),
  ]
  return (
    <section aria-label="Anchorage mounted on this foundation" className="mt-6">
      <h2 className="t-label mb-2">Anchorage mounted</h2>
      <ul className="divide-y divide-line border-y border-line text-[13px]">
        {mounts.map((m) => {
          const groups = anchoragesOn(state, foundationId, m.mount)
          const bolts = (state.foundationBolts ?? []).filter((b) => b.foundationId === foundationId && (b.mountGroupId ?? null) === m.mount).length
          const embeds = (state.foundationEmbeds ?? []).filter((e) => e.foundationId === foundationId && (e.mountGroupId ?? null) === m.mount).length
          const totals = groups.flatMap((a) => (state.anchorageComponents ?? []).filter((c) => c.anchorageTypeId === a.anchorageTypeId).flatMap((c) => itemsOf(c)).map((it) => plural(it.each * a.qty * m.count, it.name.toLowerCase())))
          const text = mountedAnchorageText(state, foundationId, m.mount)
          return (
            <li key={m.key} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[12rem_1fr]">
              <span className="font-medium">{m.label}</span>
              <span>
                {text || <span className="text-muted">No anchorage groups</span>}
                {totals.length > 0 && <span className="block text-xs text-muted">All {m.count.toLocaleString('en-CA')} {m.unit}{m.count === 1 ? '' : 's'}: {totals.join(' · ')}</span>}
                {(bolts > 0 || embeds > 0) && <span className="block text-xs text-muted">{[bolts ? plural(bolts, 'individual anchor bolt entry').replace('entrys', 'entries') : '', embeds ? plural(embeds, 'embed plate entry').replace('entrys', 'entries') : ''].filter(Boolean).join(' · ')}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
