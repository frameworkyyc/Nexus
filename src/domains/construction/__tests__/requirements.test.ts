/* eslint-disable prefer-const -- destructured fixtures where only `s` is reassigned */
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { refreshRequirements, scopedCalc } from '../tracker/requirements'
import { emptyTracker, type TrackerLine, type TrackerState } from '../tracker/types'
import type { ComponentInput } from '../configActions'
import type { ConstructionState } from '../types'

const TODAY = '2026-10-30'
function apply(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: ConstructionState, r: K.Reducer) => r(s, {}).error
const at = (s: TrackerState, c: ConstructionState) => refreshRequirements(s, c, { log: true, at: '2026-10-30T12:00:00Z' })
const bolt = (over: Partial<ComponentInput> = {}): ComponentInput => ({ kind: 'bolt', qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm', thread: 'both-ends', topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2, ...over })
const template: ComponentInput = { kind: 'template', qty: 1, spec: '19 mm plywood' }

/** Type A needs 4 × M25 × 900 mm bolts (2 nuts and 2 washers each) and 1 plywood template. 12 foundations × 3 plinths of type A = 36 anchorages. */
function world() {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'Area 1', []))
  s = apply(s, K.addAnchorageType(pid, 'A', 'Type A'))
  s = apply(s, K.addAnchorageType(pid, 'B', 'Type B'))
  const [A1, B1] = s.anchorageTypes.map((t) => t.id)
  s = apply(s, K.setAnchorageComponents(A1, [bolt(), template]))
  s = apply(s, K.createFoundation(s.areas[0].id, 'OP-1', '', null, 12, { groups: [{ anchorageTypeId: A1, count: 3 }] }))
  return { s, pid, A1, B1, f: s.foundations[0] }
}
const find = (t: TrackerState, name: string) => t.manual.find((l) => l.origin === 'anchorage' && l.component === name)!

describe('sole plate centre hole', () => {
  it('is optional, validated, kept on edit and shown in the material specification', () => {
    const { s, A1 } = world()
    const plate = (o: Partial<ComponentInput> = {}): ComponentInput => ({ kind: 'sole-plate', qty: 1, size: '300 x 300 x 12 mm', ...o })
    expect(err(s, K.setAnchorageComponents(A1, [plate()]))).toBeUndefined()
    expect(err(s, K.setAnchorageComponents(A1, [plate({ centerHole: 0 })]))).toMatch(/centre hole/)
    expect(err(s, K.setAnchorageComponents(A1, [plate({ centerHole: -5 })]))).toMatch(/centre hole/)
    const t = apply(s, K.setAnchorageComponents(A1, [plate({ centerHole: 1.5, lengthUnit: 'in' })]))
    expect(t.anchorageComponents![0]).toMatchObject({ centerHole: 1.5, lengthUnit: 'in' })
    const none = apply(s, K.setAnchorageComponents(A1, [plate()]))
    expect(none.anchorageComponents![0].centerHole).toBeNull()
    const m = at(emptyTracker(), t)
    expect(find(m, 'Sole plate')).toMatchObject({ specification: 'centre hole Ø1.5 in', size: '300 x 300 x 12 mm' })
    const mm = at(emptyTracker(), apply(s, K.setAnchorageComponents(A1, [plate({ spec: 'CSA G40.21 350W', centerHole: 40 })])))
    expect(find(mm, 'Sole plate').specification).toBe('CSA G40.21 350W, centre hole Ø40 mm')
  })
})

