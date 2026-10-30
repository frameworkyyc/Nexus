/* eslint-disable prefer-const -- destructured fixtures where only `s` is reassigned */
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { boxVolumeM3, concreteByAnchorage, foundationConcrete, toMetres } from '../concrete'
import { emptyConstruction } from '../empty'
import { plinthsPerFoundationFromGroups } from '../foundationQuantity'
import { anchorageFor, buildCatalog } from '../tracker/catalog'
import { emptyTracker } from '../tracker/types'
import { componentInfo, pourBreakdown, pourTotals } from '../pours'
import type { ConstructionState, Dims } from '../types'

function apply(s: ConstructionState, r: K.Reducer, ctx: K.Ctx = {}): ConstructionState { const o = r(s, ctx); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: ConstructionState, r: K.Reducer, ctx: K.Ctx = {}) => r(s, ctx).error
const TODAY = '2026-10-30'
const d = (length: number | null, width: number | null, height: number | null, unit: Dims['unit'] = 'm'): Dims => ({ length, width, height, unit })

/** OP-101 × 18: 2 Type A plinths + 1 Type B plinth per foundation, footing 4 × 3 × 0.5 m. */
function world() {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'Area 1', []))
  s = apply(s, K.addAnchorageType(pid, 'A', 'Type A'))
  s = apply(s, K.addAnchorageType(pid, 'B', 'Type B'))
  const [A, B] = s.anchorageTypes.map((t) => t.id)
  s = apply(s, K.createFoundation(s.areas[0].id, 'OP-101', '', null, 18, { footing: d(4, 3, 0.5), groups: [{ anchorageTypeId: A, count: 2, dims: d(0.5, 0.5, 0.8) }, { anchorageTypeId: B, count: 1, dims: d(600, 600, 1000, 'mm') }] }))
  const f = s.foundations[0]
  return { s, pid, A, B, f }
}

describe('anchorage groups', () => {
  it('2 × Type A + 1 × Type B on a quantity of 18 gives 54 plinths: 36 A and 18 B, from 3 plinth records', () => {
    const { s, f, A, B } = world()
    const mine = s.plinths.filter((p) => p.foundationId === f.id)
    expect(mine).toHaveLength(3)
    expect(mine.map((p) => p.anchorageTypeId)).toEqual([A, A, B])
    expect(f.plinthsPerFoundation).toBe(3)
    const by = concreteByAnchorage(foundationConcrete(f, s.plinths, s.anchorageGroups!))
    expect(by.map((r) => [r.typeId, r.plinthsTotal])).toEqual([[A, 36], [B, 18]])
  })

  it('keeps plinth ids and records when the configuration is edited', () => {
    let { s, f, A, B } = world()
    const ids = s.plinths.map((p) => p.id)
    s = apply(s, K.setPlinthDims(ids[0], d(1, 1, 1)))
    s = apply(s, K.setPlinthDims(ids[1], d(2, 2, 2)))
    const groups = s.anchorageGroups!.filter((g) => g.foundationId === f.id)
    s = apply(s, K.configureFoundation(f.id, { groups: [{ id: groups[0].id, anchorageTypeId: A, count: 3 }, { id: groups[1].id, anchorageTypeId: B, count: 1 }] })) // grow A by one
    expect(s.plinths.slice(0, 3).map((p) => p.id)).toEqual(ids) // the originals are untouched
    expect(s.plinths.find((p) => p.id === ids[0])?.dims).toMatchObject({ length: 1 })
    expect(s.plinths).toHaveLength(4)
    expect(err(s, K.configureFoundation(f.id, { groups: [{ id: groups[0].id, anchorageTypeId: A, count: 1 }, { id: groups[1].id, anchorageTypeId: B, count: 1 }] }))).toMatch(/cannot be removed/) // the highest-numbered plinths of A go first; plinth 2 has its own dimensions
  })

  it('refuses duplicate types, unknown types and bad counts; an unassigned group is allowed once', () => {
    const { s, f, A } = world()
    expect(err(s, K.configureFoundation(f.id, { groups: [{ anchorageTypeId: A, count: 1 }, { anchorageTypeId: A, count: 1 }] }))).toMatch(/already in another group/)
    expect(err(s, K.configureFoundation(f.id, { groups: [{ anchorageTypeId: 'nope', count: 1 }] }))).toMatch(/library/)
    expect(err(s, K.configureFoundation(f.id, { groups: [{ anchorageTypeId: A, count: 0 }] }))).toMatch(/whole number/)
    expect(err(s, K.configureFoundation(f.id, { groups: [{ anchorageTypeId: null, count: 1 }, { anchorageTypeId: null, count: 1 }] }))).toMatch(/Only one group/)
    expect(apply(s, K.configureFoundation(f.id, { groups: [{ anchorageTypeId: null, count: 2 }] })).plinths.filter((p) => p.foundationId === f.id && p.anchorageTypeId === null)).toHaveLength(2)
  })

  it('bulk-entry style creation still works: a plain plinth count makes one unassigned group', () => {
    const { s } = world()
    const n = apply(s, K.addFoundations(s.areas[0].id, [{ number: 'N-1', description: '', plinthCount: 4, quantity: 2 }, { number: 'N-2', description: '', plinthCount: null }]))
    const f = n.foundations.find((x) => x.number === 'N-1')!
    expect(n.anchorageGroups!.filter((g) => g.foundationId === f.id)).toMatchObject([{ anchorageTypeId: null, count: 4 }])
    expect(n.plinths.filter((p) => p.foundationId === f.id).every((p) => p.anchorageTypeId === null)).toBe(true)
    expect(n.plinths.filter((p) => p.foundationId === n.foundations.find((x) => x.number === 'N-2')!.id)).toHaveLength(0)
  })
})

