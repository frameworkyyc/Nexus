import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import type { FoundationConfig } from '../configActions'
import { basisFigures, basisWarning, completionOf, COMPLETION_BASES, DEFAULT_BASIS } from '../completionBasis'
import { concreteOf } from '../pours'
import { getDef, isConstructionCategory } from '../config'
import { emptyConstruction } from '../empty'
import { foundationsOf, getIndex } from '../selectors'
import type { ConstructionState, Dims, Foundation } from '../types'

function apply(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const TODAY = '2026-10-30'
const d = (length: number | null, width: number | null, height: number | null, unit: Dims['unit'] = 'm'): Dims => ({ length, width, height, unit })

/** A project with one area. Foundations are added with `add`; `finish` marks every construction activity of a footing or plinth complete. */
function world() {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'Area 1', []))
  s = apply(s, K.addAnchorageType(pid, 'A', 'Type A'))
  return { s, pid, areaId: s.areas[0].id, A: s.anchorageTypes[0].id }
}
const add = (s: ConstructionState, areaId: string, number: string, quantity: number, config: FoundationConfig) => {
  const next = apply(s, K.createFoundation(areaId, number, '', null, quantity, config))
  return { s: next, f: next.foundations.find((x) => x.number === number) as Foundation }
}
const finish = (s: ConstructionState, ownerId: string, only?: string[]) => getIndex(s).activities.filter((a) => (a.plinthId ?? a.foundationId) === ownerId && isConstructionCategory(getDef(a.scope, a.key).category) && (!only || only.includes(a.key))).reduce((acc, a) => apply(acc, K.updateActivity(a.id, { status: 'complete' }, TODAY)), s)
const all = (s: ConstructionState) => { const idx = getIndex(s); return { idx, foundations: foundationsOf(idx) } }
const run = (s: ConstructionState, basis: 'type' | 'count' | 'volume') => { const { idx, foundations } = all(s); return completionOf(idx, foundations, basis) }

/** X: 10 footings of 2 m³ (20 m³), no plinths, finished. Y: 2 footings of 20 m³ (40 m³), untouched. */
function unequal() {
  const w = world()
  let { s } = w
  let f: Foundation
  ;({ s, f } = add(s, w.areaId, 'X', 10, { footing: d(2, 2, 0.5) }))
  s = finish(s, f.id)
  ;({ s, f } = add(s, w.areaId, 'Y', 2, { footing: d(5, 4, 1) }))
  return { ...w, s, y: f }
}

describe('completion basis: unequal counts and unequal volumes', () => {
  it('weights the same progress three ways', () => {
    const { s } = unequal()
    expect(run(s, 'type')).toMatchObject({ percent: 50, done: 1, total: 2, unit: 'foundation types' }) // 1 of 2 designations
    expect(run(s, 'count')).toMatchObject({ percent: 83, done: 10, total: 12, unit: 'foundations' }) // 10 of 12 foundations
    expect(run(s, 'volume')).toMatchObject({ percent: 33, unit: 'm³', missing: null }) // 20 of 60 m³
    expect(run(s, 'volume').done).toBeCloseTo(20)
    expect(run(s, 'volume').total).toBeCloseTo(60)
  })

  it('defaults to foundation type and offers the three bases in order', () => {
    expect(DEFAULT_BASIS).toBe('type')
    expect(COMPLETION_BASES.map((b) => b.id)).toEqual(['type', 'count', 'volume'])
  })

  it('swaps the order of the results when the counts and volumes disagree', () => {
    // A big designation of small footings and a small designation of huge ones: count says "mostly done", volume says "barely started".
    const { s } = unequal()
    const count = run(s, 'count').percent as number
    const volume = run(s, 'volume').percent as number
    expect(count).toBeGreaterThan(volume)
  })

  it('shows the figures behind each percentage', () => {
    const { s } = unequal()
    expect(basisFigures(run(s, 'type'))).toBe('1 of 2 foundation types')
    expect(basisFigures(run(s, 'count'))).toBe('10 of 12 foundations')
    expect(basisFigures(run(s, 'volume'))).toBe('20.0 of 60.0 m³')
  })
})