describe('embed plate headed studs', () => {
  it('are optional, validated, kept on edit, and make plates with different studs separate materials', () => {
    const { s, A1 } = world()
    const plate = (o: Partial<ComponentInput> = {}): ComponentInput => ({ kind: 'embed-plate', qty: 2, size: '320 x 320 mm', ...o })
    expect(err(s, K.setAnchorageComponents(A1, [plate()]))).toBeUndefined() // no studs
    expect(err(s, K.setAnchorageComponents(A1, [plate({ studCount: 4 })]))).toMatch(/stud diameter/)
    expect(err(s, K.setAnchorageComponents(A1, [plate({ studCount: 4, studDiameter: 19 })]))).toMatch(/stud length/)
    expect(err(s, K.setAnchorageComponents(A1, [plate({ studCount: 0, studDiameter: 19, studLength: 150 })]))).toMatch(/studs per plate/)
    expect(err(s, K.setAnchorageComponents(A1, [plate({ studDiameter: 19, studLength: 150 })]))).toMatch(/studs per plate/)
    const t = apply(s, K.setAnchorageComponents(A1, [plate({ studCount: 4, studDiameter: 0.75, studLength: 6, lengthUnit: 'in' }), plate({ studCount: 6, studDiameter: 19, studLength: 150 }), plate()]))
    expect(t.anchorageComponents![0]).toMatchObject({ studCount: 4, studDiameter: 0.75, studLength: 6, lengthUnit: 'in' })
    expect(t.anchorageComponents![2].studCount).toBeNull()
    const m = at(emptyTracker(), t).manual.filter((l) => l.origin === 'anchorage' && l.component === 'Embed plate')
    expect(m.map((l) => l.specification).sort()).toEqual(['', '4 headed studs Ø0.75 × 6 in', '6 headed studs Ø19 × 150 mm'])
  })
})

describe('anchorage components', () => {
  it('validates: bolts need a diameter, length and thread; an anchorage can be embed plates only', () => {
    const { s, A1 } = world()
    expect(err(s, K.setAnchorageComponents(A1, [bolt({ diameter: '' })]))).toMatch(/diameter/)
    expect(err(s, K.setAnchorageComponents(A1, [bolt({ length: null })]))).toMatch(/length/)
    expect(err(s, K.setAnchorageComponents(A1, [bolt({ topThread: 600, bottomThread: 500 })]))).toMatch(/longer than the bolt/)
    expect(err(s, K.setAnchorageComponents(A1, [bolt({ topThread: null })]))).toMatch(/top and bottom thread/)
    expect(err(s, K.setAnchorageComponents(A1, [bolt({ qty: 0 })]))).toMatch(/whole number/)
    expect(err(s, K.setAnchorageComponents(A1, [bolt({ thread: 'all-thread', topThread: null, bottomThread: null })]))).toBeUndefined()
    const embed = apply(s, K.setAnchorageComponents(A1, [{ kind: 'embed-plate', qty: 2, size: '300 x 300 x 12 mm', spec: 'CSA G40.21 350W' }]))
    expect(embed.anchorageComponents).toHaveLength(1)
    expect(err(s, K.setAnchorageComponents('nope', []))).toMatch(/not found/)
  })

  it('keeps component ids when edited, and supports several bolt configurations', () => {
    let { s, A1 } = world()
    const ids = s.anchorageComponents!.map((c) => c.id)
    s = apply(s, K.setAnchorageComponents(A1, [{ ...bolt({ qty: 6 }), id: ids[0] }, { ...template, id: ids[1] }, bolt({ diameter: 'M20', length: 600, nutsPerBolt: 1, washersPerBolt: 1 })]))
    expect(s.anchorageComponents!.slice(0, 2).map((c) => c.id)).toEqual(ids)
    expect(s.anchorageComponents).toHaveLength(3)
    expect(s.anchorageComponents![0].qty).toBe(6)
  })
})