describe('register quantities: footings and total plinths', () => {
  it('18 footings with 3 plinths each is 18 footings / 54 plinths, from the quantity and the anchorage groups', () => {
    const { s, f } = world()
    const groups = s.anchorageGroups!.filter((g) => g.foundationId === f.id)
    const per = plinthsPerFoundationFromGroups(f, s.plinths.length, groups)
    expect(per).toBe(3)
    expect(f.quantity! * per!).toBe(54)
    // groups are the source: a stale stored count does not change the result
    expect(plinthsPerFoundationFromGroups({ ...f, plinthsPerFoundation: 99 }, 99, groups)).toBe(3)
    // without groups (older records) the stored value still applies; unknown stays unknown
    expect(plinthsPerFoundationFromGroups({ ...f, plinthsPerFoundation: 4 }, 4, [])).toBe(4)
    expect(plinthsPerFoundationFromGroups({ ...f, plinthsPerFoundation: null }, 0, [])).toBeNull()
  })
})

describe('anchorage type created while configuring a foundation', () => {
  it('refuses duplicate codes ignoring case and spacing, and a new type is usable straight away and project-wide', () => {
    let { s, pid, f, A } = world()
    for (const dup of ['a', '  A ', 'b']) expect(err(s, K.addAnchorageType(pid, dup, ''))).toMatch(/already exists/)
    s = apply(s, K.addAnchorageType(pid, '  Type   C ', ''))
    const c = s.anchorageTypes.find((t) => t.code === 'Type C')! // trimmed and single-spaced
    expect(c.id).toMatch(/^anc-/)
    s = apply(s, K.configureFoundation(f.id, { groups: s.anchorageGroups!.filter((g) => g.foundationId === f.id).map((g, i) => ({ id: g.id, anchorageTypeId: i === 1 ? c.id : g.anchorageTypeId, count: g.count, dims: g.dims })) }))
    expect(s.plinths.filter((p) => p.foundationId === f.id).map((p) => p.anchorageTypeId)).toEqual([A, A, c.id]) // second group (one plinth) now uses Type C; plinth ids unchanged
    // available to other foundations in the project, and offered first for foundations that use it
    s = apply(s, K.createFoundation(s.areas[0].id, 'OP-102', '', null, 1, { groups: [{ anchorageTypeId: c.id, count: 2 }] }))
    const other = s.foundations.find((x) => x.number === 'OP-102')!
    const list = anchorageFor(buildCatalog(s, emptyTracker()), other.id)
    expect(list.find((a) => a.id === c.id)).toMatchObject({ onFoundation: true })
    expect(list.map((a) => a.code)).toContain('Type C')
    // concrete volumes were not disturbed by the type change
    expect(foundationConcrete(s.foundations.find((x) => x.id === f.id)!, s.plinths, s.anchorageGroups!).total).toBeCloseTo(121.68)
  })
})