describe('completion basis: plinths and double counting', () => {
  /** P: 4 foundations, footing 2 × 2 × 0.5 = 2 m³, two plinths of 0.5 × 0.5 × 1 = 0.25 m³ each. Only the footings are finished. */
  const withPlinths = () => {
    const w = world()
    const r = add(w.s, w.areaId, 'P', 4, { footing: d(2, 2, 0.5), groups: [{ anchorageTypeId: w.A, count: 2, dims: d(0.5, 0.5, 1) }] })
    return { ...w, s: finish(r.s, r.f.id), f: r.f }
  }

  it('counts each foundation (type) and each physical foundation (count) once however many plinths there are', () => {
    const { s } = withPlinths()
    // Footing done, two plinth records not: 1 of 3 records = 1/3 of the designation.
    expect(run(s, 'count')).toMatchObject({ done: expect.closeTo(4 / 3, 6), total: 4 })
    expect(run(s, 'type')).toMatchObject({ done: expect.closeTo(1 / 3, 6), total: 1, percent: 33 })
  })

  it('volume uses footing + plinths across the quantity, and never counts a plinth standing in the footing twice', () => {
    const { s, f } = withPlinths()
    const c = concreteOf(s, f)
    expect(c.total).toBeCloseTo(4 * (2 + 0.5)) // 10 m³
    expect(run(s, 'volume').total).toBeCloseTo(10)
    expect(run(s, 'volume').done).toBeCloseTo(8) // the four finished footings (4 × 2 m³); the plinths (2 m³) are untouched
  })

  it('plinths measured from the footing base deduct the part inside the footing', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'Q', 2, { footing: d(2, 2, 0.5), plinthBase: 'from-footing-base', groups: [{ anchorageTypeId: w.A, count: 1, dims: d(0.5, 0.5, 1) }] })
    // plinth: 0.25 m² × (1 − 0.5) = 0.125 m³ each, footing 2 m³: total per foundation 2.125, × 2 = 4.25
    expect(run(r.s, 'volume').total).toBeCloseTo(4.25)
    expect(concreteOf(r.s, r.f).total).toBeCloseTo(4.25)
  })
})

describe('completion basis: partial pours use the concrete actually placed', () => {
  /** Y: 2 footings of 20 m³, nothing marked done in the activities. */
  const pours = (s: ConstructionState, pid: string, f: Foundation, record: [number, number | null, boolean][]) => {
    s = apply(s, K.createPour(pid, 'W1', null, 0))
    const pour = s.pours![0]
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: record.map(([u]) => u), components: 'footing' }]))
    for (const [unit, m3, complete] of record) s = apply(s, K.recordPour(`${pour.id}:${f.id}:${unit}:footing`, { pouredM3: m3, complete, date: complete ? TODAY : null }, TODAY))
    return s
  }

  it('does not count a group as complete because one of its foundations is poured', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'Y', 2, { footing: d(5, 4, 1) })
    const before = run(r.s, 'volume')
    expect(before.percent).toBe(0)
    const s = pours(r.s, w.pid, r.f, [[1, null, true]]) // one of two footings poured
    const v = run(s, 'volume')
    // The footing's pouring stage is one stage in three, and half the units are poured: 0.5/3 of 40 m³ credited.
    expect(v.done).toBeCloseTo(40 * (0.5 / 3))
    expect(v.percent).toBe(17)
    expect(run(s, 'count').done).toBeCloseTo(2 * (0.5 / 3))
  })

  it('credits a partly poured component by the volume placed, and fully poured ones in full', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'Y', 2, { footing: d(5, 4, 1) })
    const s = pours(r.s, w.pid, r.f, [[1, 10, false], [2, 20, true]]) // unit 1: 10 of 20 m³; unit 2 complete
    expect(run(s, 'volume').done).toBeCloseTo(40 * (0.75 / 3)) // (0.5 + 1) / 2 units poured, one stage in three
  })

  it('never lowers progress: an activity marked poured stays fully credited', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'Y', 2, { footing: d(5, 4, 1) })
    const marked = finish(r.s, r.f.id, ['poured'])
    const s = pours(marked, w.pid, r.f, [[1, 5, false]])
    expect(run(s, 'volume').done).toBeCloseTo(40 / 3) // the poured stage is whole, not 5/20 of it
  })

  it('credits poured concrete in every basis, so only the weighting differs', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'Y', 2, { footing: d(5, 4, 1) })
    const s = pours(r.s, w.pid, r.f, [[1, null, true]])
    for (const b of ['type', 'count', 'volume'] as const) expect(run(s, b).percent, b).toBe(17) // one footing of two poured: (0.5 of one stage in three) = 16.7%
  })
})

