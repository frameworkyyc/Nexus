import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { anchoragesOn, resolveAnchorages } from '../anchorageMounts'
import { completionOf } from '../completionBasis'
import { getDef, isConstructionCategory } from '../config'
import type { ComponentInput, FoundationConfig } from '../configActions'
import { emptyConstruction } from '../empty'
import { foundationActivities, getIndex, foundationsOf } from '../selectors'
import { deriveRequirements, expectedTotals, scopedCalc } from '../tracker/requirements'
import type { ConstructionState, Dims, Foundation } from '../types'

function apply(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: ConstructionState, r: K.Reducer) => r(s, {}).error
const TODAY = '2026-10-30'
const d = (length: number, width: number, height: number): Dims => ({ length, width, height, unit: 'm' })
const bolt = (qty: number, over: Partial<ComponentInput> = {}): ComponentInput => ({ kind: 'bolt', qty, diameter: 'M30', length: 1200, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2, ...over })
const template: ComponentInput = { kind: 'template', qty: 1, spec: '19 mm plywood' }

/** OP1-A11: 12 anchor bolts (2 nuts and 2 washers each) and 1 template per anchorage. OP1-B2: 4 bolts and 2 embed plates. */
function world() {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'Mole Sieve', []))
  s = apply(s, K.addAnchorageType(pid, 'OP1-A11', 'Eleven'))
  s = apply(s, K.addAnchorageType(pid, 'OP1-B2', 'Two'))
  const [A11, B2] = s.anchorageTypes.map((t) => t.id)
  s = apply(s, K.setAnchorageComponents(A11, [bolt(12), template]))
  s = apply(s, K.setAnchorageComponents(B2, [bolt(4, { diameter: 'M20', length: 600 }), { kind: 'embed-plate', qty: 2, size: '300 x 300 x 20 mm' }]))
  return { s, pid, areaId: s.areas[0].id, A11, B2 }
}
const add = (s: ConstructionState, areaId: string, number: string, plinths: number | null, quantity: number, config: FoundationConfig) => {
  const next = apply(s, K.createFoundation(areaId, number, '', plinths, quantity, config))
  return { s: next, f: next.foundations.find((x) => x.number === number) as Foundation }
}
const totals = (s: ConstructionState) => {
  const out = new Map<string, number>()
  for (const r of deriveRequirements(s)) out.set(r.name + (r.spec ? ` ${r.spec}` : ''), (out.get(r.name + (r.spec ? ` ${r.spec}` : '')) ?? 0) + r.required)
  return out
}
const sum = (s: ConstructionState, name: string) => [...totals(s)].filter(([k]) => k.startsWith(name)).reduce((t, [, v]) => t + v, 0)
/** The calculation and its independent re-check must always agree. */
const agrees = (s: ConstructionState) => {
  const calc = new Map(deriveRequirements(s).map((r) => [r.key, r.required]))
  const check = expectedTotals(s)
  expect([...calc].sort()).toEqual([...check].filter(([, v]) => v > 0).sort())
}
const finish = (s: ConstructionState, ownerId: string) => getIndex(s).activities.filter((a) => (a.plinthId ?? a.foundationId) === ownerId && isConstructionCategory(getDef(a.scope, a.key).category)).reduce((acc, a) => apply(acc, K.updateActivity(a.id, { status: 'complete' }, TODAY)), s)