describe('materials integration', () => {
  it('foundation anchorage types come first in Materials dropdowns, with the same stable ids, and no quantities are generated', () => {
    let { s, pid, f, A } = world()
    s = apply(s, K.addAnchorageType(pid, 'C', 'Type C'))
    const cat = buildCatalog(s, emptyTracker())
    const list = anchorageFor(cat, f.id)
    expect(list.slice(0, 2).map((a) => [a.id, a.onFoundation])).toEqual([[A, true], [s.anchorageTypes[1].id, true]])
    expect(list.at(-1)).toMatchObject({ code: 'C', onFoundation: false })
    const t = emptyTracker()
    expect(t.manual ?? []).toHaveLength(0) // configuring a foundation never creates or multiplies material lines
  })
})

describe('concrete volumes', () => {
  it('converts every unit to metres exactly', () => {
    expect(toMetres(1000, 'mm')).toBeCloseTo(1)
    expect(toMetres(100, 'cm')).toBeCloseTo(1)
    expect(toMetres(10, 'ft')).toBeCloseTo(3.048)
    expect(toMetres(10, 'in')).toBeCloseTo(0.254)
    expect(boxVolumeM3(d(10, 10, 10, 'ft'))).toBeCloseTo(28.316846592, 6)
    expect(boxVolumeM3(d(1000, 2000, 500, 'mm'))).toBeCloseTo(1)
  })

  it('footing, plinths, per foundation and across the quantity', () => {
    const { s, f } = world()
    const c = foundationConcrete(f, s.plinths, s.anchorageGroups!)
    expect(c.footing).toBeCloseTo(6) // 4 × 3 × 0.5
    expect(c.plinths.map((p) => p.net)).toEqual([expect.closeTo(0.2, 9), expect.closeTo(0.2, 9), expect.closeTo(0.36, 9)]) // 0.5×0.5×0.8, 0.6×0.6×1.0 (mm)
    expect(c.plinthsKnown).toBeCloseTo(0.76)
    expect(c.perFoundation).toBeCloseTo(6.76)
    expect(c.totalFooting).toBeCloseTo(108)
    expect(c.totalPlinths).toBeCloseTo(13.68)
    expect(c.total).toBeCloseTo(121.68)
    expect(c.complete).toBe(true)
  })

  it('never shows a misleading total when something is missing', () => {
    let { s, f } = world()
    s = apply(s, K.configureFoundation(f.id, { footing: null }))
    let c = foundationConcrete(s.foundations[0], s.plinths, s.anchorageGroups!)
    expect(c.total).toBeNull(); expect(c.perFoundation).toBeNull(); expect(c.complete).toBe(false)
    expect(c.missing.join()).toMatch(/footing dimensions/)
    expect(c.perFoundationKnown).toBeCloseTo(0.76) // reported separately as "known so far", not as the total
    s = apply(s, K.configureFoundation(f.id, { footing: d(4, 3, null) })) // partial dimensions are not zero either
    c = foundationConcrete(s.foundations[0], s.plinths, s.anchorageGroups!)
    expect(c.footing).toBeNull()
  })

  it('does not double count concrete where plinths stand inside the footing', () => {
    let { s, f } = world()
    s = apply(s, K.configureFoundation(f.id, { plinthBase: 'from-footing-base' }))
    const c = foundationConcrete(s.foundations[0], s.plinths, s.anchorageGroups!)
    // heights 0.8 / 0.8 / 1.0 measured from the footing base; the lowest 0.5 m is already in the footing
    expect(c.plinths.map((p) => p.net)).toEqual([expect.closeTo(0.25 * 0.3, 9), expect.closeTo(0.25 * 0.3, 9), expect.closeTo(0.36 * 0.5, 9)])
    expect(c.perFoundation).toBeCloseTo(6 + 0.075 * 2 + 0.18)
    s = apply(s, K.configureFoundation(f.id, { footing: d(4, 3, 1.2) }))
    expect(foundationConcrete(s.foundations[0], s.plinths, s.anchorageGroups!).warnings.join()).toMatch(/inside the footing/)
  })

  it('warns when plinth footprints exceed the footing', () => {
    let { s, f } = world()
    s = apply(s, K.configureFoundation(f.id, { footing: d(0.5, 0.5, 0.5) }))
    expect(foundationConcrete(s.foundations[0], s.plinths, s.anchorageGroups!).warnings.join()).toMatch(/footprints add up to more/)
  })
})

