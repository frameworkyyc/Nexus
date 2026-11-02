import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { installOwners } from '../anchorageMounts'
import { boltLines, outstandingBolts } from '../boltInstallation'
import { completionOf } from '../completionBasis'
import { INSTALL_KEYS, getDef, isConstructionCategory } from '../config'
import type { ComponentInput, FoundationConfig } from '../configActions'
import { emptyConstruction } from '../empty'
import { installationIndicator } from '../packageProgress'
import { effectiveStatus, foundationActivities, foundationState, foundationsOf, getIndex, isReady, progressOf } from '../selectors'
import { deriveRequirements } from '../tracker/requirements'
import type { ConstructionState, Dims, Foundation } from '../types'

function apply(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: ConstructionState, r: K.Reducer) => r(s, {}).error
const TODAY = '2026-11-02'
const d = (length: number, width: number, height: number): Dims => ({ length, width, height, unit: 'm' })
const bolt = (qty: number, over: Partial<ComponentInput> = {}): ComponentInput => ({ kind: 'bolt', qty, diameter: 'M30', length: 1200, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2, ...over })
const loose = (qty: number, installMethod?: 'wet-set' | 'post-installed') => ({ qty, diameter: '5/8"', length: 250, lengthUnit: 'mm' as const, thread: 'all-thread' as const, nutsPerBolt: 2, washersPerBolt: 1, ...(installMethod ? { installMethod } : {}) })

/** OP1-A11: 12 bolts and a template per anchorage. OP1-T: a template only (no bolts). */
function world() {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'E-House', []))
  s = apply(s, K.addAnchorageType(pid, 'OP1-A11', ''))
  s = apply(s, K.addAnchorageType(pid, 'OP1-T', ''))
  const [A11, T] = s.anchorageTypes.map((t) => t.id)
  s = apply(s, K.setAnchorageComponents(A11, [bolt(12), { kind: 'template', qty: 1 }]))
  s = apply(s, K.setAnchorageComponents(T, [{ kind: 'template', qty: 1 }]))
  return { s, areaId: s.areas[0].id, A11, T }
}
const add = (s: ConstructionState, areaId: string, number: string, plinths: number | null, quantity: number, config: FoundationConfig) => {
  const next = apply(s, K.createFoundation(areaId, number, '', plinths, quantity, config))
  return { s: next, f: next.foundations.find((x) => x.number === number) as Foundation }
}
const idxOf = (s: ConstructionState) => getIndex(s)
const acts = (s: ConstructionState, f: Foundation) => foundationActivities(idxOf(s), f)
const boltActs = (s: ConstructionState, f: Foundation) => acts(s, f).filter((a) => INSTALL_KEYS.includes(a.key))
const keys = (s: ConstructionState, f: Foundation) => boltActs(s, f).map((a) => a.key).sort()
const embed = (qty: number, installMethod?: 'wet-set' | 'post-installed', size = 16) => ({ plate: { thickness: size, width: 300, length: 300, unit: 'mm' as const, studCount: null, studDiameter: null, studLength: null }, save: 'foundation' as const, qty, mode: 'per-foundation' as const, ...(installMethod ? { installMethod } : {}) })
const mark = (s: ConstructionState, id: string, status: 'complete' | 'approved' | 'not-started' | 'in-progress' = 'complete') => apply(s, K.updateActivity(id, { status }, TODAY))
/** The pre-pour inspection approved, so the only thing that could hold up the pour is the anchor bolts. */
const inspected = (s: ConstructionState, f: Foundation) => mark(s, acts(s, f).find((a) => a.key === 'preInspection')!.id, 'approved')
/** Everything except anchor bolt installation, finished. */
const finishBuild = (s: ConstructionState, f: Foundation) => getIndex(s).activities.filter((a) => a.foundationId === f.id && isConstructionCategory(getDef(a.scope, a.key).category) && !INSTALL_KEYS.includes(a.key)).reduce((acc, a) => mark(acc, a.id), s)
const percent = (s: ConstructionState, f: Foundation) => progressOf(idxOf(s), acts(s, f))