describe('completion basis: missing volumes are stated, never treated as zero', () => {
  const mixed = () => {
    const w = world()
    const known = add(w.s, w.areaId, 'K', 2, { footing: d(5, 4, 1) }) // 20 m³ each: known
    return add(finish(known.s, known.f.id), w.areaId, 'U', 5, {}).s // no dimensions at all
  }

  it('leaves unknown elements out of both sides and says so', () => {
    const r = run(mixed(), 'volume')
    expect(r.percent).toBe(100) // the only known designation is finished; the unknown one is not silently 0 m³ of "0%"
    expect(r.total).toBeCloseTo(40)
    expect(r.missing).toMatchObject({ elements: 1, of: 2, foundations: ['U'] })
    expect(basisWarning(r)).toMatch(/not entered for 1 of 2 footings and plinths \(U\).*not counted as zero/)
  })

  it('count and type are unaffected by missing volumes', () => {
    const s = mixed()
    expect(run(s, 'count')).toMatchObject({ total: 7, missing: null })
    expect(run(s, 'type')).toMatchObject({ total: 2, missing: null })
  })

  it('has no percentage at all when no volume is known', () => {
    const w = world()
    const { s } = add(w.s, w.areaId, 'U', 5, {})
    const r = run(s, 'volume')
    expect(r.percent).toBeNull()
    expect(basisFigures(r)).toBe('No concrete volumes entered yet')
    expect(basisWarning(r)).toMatch(/not entered for 1 of 1/)
  })

  it('reports an incomplete plinth as missing volume rather than zero', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'M', 2, { footing: d(2, 2, 0.5), groups: [{ anchorageTypeId: w.A, count: 1, dims: d(null, null, null) }] })
    const v = run(r.s, 'volume')
    expect(v.missing).toMatchObject({ elements: 1, of: 2, foundations: ['M'] })
    expect(v.total).toBeCloseTo(4) // the footings only: 2 × 2 m³
  })
})

describe('completion basis: the three weightings on one mixed project', () => {
  /**
   * A: 3 foundations, footing 2 m³ + 3 plinth records of 0.25 m³; only the footing finished        → 1 of 4 records = 25%
   * B: 1 foundation, footing 4 m³, rebar built + forming done                                         → (0.5 + 1 + 0) / 3 = 50%
   * C: 10 foundations, footing 1 m³; finished                                                         → 100%
   */
  const mixed = (a = { qty: 3, footing: d(2, 1, 1) }) => {
    const w = world()
    const A = add(w.s, w.areaId, 'A', a.qty, { footing: a.footing, groups: [{ anchorageTypeId: w.A, count: 3, dims: d(0.5, 0.5, 1) }] })
    const B = add(A.s, w.areaId, 'B', 1, { footing: d(4, 1, 1) })
    const C = add(B.s, w.areaId, 'C', 10, { footing: d(1, 1, 1) })
    let s = finish(C.s, A.f.id)
    s = finish(s, B.f.id, ['rebarBuilt', 'formed'])
    s = finish(s, C.f.id)
    return s
  }

  it('foundation type: each designation counts once, a half-finished one contributes half', () => {
    const r = run(mixed(), 'type')
    expect(r.done).toBeCloseTo(0.25 + 0.5 + 1)
    expect(r).toMatchObject({ total: 3, percent: 58, unit: 'foundation types' })
    expect(basisFigures(r)).toBe('1.8 of 3 foundation types')
  })

  it('foundation count: weighted by the physical foundations each designation represents', () => {
    const r = run(mixed(), 'count')
    expect(r.done).toBeCloseTo(3 * 0.25 + 1 * 0.5 + 10 * 1) // 11.25
    expect(r).toMatchObject({ total: 14, percent: 80, unit: 'foundations' })
  })

  it('concrete volume: weighted by m³ (the footing of every A is finished, its plinths are not)', () => {
    const r = run(mixed(), 'volume')
    // A: 3 × 2 = 6 m³ footing + 3 plinths × 3 units × 0.25 = 2.25 m³; B: 4 m³; C: 10 × 1 = 10 m³. Done: 6 + 4 × 0.5 + 10 = 18 of 22.25.
    expect(r.total).toBeCloseTo(22.25)
    expect(r.done).toBeCloseTo(18)
    expect(r.percent).toBe(81)
  })

  it('type ignores quantity, plinth count and volume: changing them does not move it, while count and volume do', () => {
    const base = mixed()
    const big = mixed({ qty: 30, footing: d(20, 10, 1) }) // A becomes 30 foundations of 200 m³ footings
    expect(run(big, 'type').percent).toBe(run(base, 'type').percent)
    expect(run(big, 'type').done).toBeCloseTo(run(base, 'type').done)
    expect(run(big, 'count').percent).not.toBe(run(base, 'count').percent)
    expect(run(big, 'volume').percent).not.toBe(run(base, 'volume').percent)
  })

  it('uses the same stages in all three: a single designation gives the same percentage under every weighting', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'Z', 4, { footing: d(3, 3, 1) })
    const s = finish(r.s, r.f.id, ['rebarBuilt', 'rebarInstalled', 'formed'])
    expect([run(s, 'type').percent, run(s, 'count').percent, run(s, 'volume').percent]).toEqual([67, 67, 67])
  })
})