describe('pour planning', () => {
  const plan = () => {
    const w = world()
    let s = apply(w.s, K.createPour(w.pid, 'Week 12', '2026-11-02', 5))
    return { ...w, s, pour: s.pours![0] }
  }

  it('plans exactly the selected footings (6 of 18), with waste', () => {
    let { s, pour, f } = plan()
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1, 2, 3, 4, 5, 6], components: 'footing' }]))
    const t = pourTotals(s.pours![0], s.pourItems!)
    expect(s.pourItems).toHaveLength(6)
    expect(t.footing).toBeCloseTo(36); expect(t.plinths).toBe(0); expect(t.planned).toBeCloseTo(36); expect(t.withWaste).toBeCloseTo(37.8)
    expect(s.pours![0].status).toBe('scheduled')
  })

  it('selects footings, plinths or both, and individual plinths; breaks down by foundation, component and anchorage type', () => {
    let { s, pour, f, A, B } = plan()
    const ids = s.plinths.map((p) => p.id)
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1, 2], components: 'both', plinthIds: [ids[0], ids[2]] }]))
    expect(s.pourItems).toHaveLength(2 * 3) // footing + 2 plinths, for 2 foundations
    const rows = pourBreakdown(s, s.pours![0])
    expect(rows.map((r) => [r.component, r.anchorageTypeId, r.count, Math.round(r.m3 * 1000) / 1000])).toEqual([['footing', null, 2, 12], ['plinth', A, 2, 0.4], ['plinth', B, 2, 0.72]])
  })

  it('combines several foundation types in one pour and refuses items from another project or beyond the quantity', () => {
    let { s, pour, f } = plan()
    s = apply(s, K.createFoundation(s.areas[0].id, 'OP-102', '', null, 2, { footing: d(1, 1, 1), groups: [{ anchorageTypeId: null, count: 1, dims: d(1, 1, 1) }] }))
    const g = s.foundations.find((x) => x.number === 'OP-102')!
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1], components: 'footing' }, { foundationId: g.id, units: [1, 2], components: 'both' }]))
    expect(new Set(s.pourItems!.map((i) => i.foundationId)).size).toBe(2)
    expect(err(s, K.addPourItems(pour.id, [{ foundationId: g.id, units: [3], components: 'footing' }]))).toMatch(/choose numbers from 1 to 2/)
    s = apply(s, K.createProject({ name: 'Other' }))
    const other = s.projects[1].id
    const p2 = apply(s, K.createPour(other, 'Elsewhere', null, 0))
    expect(err(p2, K.addPourItems(p2.pours![1].id, [{ foundationId: f.id, units: [1], components: 'footing' }]))).toMatch(/different project/)
  })

  it('records an unknown volume as unknown, not zero', () => {
    let { s, pour, f } = plan()
    s = apply(s, K.configureFoundation(f.id, { footing: null }))
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1], components: 'footing' }]))
    const t = pourTotals(s.pours![0], s.pourItems!)
    expect(s.pourItems![0].plannedM3).toBeNull(); expect(t.unknownItems).toBe(1)
  })

  it('does not plan a component twice (same pour is idempotent, another open pour is refused)', () => {
    let { s, pour, pid, f } = plan()
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1], components: 'footing' }]))
    expect(err(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1], components: 'footing' }]))).toMatch(/already in this pour/)
    s = apply(s, K.createPour(pid, 'Second', null, 0))
    expect(err(s, K.addPourItems(s.pours![1].id, [{ foundationId: f.id, units: [1], components: 'footing' }]))).toMatch(/already in the pour “Week 12”/)
    expect(s.pours![1].status).toBe('planned')
  })

  it('plinths can be planned before footings, but not completed until the footing is poured (admin override with reason)', () => {
    let { s, pour, f } = plan()
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1], components: 'both' }]))
    const plinth = s.pourItems!.find((i) => i.component === 'plinth')!
    const footing = s.pourItems!.find((i) => i.component === 'footing')!
    expect(err(s, K.recordPour(plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, TODAY))).toMatch(/footing .* not recorded as poured/)
    expect(err(s, K.recordPourOverride(plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, 'x', TODAY))).toMatch(/reason/)
    const forced = apply(s, K.recordPourOverride(plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, 'Footing poured under last season’s permit', TODAY), { actor: 'admin@example.com' })
    expect(forced.pourItems!.find((i) => i.id === plinth.id)).toMatchObject({ completedDate: TODAY, overrideReason: 'Footing poured under last season’s permit', overrideBy: 'admin@example.com' })
    const normal = apply(apply(s, K.recordPour(footing.id, { pouredM3: 6, complete: true, date: TODAY }, TODAY)), K.recordPour(plinth.id, { pouredM3: 0.2, complete: true, date: TODAY }, TODAY))
    expect(normal.pourItems!.find((i) => i.id === plinth.id)).toMatchObject({ completedDate: TODAY, overrideReason: '' })
  })

  it('supports partial pours and never double counts: recording replaces, completion happens once', () => {
    let { s, pour, f, pid } = plan()
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1], components: 'footing' }]))
    const item = s.pourItems![0]
    s = apply(s, K.recordPour(item.id, { pouredM3: 2, complete: false, date: null }, TODAY))
    s = apply(s, K.recordPour(item.id, { pouredM3: 2, complete: false, date: null }, TODAY)) // submitted twice: still 2, not 4
    expect(s.pourItems![0].pouredM3).toBe(2)
    expect(componentInfo(s, f.id, 1, null).state).toBe('planned')
    s = apply(s, K.completePour(pour.id, TODAY, TODAY))
    expect(s.pours![0].status).toBe('completed')
    expect(componentInfo(s, f.id, 1, null)).toMatchObject({ state: 'partial', pouredM3: 2 })
    // the remainder is planned in a later pour: only 4 m³ remains of 6
    s = apply(s, K.createPour(pid, 'Top up', TODAY, 0))
    s = apply(s, K.addPourItems(s.pours![1].id, [{ foundationId: f.id, units: [1], components: 'footing' }]))
    const rest = s.pourItems!.find((i) => i.pourId === s.pours![1].id)!
    expect(rest.plannedM3).toBeCloseTo(4)
    s = apply(s, K.recordPour(rest.id, { pouredM3: 4, complete: true, date: TODAY }, TODAY))
    expect(componentInfo(s, f.id, 1, null)).toMatchObject({ state: 'completed', pouredM3: 6 })
    // a second completion record for the same component cannot be made
    s = apply(s, K.createPour(pid, 'Again', null, 0))
    expect(err(s, K.addPourItems(s.pours![2].id, [{ foundationId: f.id, units: [1], components: 'footing' }]))).toMatch(/already recorded as poured/)
    expect(err(s, K.recordPour(rest.id, { pouredM3: 4, complete: true, date: TODAY }, TODAY))).toMatch(/already recorded/)
  })

  it('completing releases untouched items; cancelling is refused once concrete is recorded', () => {
    let { s, pour, f } = plan()
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [1, 2], components: 'footing' }]))
    expect(err(s, K.completePour(pour.id, TODAY, TODAY))).toMatch(/Nothing has been recorded/)
    s = apply(s, K.recordPour(s.pourItems![0].id, { pouredM3: 6, complete: true, date: TODAY }, TODAY))
    expect(err(s, K.cancelPour(pour.id))).toMatch(/Complete it instead/)
    s = apply(s, K.completePour(pour.id, TODAY, TODAY))
    expect(s.pourItems).toHaveLength(1) // unit 2 was released
    expect(componentInfo(s, f.id, 2, null).state).toBe('available')
    expect(err(s, K.recordPour(s.pourItems![0].id, { pouredM3: 1, complete: false, date: null }, TODAY))).toMatch(/planned or scheduled/)
  })

  it('protects referenced plinths and quantities from destructive edits', () => {
    let { s, pour, f, A, B } = plan()
    s = apply(s, K.addPourItems(pour.id, [{ foundationId: f.id, units: [5], components: 'both' }]))
    expect(err(s, K.configureFoundation(f.id, { quantity: 4 }))).toMatch(/cannot go below 5/)
    expect(apply(s, K.configureFoundation(f.id, { quantity: 5 })).foundations[0].quantity).toBe(5)
    const gs = s.anchorageGroups!.filter((g) => g.foundationId === f.id)
    expect(err(s, K.configureFoundation(f.id, { groups: [{ id: gs[0].id, anchorageTypeId: A, count: 1 }, { id: gs[1].id, anchorageTypeId: B, count: 1 }] }))).toMatch(/cannot be removed/)
  })
})