describe('OP1-01-06: one footing, four post-installed anchor bolts, no plinths', () => {
  const pad = () => { const w = world(); return { ...w, ...add(w.s, w.areaId, 'OP1-01-06', 0, 1, { footing: d(1.1, 1.1, 0.4), bolts: [loose(4, 'post-installed')] }) } }

  it('has an Anchor bolts installed (post-installed) activity on the footing, and no other new work', () => {
    const { s, f } = pad()
    expect(boltActs(s, f).map((a) => [a.scope, a.key, a.status])).toEqual([['footing', 'anchorBoltsPostInstalled', 'not-started']])
    expect(getDef('footing', 'anchorBoltsPostInstalled').label).toBe('Anchor bolts installed (post-installed)')
    expect(acts(s, f).every((a) => a.scope === 'footing')).toBe(true) // still no plinths, no plinth activities
  })

  it('concrete can be marked poured while the post-installed bolts are outstanding, and the foundation is then NOT 100% complete', () => {
    const { s: s0, f } = pad()
    expect(percent(s0, f)).toBe(0)
    const s = finishBuild(s0, f)
    const poured = acts(s, f).find((a) => a.key === 'poured')!
    expect(effectiveStatus(idxOf(s), poured)).toBe('complete') // marking it poured was accepted
    expect(percent(s, f)).toBe(75) // rebar, forming and pouring are three of the four stages
    expect(foundationState(idxOf(s), f).state).toBe('in-progress') // not "Complete"
    const i = idxOf(s)
    for (const basis of ['type', 'count', 'volume'] as const) expect(completionOf(i, foundationsOf(i), basis).percent, basis).toBeLessThan(100)
    // The post-installed bolts wait for the concrete, never the other way round.
    expect(isReady(i, boltActs(s, f)[0])).toBe(true)
    expect(isReady(idxOf(s0), boltActs(s0, f)[0])).toBe(false)
    const ready = inspected(s0, f)
    expect(isReady(idxOf(ready), acts(ready, f).find((a) => a.key === 'poured')!)).toBe(true) // inspected, bolts still to go in: the pour is not held up by post-installed bolts
  })

  it('installing the bolts completes the foundation', () => {
    const { s: s0, f } = pad()
    const s = mark(finishBuild(s0, f), boltActs(s0, f)[0].id)
    expect(percent(s, f)).toBe(100)
    expect(foundationState(idxOf(s), f).state).toBe('constructed')
    const i = idxOf(s)
    for (const basis of ['type', 'count', 'volume'] as const) expect(completionOf(i, foundationsOf(i), basis).percent, basis).toBe(100)
  })

  it('says which bolts are outstanding and how they go in', () => {
    const { s, f } = pad()
    const a = boltActs(s, f)[0]
    expect(boltLines(s, f, a)).toEqual([expect.objectContaining({ source: 'Individual anchor bolts', total: 4 })])
    expect(outstandingBolts(s, f, acts(s, f), (x) => effectiveStatus(idxOf(s), x))).toEqual(['4 post-installed anchor bolts outstanding'])
    const done = mark(s, a.id)
    expect(outstandingBolts(done, f, acts(done, f), (x) => effectiveStatus(idxOf(done), x))).toEqual([])
  })

  it('the material quantities are the same whichever way the bolts go in', () => {
    const w = world()
    const need = (method: 'wet-set' | 'post-installed') => deriveRequirements(add(w.s, w.areaId, `X-${method}`, 0, 3, { bolts: [loose(4, method)] }).s).map((r) => [r.name, r.required]).sort()
    expect(need('wet-set')).toEqual(need('post-installed'))
  })
})

describe('unchecked Post-Install: installed with the pour, no separate activity', () => {
  it('wet-set bolts and embed plates add no installation activity, and never hold up the pour or completion', () => {
    const w = world()
    const added = add(w.s, w.areaId, 'W-1', 0, 1, { bolts: [loose(4)], embeds: [embed(2)], anchorages: [{ anchorageTypeId: w.A11, qty: 1 }] })
    expect(boltActs(added.s, added.f)).toEqual([])
    expect(percent(finishBuild(added.s, added.f), added.f)).toBe(100)
    expect(foundationState(idxOf(finishBuild(added.s, added.f)), added.f).state).toBe('constructed')
  })
})