describe('requirements calculated from the anchorage library', () => {
  it('the example: 36 anchorages of a type with 4 bolts, 2 nuts and 2 washers per bolt and a template need 144 / 288 / 288 / 36', () => {
    const { s } = world()
    const t = at(emptyTracker(), s)
    expect(find(t, 'Anchor bolt').requiredQty).toBe(144)
    expect(find(t, 'Nut').requiredQty).toBe(288)
    expect(find(t, 'Washer').requiredQty).toBe(288)
    expect(find(t, 'Plywood template').requiredQty).toBe(36)
    expect(find(t, 'Anchor bolt').specification).toBe('M25 × 900 mm, threaded both ends (top 100, bottom 80 mm)')
    expect(find(t, 'Anchor bolt').calc.expression).toBe('4 per anchorage × 36 A')
    expect(t.manual.filter((l) => l.origin === 'anchorage')).toHaveLength(4)
    expect(find(t, 'Nut').category).toBe('nut')
  })

  it('groups matching specifications across foundations and anchorage types into one requirement', () => {
    let { s, A1, B1 } = world()
    s = apply(s, K.setAnchorageComponents(B1, [bolt({ qty: 2, length: 600 }), { kind: 'embed-plate', qty: 1, size: '200 x 200 x 10 mm' }]))
    s = apply(s, K.createFoundation(s.areas[0].id, 'OP-2', '', null, 5, { groups: [{ anchorageTypeId: B1, count: 2 }] })) // 10 anchorages of type B
    const t = at(emptyTracker(), s)
    const nuts = t.manual.filter((l) => l.component === 'Nut')
    expect(nuts).toHaveLength(1) // both types use M25 nuts: one requirement
    expect(nuts[0].requiredQty).toBe(288 + 40) // 36 × 8 + 10 × 4
    expect(nuts[0].calc.expression).toBe('8 per anchorage × 36 A + 4 per anchorage × 10 B = 328')
    expect(t.manual.filter((l) => l.component === 'Anchor bolt')).toHaveLength(2) // different lengths stay separate
    expect(find(t, 'Embed plate').requiredQty).toBe(10)
    void A1
  })

  it('never duplicates: refreshing again changes nothing, and the same requirement keeps its id', () => {
    const { s } = world()
    const once = at(emptyTracker(), s)
    expect(at(once, s)).toBe(once)
    const ids = once.manual.map((l) => l.id).sort()
    const reloaded = at({ ...once, manual: once.manual.map((l) => ({ ...l })) }, s)
    expect(reloaded.manual.map((l) => l.id).sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('recalculates when foundation quantities or assignments change, and records it, without touching orders or deliveries', () => {
    let { s, f, B1 } = world()
    let t = at(emptyTracker(), s)
    const bolts = find(t, 'Anchor bolt')
    t = A.setOrdered(bolts.id, 150)(t, { construction: s, now: '2026-10-30T12:00:00Z' }).state!
    t = A.addReceipt(bolts.id, { date: '2026-10-29', qty: 100, reference: 'DN-7', note: '' }, TODAY)(t, { construction: s, actor: 'sam@example.com', now: '2026-10-30T13:00:00Z' }).state!
    t = A.editMaterial(bolts.id, { supplierId: '', poRef: 'PO-55', notes: 'rush' })(t, { construction: s, actor: 'sam@example.com' }).state!
    // foundation quantity 12 → 20: 60 anchorages, 240 bolts
    s = apply(s, K.configureFoundation(f.id, { quantity: 20 }))
    t = at(t, s)
    const after = find(t, 'Anchor bolt')
    expect(after.id).toBe(bolts.id)
    expect(after.requiredQty).toBe(240)
    expect(after).toMatchObject({ orderedQty: 150, poRef: 'PO-55', notes: 'rush' })
    expect(after.receipts).toHaveLength(1)
    expect(after.receipts[0]).toMatchObject({ qty: 100, reference: 'DN-7', by: 'sam@example.com' })
    expect(t.history.some((h) => h.materialId === bolts.id && h.action === 'quantity' && /144 → 240/.test(h.summary))).toBe(true)
    // anchorage reassigned to another type: the A requirements shrink to zero anchorages
    const g = s.anchorageGroups!.find((x) => x.foundationId === f.id)!
    s = apply(s, K.configureFoundation(f.id, { groups: [{ id: g.id, anchorageTypeId: B1, count: 3 }] }))
    t = at(t, s)
    const gone = find(t, 'Anchor bolt')
    expect(gone).toMatchObject({ requirementRemoved: true, requiredQty: 0, orderedQty: 150 }) // has orders and a delivery: kept, flagged, not deleted
    expect(gone.receipts).toHaveLength(1)
    expect(t.manual.find((l) => l.component === 'Plywood template')).toBeUndefined() // nothing was ever recorded against it: simply gone
  })

  it('a change to an order lands on a current record: operations refresh before they apply', () => {
    const { s } = world()
    const t0 = emptyTracker() // nothing materialised yet, as on a first visit
    const display = at(t0, s)
    const target = find(display, 'Nut')
    const done = A.addReceipt(target.id, { date: '2026-10-29', qty: 100, reference: '', note: '' }, TODAY)(t0, { construction: s, actor: 'a@example.com', now: '2026-10-30T10:00:00Z' })
    expect(done.error).toBeUndefined()
    const saved = done.state!.manual.find((l) => l.id === target.id)!
    expect(saved.receipts[0]).toMatchObject({ qty: 100, by: 'a@example.com', at: '2026-10-30T10:00:00Z' }) // who and when
    expect(saved.requiredQty).toBe(288)
  })

  it('calculated requirements cannot have their quantity edited, only procurement details', () => {
    const { s } = world()
    const t = at(emptyTracker(), s)
    const l = find(t, 'Nut')
    const r = A.editMaterial(l.id, { requiredQty: 5 })(t, { construction: s })
    expect(r.error).toMatch(/calculated from the Anchorage Library/)
    expect(A.editMaterial(l.id, { notes: 'x' })(t, { construction: s }).error).toBeUndefined()
  })
})

describe('quantities entered per anchorage, plinth or footing', () => {
  const total = (s: ConstructionState, basis: 'fixed' | 'per-anchorage' | 'per-plinth' | 'per-footing', each: number, fid: string | null, aid: string | null) => {
    const r = scopedCalc(s, basis, each, fid, aid)
    return 'error' in r ? r.error : r.total
  }
  it('calculates the total from the foundation’s actual counts and shows the working', () => {
    let { s, A1, B1, f } = world()
    s = apply(s, K.configureFoundation(f.id, { groups: [{ id: s.anchorageGroups![0].id, anchorageTypeId: A1, count: 3 }, { anchorageTypeId: B1, count: 1 }] })) // 12 × (3 A + 1 B)
    expect(total(s, 'fixed', 7, null, null)).toBe(7)
    expect(total(s, 'per-footing', 2, f.id, null)).toBe(24) // 12 footings
    expect(total(s, 'per-plinth', 2, f.id, null)).toBe(96) // 48 plinths
    expect(total(s, 'per-anchorage', 2, f.id, A1)).toBe(72) // 36 type A anchorages
    expect(total(s, 'per-anchorage', 2, f.id, B1)).toBe(24)
    const r = scopedCalc(s, 'per-plinth', 4, f.id, null)
    expect('calc' in r && r.calc.expression).toBe('4 per plinth × 48 plinths (OP-1) = 192')
    expect(total(s, 'per-footing', 2, null, null)).toMatch(/Choose the foundation/)
    expect(total(s, 'per-anchorage', 2, f.id, null)).toMatch(/Choose the anchorage type/)
  })

  it('saves the total with the material, keeps what was entered, and follows the foundation afterwards', () => {
    let { s, f, A1 } = world()
    let t = A.addMaterials([{ areaId: s.areas[0].id, foundationId: f.id, anchorageTypeId: A1, category: 'other', name: 'Grout', description: '', specification: '', size: '', requiredQty: 3, basis: 'per-anchorage', unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '' }])(emptyTracker(), { construction: s, actor: 'e@example.com' }).state!
    const m = t.manual.find((l) => l.component === 'Grout')!
    expect(m).toMatchObject({ requiredQty: 108, basis: 'per-anchorage', qtyEach: 3 }) // 3 × 36
    expect(m.calc.expression).toBe('3 per anchorage × 36 anchorages (A on OP-1) = 108')
    s = apply(s, K.configureFoundation(f.id, { quantity: 20 })) // 60 anchorages
    t = A.setOrdered(m.id, 100)(t, { construction: s }).state!
    expect(t.manual.find((l) => l.id === m.id)).toMatchObject({ requiredQty: 180, orderedQty: 100 })
    const bad = A.addMaterials([{ areaId: s.areas[0].id, foundationId: '', anchorageTypeId: '', category: 'other', name: 'X', description: '', specification: '', size: '', requiredQty: 3, basis: 'per-plinth', unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '' }])(emptyTracker(), { construction: s })
    expect(bad.error).toMatch(/Choose the foundation/)
  })

  it('fixed quantities are unchanged by anything', () => {
    const { s, f } = world()
    const t = A.addMaterials([{ areaId: s.areas[0].id, foundationId: f.id, anchorageTypeId: '', category: 'other', name: 'Sand', description: '', specification: '', size: '', requiredQty: 9, unit: 'ea', supplierId: '', poRef: '', expectedDate: '', claimedStatus: '', notes: '' }])(emptyTracker(), { construction: s }).state!
    const m = t.manual.find((l) => l.component === 'Sand') as TrackerLine
    expect(m.requiredQty).toBe(9)
    expect(refreshRequirements(t, apply(s, K.configureFoundation(f.id, { quantity: 99 })), { log: true }).manual.find((l) => l.component === 'Sand')!.requiredQty).toBe(9)
  })
})
