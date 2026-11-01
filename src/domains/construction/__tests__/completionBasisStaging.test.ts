import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { readModule } from '@/worker/service'
import { d1Over } from '@/worker/__tests__/sqliteD1'
import { completionOf, type CompletionBasis } from '../completionBasis'
import { getDef, isConstructionCategory, isDone } from '../config'
import { foundationConcrete } from '../concrete'
import { foundationQuantity } from '../foundationQuantity'
import { computeStats, foundationsOf, getIndex } from '../selectors'
import type { ConstructionState } from '../types'

/**
 * Checks the three bases against a REAL project, read from a local SQLite copy of a database (never a live one):
 *   COMPLETION_DB=/tmp/mig/staging.sqlite npx vitest run src/domains/construction/__tests__/completionBasisStaging.test.ts
 * Every figure is recomputed here straight from the raw records with a separate, plain implementation, and printed per area and for the whole project.
 */
const DB = process.env.COMPLETION_DB

/** Independent recomputation: per designation, the average over its footing/plinth records of (rebar built+installed split, forming, pouring) / 3. Pours are ignored, so only designations without pour records are compared. */
function independent(s: ConstructionState, foundationIds: string[]) {
  const rows = foundationIds.map((id) => {
    const f = s.foundations.find((x) => x.id === id)!
    const owners = new Map<string, Record<string, number>>()
    for (const a of s.activities.filter((x) => x.foundationId === id)) {
      if (!isConstructionCategory(getDef(a.scope, a.key).category)) continue
      const o = owners.get(a.plinthId ?? a.foundationId) ?? {}
      o[a.key] = isDone(a.status) ? 1 : 0
      owners.set(a.plinthId ?? a.foundationId, o)
    }
    const records = [...owners.entries()].map(([owner, o]) => ({ owner, c: (((o.rebarBuilt ?? 0) + (o.rebarInstalled ?? 0)) / 2 + (o.formed ?? 0) + (o.poured ?? 0)) / 3 }))
    const c = records.length ? records.reduce((t, r) => t + r.c, 0) / records.length : null
    const conc = foundationConcrete(f, s.plinths, (s.anchorageGroups ?? []).filter((g) => g.foundationId === id))
    const q = foundationQuantity(f)
    const vol = (owner: string) => (owner === id ? conc.footing : conc.plinths.find((p) => p.plinthId === owner)?.net ?? null)
    return { f, q, c, records, vol: (o: string) => { const v = vol(o); return v === null ? null : v * q }, hasPours: (s.pourItems ?? []).some((i) => i.foundationId === id) }
  }).filter((r) => r.c !== null)
  const type = rows.reduce((t, r) => t + (r.c as number), 0) / rows.length
  const count = rows.reduce((t, r) => t + r.q * (r.c as number), 0) / rows.reduce((t, r) => t + r.q, 0)
  let vd = 0, vt = 0
  for (const r of rows) for (const rec of r.records) { const v = r.vol(rec.owner); if (v !== null) { vd += v * rec.c; vt += v } }
  return { rows, type: type * 100, count: count * 100, volume: vt > 0 ? (vd / vt) * 100 : null, volumeTotal: vt }
}

describe.skipIf(!DB)('completion bases on real project data', () => {
  it('matches an independent recomputation for every project and area, and prints them', async () => {
    const s = (await readModule(d1Over(new DatabaseSync(DB as string, { readOnly: true })), 'construction')).state as unknown as ConstructionState
    const idx = getIndex(s)
    const out: string[] = []
    const groups = [
      ...s.projects.map((p) => ({ label: `PROJECT ${p.name}`, ids: s.areas.filter((a) => a.projectId === p.id).flatMap((a) => foundationsOf(idx, a.id)).map((f) => f.id) })),
      ...s.areas.map((a) => ({ label: `  area ${a.name}`, ids: foundationsOf(idx, a.id).map((f) => f.id) })),
    ]
    for (const g of groups) {
      if (!g.ids.length) continue
      const ref = independent(s, g.ids)
      const foundations = g.ids.map((id) => idx.foundation.get(id)!)
      const got = Object.fromEntries((['type', 'count', 'volume'] as CompletionBasis[]).map((b) => [b, completionOf(idx, foundations, b)]))
      const poured = ref.rows.some((r) => r.hasPours)
      out.push(`${g.label}: ${g.ids.length} designations / ${ref.rows.reduce((t, r) => t + r.q, 0)} foundations / ${ref.volumeTotal.toFixed(1)} m³ known | type ${got.type.percent}% (${ref.type.toFixed(2)}; element-pooled was ${computeStats(idx, foundations).progress}%) | count ${got.count.percent}% (${ref.count.toFixed(2)}) | volume ${got.volume.percent}% (${ref.volume?.toFixed(2)})${got.volume.missing ? ` | volume missing for ${got.volume.missing.elements}/${got.volume.missing.of} records` : ''}${poured ? ' | has pour records' : ''}`)
      if (!poured) {
        expect(got.type.percent, g.label + ' type').toBe(Math.round(ref.type))
        expect(got.count.percent, g.label + ' count').toBe(Math.round(ref.count))
        if (ref.volume !== null) expect(got.volume.percent, g.label + ' volume').toBe(Math.round(ref.volume))
      }
    }
    const shape = s.foundations.map((f) => `${f.number}×${foundationQuantity(f)}`)
    out.push(`designations: ${shape.length}; with quantity > 1: ${s.foundations.filter((f) => foundationQuantity(f) > 1).length}; with plinth records: ${new Set(s.plinths.map((p) => p.foundationId)).size}; pour items: ${(s.pourItems ?? []).length}`)
    process.stderr.write('\n' + out.join('\n') + '\n')
    expect(out.length).toBeGreaterThan(1)
  })
})