describe('anchorage groups and individual bolts, on footings and plinths', () => {
  it('a Post-Install footing anchorage group with bolts gets the activity; a type with no bolts does not', () => {
    const w = world()
    const a = add(w.s, w.areaId, 'G-1', 0, 1, { anchorages: [{ anchorageTypeId: w.A11, qty: 2, installMethod: 'post-installed' }] })
    expect(boltActs(a.s, a.f).map((x) => x.key)).toEqual(['anchorBoltsPostInstalled'])
    expect(boltLines(a.s, a.f, boltActs(a.s, a.f)[0])).toEqual([expect.objectContaining({ source: 'OP1-A11 × 2', perFoundation: 24, total: 24 })])
    const t = add(w.s, w.areaId, 'G-2', 0, 1, { anchorages: [{ anchorageTypeId: w.T, qty: 2 }] })
    expect(boltActs(t.s, t.f)).toEqual([])
    expect(percent(finishBuild(t.s, t.f), t.f)).toBe(100) // no bolts required: unchanged, complete as before
  })

  it('each plinth with bolts gets its own installation activity; plinths without bolts and the footing do not', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'P-1', null, 2, {
      groups: [
        { count: 2, anchorages: [{ anchorageTypeId: w.A11, qty: 1, installMethod: 'post-installed' }] },
        { count: 1, anchorages: [{ anchorageTypeId: w.T, qty: 1 }] },
      ],
    })
    const owners = installOwners(r.s)
    const [p1, p2, p3] = r.s.plinths.filter((p) => p.foundationId === r.f.id)
    expect([...owners.keys()].sort()).toEqual([p1.id, p2.id].sort())
    expect(boltActs(r.s, r.f).map((a) => a.plinthId).sort()).toEqual([p1.id, p2.id].sort())
    expect(owners.has(p3.id)).toBe(false)
    expect(owners.has(r.f.id)).toBe(false)
  })

  it('mixed methods on one footing: only the Post-Install parts are tracked, and progress follows them', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'M-1', 0, 1, { anchorages: [{ anchorageTypeId: w.A11, qty: 1, installMethod: 'wet-set' }], bolts: [loose(4, 'post-installed')], embeds: [embed(2, 'post-installed'), embed(1, 'wet-set', 20)] })
    expect(keys(r.s, r.f)).toEqual(['anchorBoltsPostInstalled', 'embedsPostInstalled'])
    const built = finishBuild(r.s, r.f)
    expect(percent(built, r.f)).toBe(75) // install stage 0 of 2 activities
    const bolts = mark(built, boltActs(r.s, r.f).find((a) => a.key === 'anchorBoltsPostInstalled')!.id)
    expect(percent(bolts, r.f)).toBe(88) // (1 + 1 + 1 + 0.5) / 4
    expect(foundationState(idxOf(bolts), r.f).state).toBe('in-progress')
    expect(outstandingBolts(bolts, r.f, acts(bolts, r.f), (x) => effectiveStatus(idxOf(bolts), x))).toEqual(['2 post-installed embed plates outstanding'])
    const both = mark(bolts, boltActs(r.s, r.f).find((a) => a.key === 'embedsPostInstalled')!.id)
    expect(percent(both, r.f)).toBe(100)
    expect(foundationState(idxOf(both), r.f).state).toBe('constructed')
  })

  it('post-installed embed plates: own activity, pour not held up, lines name the plates', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'E-1', 0, 3, { footing: d(1, 1, 1), embeds: [embed(2, 'post-installed')] })
    expect(keys(r.s, r.f)).toEqual(['embedsPostInstalled'])
    expect(getDef('footing', 'embedsPostInstalled').label).toBe('Embed plates installed (post-installed)')
    const act = boltActs(r.s, r.f)[0]
    expect(boltLines(r.s, r.f, act)).toEqual([expect.objectContaining({ source: 'Individual embed plates', perFoundation: 2, total: 6 })])
    const s = finishBuild(r.s, r.f)
    expect(effectiveStatus(idxOf(s), acts(s, r.f).find((a) => a.key === 'poured')!)).toBe('complete')
    expect(percent(s, r.f)).toBe(75)
    expect(outstandingBolts(s, r.f, acts(s, r.f), (x) => effectiveStatus(idxOf(s), x))).toEqual(['6 post-installed embed plates outstanding'])
    expect(percent(mark(s, act.id), r.f)).toBe(100)
  })

  it('a Post-Install anchorage group covers the embed plates of its type too, on plinths', () => {
    const w = world()
    let s = apply(w.s, K.addAnchorageType(w.s.projects[0].id, 'OP1-E', ''))
    const E = s.anchorageTypes.find((t) => t.code === 'OP1-E')!.id
    s = apply(s, K.setAnchorageComponents(E, [{ kind: 'embed-plate', qty: 2, studCount: null, studDiameter: null, studLength: null }, bolt(4)]))
    const r = add(s, w.areaId, 'E-2', null, 1, { groups: [{ count: 2, anchorages: [{ anchorageTypeId: E, qty: 1, installMethod: 'post-installed' }] }] })
    expect(boltActs(r.s, r.f).map((a) => `${a.plinthId}:${a.key}`).sort()).toEqual(r.s.plinths.filter((p) => p.foundationId === r.f.id).flatMap((p) => [`${p.id}:anchorBoltsPostInstalled`, `${p.id}:embedsPostInstalled`]).sort())
    const off = apply(r.s, K.configureFoundation(r.f.id, { groups: [{ id: r.s.plinths.find((p) => p.foundationId === r.f.id)!.groupId!, count: 2, anchorages: [{ id: r.s.foundationAnchorages![0].id, anchorageTypeId: E, qty: 1, installMethod: 'wet-set' }] }] }))
    expect(boltActs(off, r.f)).toEqual([])
  })

  it('several Post-Install groups share one activity: nothing doubles, and recorded progress stays when more are added or removed', () => {
    const w = world()
    const post = { installMethod: 'post-installed' as const }
    const r = add(w.s, w.areaId, 'S-1', 0, 1, { anchorages: [{ anchorageTypeId: w.A11, qty: 1, ...post }] })
    const id = boltActs(r.s, r.f)[0].id
    let s = apply(mark(r.s, id), K.updateActivity(id, { notes: 'north bolts set' }, TODAY))
    const before = s.activities.find((a) => a.id === id)!
    s = apply(s, K.configureFoundation(r.f.id, { anchorages: [{ anchorageTypeId: w.A11, qty: 1, ...post }, { anchorageTypeId: w.A11, qty: 2, ...post }] }))
    expect(boltActs(s, r.f)).toHaveLength(1)
    expect(s.activities.find((a) => a.id === id)).toEqual(before)
    s = apply(s, K.configureFoundation(r.f.id, { embeds: [embed(2, 'post-installed')] }))
    expect(keys(s, r.f)).toEqual(['anchorBoltsPostInstalled', 'embedsPostInstalled'])
    expect(s.activities.find((a) => a.id === id)).toEqual(before)
    expect(boltActs(s, r.f).find((a) => a.key === 'embedsPostInstalled')!.status).toBe('not-started')
    s = apply(s, K.configureFoundation(r.f.id, { embeds: [] }))
    expect(keys(s, r.f)).toEqual(['anchorBoltsPostInstalled'])
    expect(s.activities.find((a) => a.id === id)).toEqual(before)
  })

  it('editing an existing group keeps its method unless it is changed; changing it moves the work to the other activity', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'C-1', 0, 1, { anchorages: [{ anchorageTypeId: w.A11, qty: 1, installMethod: 'post-installed' }] })
    const gid = r.s.foundationAnchorages![0].id
    const kept = apply(r.s, K.configureFoundation(r.f.id, { anchorages: [{ id: gid, anchorageTypeId: w.A11, qty: 3 }] }))
    expect(kept.foundationAnchorages![0]).toMatchObject({ qty: 3, installMethod: 'post-installed' })
    expect(boltActs(kept, r.f).map((a) => a.key)).toEqual(['anchorBoltsPostInstalled'])
    const moved = apply(kept, K.configureFoundation(r.f.id, { anchorages: [{ id: gid, anchorageTypeId: w.A11, qty: 3, installMethod: 'wet-set' }] }))
    expect(boltActs(moved, r.f)).toEqual([]) // unchecked: installed with the pour
    expect(err(r.s, K.configureFoundation(r.f.id, { anchorages: [{ anchorageTypeId: w.A11, qty: 1, installMethod: 'drilled' as never }] }))).toMatch(/wet-set or post-installed/)
    expect(err(r.s, K.configureFoundation(r.f.id, { bolts: [loose(2, 'glued' as never)] }))).toMatch(/wet-set or post-installed/)
  })

  it('a library type that gains or loses its bolts adds or removes the activities everywhere it is used', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'L-1', 0, 1, { anchorages: [{ anchorageTypeId: w.T, qty: 1, installMethod: 'post-installed' }] })
    expect(boltActs(r.s, r.f)).toEqual([])
    const gained = apply(r.s, K.setAnchorageComponents(w.T, [bolt(4), { kind: 'template', qty: 1 }]))
    expect(boltActs(gained, r.f).map((a) => a.key)).toEqual(['anchorBoltsPostInstalled'])
    const lost = apply(gained, K.setAnchorageComponents(w.T, [{ kind: 'template', qty: 1 }]))
    expect(boltActs(lost, r.f)).toEqual([])
  })
})