describe('anchorage mounted on a footing (OP1-21-29: one pad, no plinths, two OP1-A11 anchorage groups)', () => {
  it('two groups of 12 bolts and a template give 24 bolts and 2 templates — as two rows or as one row of quantity 2', () => {
    for (const groups of [[{ qty: 1 }, { qty: 1 }], [{ qty: 2 }]]) {
      const w = world()
      const r = add(w.s, w.areaId, 'OP1-21-29', 0, 1, { footing: d(8.5, 3.5, 0.5), anchorages: groups.map((g) => ({ ...g, anchorageTypeId: w.A11 })) })
      expect(sum(r.s, 'Anchor bolt')).toBe(24)
      expect(sum(r.s, 'Nut')).toBe(48)
      expect(sum(r.s, 'Washer')).toBe(48)
      expect(sum(r.s, 'Plywood template')).toBe(2)
      agrees(r.s)
    }
  })

  it('has one footing, no plinths and no plinth activities: it is not counted as plinths', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'OP1-21-29', 0, 1, { footing: d(8.5, 3.5, 0.5), anchorages: [{ anchorageTypeId: w.A11, qty: 2 }] })
    expect(r.s.plinths.filter((p) => p.foundationId === r.f.id)).toHaveLength(0)
    expect(r.f.plinthsPerFoundation).toBe(0)
    const idx = getIndex(r.s)
    expect(foundationActivities(idx, r.f).every((a) => a.scope === 'footing')).toBe(true)
    expect(r.s.activities.filter((a) => a.foundationId === r.f.id && a.scope === 'plinth')).toHaveLength(0)
    expect(resolveAnchorages(r.s, r.f.id)).toEqual([expect.objectContaining({ mount: 'footing', mountGroupId: null, typeId: w.A11, qty: 2, perFoundation: 2 })])
  })

  it('construction progress counts the footing only: finishing it is 100% under every basis, with no plinth work outstanding', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'OP1-21-29', 0, 1, { footing: d(8.5, 3.5, 0.5), anchorages: [{ anchorageTypeId: w.A11, qty: 2 }] })
    const done = finish(r.s, r.f.id)
    const idx = getIndex(done)
    for (const b of ['type', 'count', 'volume'] as const) expect(completionOf(idx, foundationsOf(idx), b).percent, b).toBe(100)
    expect(completionOf(idx, foundationsOf(idx), 'type')).toMatchObject({ done: 1, total: 1 })
  })

  it('the same pad modelled the old way (plinths) needs plinth work; mounted on the footing it does not', () => {
    const w = world()
    const old = add(w.s, w.areaId, 'OLD', 2, 1, { footing: d(8.5, 3.5, 0.5), groups: [{ anchorageTypeId: w.A11, count: 2 }] })
    const mounted = add(w.s, w.areaId, 'NEW', 0, 1, { footing: d(8.5, 3.5, 0.5), anchorages: [{ anchorageTypeId: w.A11, qty: 2 }] })
    const work = (s: ConstructionState, f: Foundation) => getIndex(s).activities.filter((a) => a.foundationId === f.id && isConstructionCategory(getDef(a.scope, a.key).category)).length
    expect(work(old.s, old.f)).toBe(4 + 2 * 4) // the plain footing (4) + 2 plinths, each with rebar built/installed, formed and poured (4); bolts installed with the pour need no activity
    expect(work(mounted.s, mounted.f)).toBe(4) // the footing only
    expect(sum(old.s, 'Anchor bolt')).toBe(24) // the material need is the same either way
  })
})

describe('anchorage mounted on plinths', () => {
  it('each plinth carries its own groups; plinth and anchorage quantities stay separate', () => {
    const w = world()
    // 4 physical foundations; 3 plinths each; every plinth carries 2 × OP1-A11 → 6 anchorages per foundation, 24 in total.
    const r = add(w.s, w.areaId, 'P-1', null, 4, { footing: d(4, 4, 0.6), groups: [{ count: 3, dims: d(1, 1, 1), anchorages: [{ anchorageTypeId: w.A11, qty: 2 }] }] })
    expect(r.s.plinths.filter((p) => p.foundationId === r.f.id)).toHaveLength(3) // the physical plinths: not 6
    expect(r.s.foundations.find((f) => f.id === r.f.id)!.plinthsPerFoundation).toBe(3)
    expect(sum(r.s, 'Anchor bolt')).toBe(4 * 3 * 2 * 12)
    expect(sum(r.s, 'Plywood template')).toBe(4 * 3 * 2)
    agrees(r.s)
    // Raising the anchorage quantity changes materials only; raising the plinth count changes plinths and materials, never the footing.
    const more = apply(r.s, K.configureFoundation(r.f.id, { groups: [{ id: r.s.anchorageGroups![0].id, count: 3, anchorages: [{ anchorageTypeId: w.A11, qty: 5 }] }] }))
    expect(more.plinths.filter((p) => p.foundationId === r.f.id)).toHaveLength(3)
    expect(more.activities).toHaveLength(r.s.activities.length)
    expect(sum(more, 'Anchor bolt')).toBe(4 * 3 * 5 * 12)
  })

  it('every plinth has its own activities, so only real plinths create plinth work', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'P-2', null, 1, { groups: [{ count: 2, anchorages: [{ anchorageTypeId: w.A11, qty: 1 }] }] })
    expect(r.s.activities.filter((a) => a.foundationId === r.f.id && a.scope === 'plinth').map((a) => a.plinthId)).toEqual(expect.arrayContaining(r.s.plinths.map((p) => p.id)))
    expect(new Set(r.s.activities.filter((a) => a.foundationId === r.f.id && a.scope === 'plinth').map((a) => a.plinthId)).size).toBe(2)
  })
})