describe('progress and the completion bases', () => {
  /** A: 10 foundations, bolts outstanding, everything else built. B: 2 foundations, no bolts, built. */
  const mixed = () => {
    const w = world()
    const a = add(w.s, w.areaId, 'A', 0, 10, { footing: d(1, 1, 1), anchorages: [{ anchorageTypeId: w.A11, qty: 1, installMethod: 'post-installed' }] })
    const b = add(a.s, w.areaId, 'B', 0, 2, { footing: d(1, 1, 1) })
    return { s: finishBuild(finishBuild(b.s, b.f), a.f), a: a.f, b: b.f }
  }

  it('outstanding bolts hold every basis below 100%, with the same stages behind each', () => {
    const { s } = mixed()
    const i = idxOf(s)
    // A is 75% (bolts are one of four stages), B is 100%.
    expect(completionOf(i, foundationsOf(i), 'type')).toMatchObject({ percent: 88, done: expect.closeTo(1.75, 6), total: 2 }) // (0.75 + 1) / 2
    expect(completionOf(i, foundationsOf(i), 'count')).toMatchObject({ percent: 79 }) // (10 × 0.75 + 2) / 12
    expect(completionOf(i, foundationsOf(i), 'volume')).toMatchObject({ percent: 79 }) // equal footings: volume follows the foundation count
  })

  it('the area installation indicator counts the bolts and the construction package cannot reach 100% without them', () => {
    const { s } = mixed()
    const ind = installationIndicator(idxOf(s), s.areas[0].id)
    expect(ind.percent).toBeLessThan(100)
    expect(ind.rows.find((r) => r.label === 'Anchor bolts installed')).toMatchObject({ value: '0 / 1' })
  })

  it('foundations with no bolts keep exactly the figures they had', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'N-1', 2, 3, { footing: d(1, 1, 1), groups: [{ count: 2, anchorages: [{ anchorageTypeId: w.T, qty: 1 }] }] })
    const built = finishBuild(r.s, r.f)
    expect(boltActs(built, r.f)).toEqual([])
    expect(percent(built, r.f)).toBe(100)
    expect(percent(r.s, r.f)).toBe(0)
  })
})