describe('mixed and multiple anchorage on one foundation', () => {
  /** 6 foundations. Footing: 1 × A11 and 2 × B2, 3 individual bolts per footing, 1 embed plate per footing. Plinths (2 per foundation): 1 × B2 each, 5 individual bolts per plinth. */
  const mixed = () => {
    const w = world()
    const r = add(w.s, w.areaId, 'MX-1', null, 6, {
      footing: d(5, 3, 0.7),
      anchorages: [{ anchorageTypeId: w.A11, qty: 1 }, { anchorageTypeId: w.B2, qty: 2 }],
      bolts: [{ qty: 3, diameter: 'M16', length: 400, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 1, washersPerBolt: 1 }],
      groups: [{ count: 2, dims: d(0.8, 0.8, 0.9), anchorages: [{ anchorageTypeId: w.B2, qty: 1 }], bolts: [{ qty: 5, diameter: 'M16', length: 400, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 1, washersPerBolt: 1 }] }],
    })
    return { ...w, ...r }
  }

  it('totals every mount: groups of different types on the footing, groups on the plinths, individual bolts on each', () => {
    const { s, f, A11, B2 } = mixed()
    expect(anchoragesOn(s, f.id, null).map((a) => [a.anchorageTypeId, a.qty])).toEqual([[A11, 1], [B2, 2]])
    const setId = s.anchorageGroups![0].id
    expect(anchoragesOn(s, f.id, setId).map((a) => [a.anchorageTypeId, a.qty])).toEqual([[B2, 1]])
    // OP1-A11: 6 foundations × 1 on the footing = 6 anchorages → 72 bolts, 6 templates.
    // OP1-B2: 6 × (2 on the footing + 1 on each of 2 plinths) = 24 anchorages → 96 bolts.
    expect(sum(s, 'Anchor bolt M30')).toBe(6 * 12)
    expect(sum(s, 'Plywood template')).toBe(6)
    expect(sum(s, 'Anchor bolt M20')).toBe(6 * (2 + 2) * 4)
    expect(sum(s, 'Embed plate')).toBe(6 * (2 + 2) * 2)
    // Individual bolts: 3 per footing × 6, and 5 per plinth × 2 plinths × 6.
    expect(sum(s, 'Anchor bolt M16')).toBe(6 * 3 + 6 * 2 * 5)
    agrees(s)
  })

  it('a per-anchorage quantity counts that type across every mount', () => {
    const { s, f, B2 } = mixed()
    const calc = scopedCalc(s, 'per-anchorage', 2, f.id, B2)
    expect('error' in calc).toBe(false)
    if (!('error' in calc)) expect(calc.total).toBe(2 * 6 * 4) // 4 B2 anchorages on each of 6 foundations
    expect(scopedCalc(s, 'per-plinth', 1, f.id, null)).toMatchObject({ total: 12 }) // plinths only: 6 × 2
    expect(scopedCalc(s, 'per-footing', 1, f.id, null)).toMatchObject({ total: 6 })
  })

  it('removing a set of plinths takes what was mounted on it away, and leaves the footing alone', () => {
    const { s, f, A11 } = mixed()
    const gone = apply(s, K.configureFoundation(f.id, { groups: [] }))
    expect(gone.plinths.filter((p) => p.foundationId === f.id)).toHaveLength(0)
    expect(gone.foundationAnchorages!.filter((a) => a.mountGroupId)).toHaveLength(0)
    expect(gone.foundationBolts!.filter((b) => b.mountGroupId)).toHaveLength(0)
    expect(anchoragesOn(gone, f.id, null)).toHaveLength(2)
    expect(sum(gone, 'Anchor bolt M30')).toBe(6 * 12)
    expect(sum(gone, 'Anchor bolt M16')).toBe(6 * 3)
    void A11
    agrees(gone)
  })

  it('footing and plinth edits are independent: replacing the footing groups leaves the plinth groups, and the reverse', () => {
    const { s, f, A11, B2 } = mixed()
    const footingOnly = apply(s, K.configureFoundation(f.id, { anchorages: [{ anchorageTypeId: A11, qty: 3 }] }))
    expect(anchoragesOn(footingOnly, f.id, null).map((a) => a.qty)).toEqual([3])
    expect(anchoragesOn(footingOnly, f.id, s.anchorageGroups![0].id).map((a) => a.qty)).toEqual([1])
    expect(footingOnly.foundationBolts!.filter((b) => b.mountGroupId)).toHaveLength(1)
    const plinthsOnly = apply(s, K.configureFoundation(f.id, { groups: [{ id: s.anchorageGroups![0].id, count: 2, anchorages: [{ anchorageTypeId: B2, qty: 4 }] }] }))
    expect(anchoragesOn(plinthsOnly, f.id, null)).toHaveLength(2)
    expect(plinthsOnly.foundationBolts!.filter((b) => b.mountGroupId)).toHaveLength(1) // bolts not mentioned stay
  })

  it('validates: types must be in the library, quantities whole numbers, no more than the limit', () => {
    const { s, f, A11 } = mixed()
    expect(err(s, K.configureFoundation(f.id, { anchorages: [{ anchorageTypeId: 'nope', qty: 1 }] }))).toMatch(/library/)
    expect(err(s, K.configureFoundation(f.id, { anchorages: [{ anchorageTypeId: A11, qty: 1.5 }] }))).toMatch(/whole number of anchorages/)
    expect(err(s, K.configureFoundation(f.id, { anchorages: Array.from({ length: 21 }, () => ({ anchorageTypeId: A11, qty: 1 })) }))).toMatch(/at most 20/)
    expect(err(s, K.configureFoundation(f.id, { groups: [{ count: 2, anchorages: [{ anchorageTypeId: 'nope', qty: 1 }] }] }))).toMatch(/Plinths 1 anchorage 1/)
  })
})

describe('older data and shorthand', () => {
  it('an anchorage type given per plinth (the older form) is one anchorage on each plinth, and still totals correctly', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'OLD-1', null, 12, { groups: [{ anchorageTypeId: w.A11, count: 3 }] })
    expect(anchoragesOn(r.s, r.f.id, r.s.anchorageGroups![0].id)).toHaveLength(1)
    expect(sum(r.s, 'Anchor bolt')).toBe(12 * 3 * 12)
    agrees(r.s)
  })

  it('state with no stored anchorage groups is read from the plinths, exactly as before', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'OLD-2', null, 5, { groups: [{ anchorageTypeId: w.B2, count: 2 }] })
    const legacy: ConstructionState = { ...r.s, foundationAnchorages: undefined }
    expect(sum(legacy, 'Anchor bolt')).toBe(sum(r.s, 'Anchor bolt'))
    expect(resolveAnchorages(legacy, r.f.id)).toEqual([expect.objectContaining({ typeId: w.B2, perFoundation: 2 })])
  })
})
