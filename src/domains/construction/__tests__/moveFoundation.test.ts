import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { areaTracks } from '../constructionProgress'
import { getIndex, foundationsOf } from '../selectors'
import { procurementRows } from '../tracker/procurement'
import type { ConstructionState } from '../types'
import { build, run, tracked, TODAY, world } from './materialsFixtures'

const none = { materials: { lines: [], manual: [] } }
const move = (c: ConstructionState, id: string, areaId: string, ctx: object = none) => K.editFoundation(id, { areaId })(c, ctx as never)
const moved = (c: ConstructionState, id: string, areaId: string) => { const r = move(c, id, areaId); if (r.error !== undefined) throw new Error(r.error); return r.state! }
const w = world()

describe('moving a foundation to another area', () => {
  it('changes only its area: same record, plinths, activities, anchorage groups and settings', () => {
    let c = build(w.c, K.updateActivity(`${w.f1}:formed`, { status: 'complete' }, TODAY))
    c = build(c, K.updateActivity(`${w.f1}:preSurvey`, { status: 'complete' }, TODAY))
    const before = c.foundations.find((f) => f.id === w.f1)!
    const m = moved(c, w.f1, w.pr)
    const after = m.foundations.find((f) => f.id === w.f1)!
    expect(after).toEqual({ ...before, areaId: w.pr })
    expect(m.foundations).toHaveLength(c.foundations.length)
    expect(m.plinths).toEqual(c.plinths)
    expect(m.activities).toEqual(c.activities)
    expect(m.anchorageGroups).toEqual(c.anchorageGroups)
    expect(m.areas).toEqual(c.areas)
    expect(m.activities.find((a) => a.id === `${w.f1}:formed`)!.status).toBe('complete') // progress is kept
    expect(m.activities.find((a) => a.id === `${w.f1}:preSurvey`)!.status).toBe('complete') // survey and QA/QC records too
  })

  it('area views follow: it leaves the previous area and appears in the new one, with its progress', () => {
    const c = build(w.c, K.updateActivity(`${w.f1}:formed`, { status: 'complete' }, TODAY))
    const m = moved(c, w.f1, w.pr)
    const idx = getIndex(m)
    expect(foundationsOf(idx, w.eh).map((f) => f.number)).toEqual(['F-2'])
    expect(foundationsOf(idx, w.pr).map((f) => f.number).sort()).toEqual(['F-1', 'F-3'])
    expect(areaTracks(idx, w.eh, TODAY).tracks).toHaveLength(1)
    const t = areaTracks(idx, w.pr, TODAY).tracks.find((x) => x.foundation.id === w.f1)!
    expect(t).toMatchObject({ state: 'in-progress', done: 1 })
    expect(areaTracks(idx, w.pr, TODAY).counts['in-progress']).toBe(1)
  })

  it('material requirements are recalculated for the new area, and existing orders are kept', () => {
    let t = tracked(w.c)
    const rows = (c: ConstructionState, tr = t) => procurementRows(tr, c).filter((r) => r.category === 'bolt' && r.designation === 'OP1-D2')
    const key = rows(w.c).find((r) => r.areaId === w.eh)!
    t = run(t, w.c, A.createPurchaseOrder({ name: '', number: 'PO-1', supplier: '', date: TODAY, lines: [{ key: key.key, qty: 3 }] }, TODAY))
    const m = moved(w.c, w.f1, w.pr)
    const t2 = tracked(m, t)
    const eh = rows(m, t2).find((r) => r.areaId === w.eh), pr = rows(m, t2).find((r) => r.areaId === w.pr)!
    expect(eh?.required ?? 0).toBe(0) // F-1 no longer asks for bolts in E-House
    expect(pr.required).toBe(rows(w.c).find((r) => r.areaId === w.pr)!.required + key.required) // Pipe Rack now counts F-1's too
    expect(t2.orders).toEqual(t.orders) // the order is untouched (its E-House line stays on record as no longer required)
    expect(t2.orderLines).toEqual(t.orderLines)
  })

  it('refuses a name that already exists in the destination, an archived area, another project, and unknown areas', () => {
    const clash = build(w.c, K.createFoundation(w.pr, 'F-1', '', null, 1, { groups: [] }))
    expect(move(clash, w.f1, w.pr).error).toMatch(/Foundation F-1 already exists in Pipe Rack/)
    const arch = { ...w.c, areas: w.c.areas.map((a) => (a.id === w.pr ? { ...a, archived: true } : a)) }
    expect(move(arch, w.f1, w.pr).error).toMatch(/archived/)
    expect(move(w.c, w.f1, 'nope').error).toMatch(/area of this project/)
    const other = build(w.c, K.createProject({ name: 'P2' }))
    const p2 = other.projects[1].id
    const withArea = build(other, K.createArea(p2, 'Elsewhere', []))
    expect(move(withArea, w.f1, withArea.areas.find((a) => a.projectId === p2)!.id).error).toMatch(/area of this project/)
  })

  it('is refused while active hand-entered materials are assigned to the foundation, and when materials cannot be checked', () => {
    const lines = { materials: { lines: [], manual: [{ foundationId: w.f1, archived: false }] } }
    expect(move(w.c, w.f1, w.pr, lines).error).toMatch(/1 active material is assigned to foundation F-1 in E-House/)
    expect(move(w.c, w.f1, w.pr, {}).error).toMatch(/could not be checked/)
    expect(move(w.c, w.f1, w.pr, { materials: { lines: [], manual: [{ foundationId: w.f1, archived: true }] } }).error).toBeUndefined() // archived materials do not block
  })

  it('moving to the same area, or editing other fields, changes nothing about the area; other edits still work together', () => {
    expect(move(w.c, w.f1, w.eh).state!.foundations).toEqual(w.c.foundations)
    const r = K.editFoundation(w.f1, { areaId: w.pr, notes: 'moved for access', quantity: 6 })(w.c, none as never)
    expect(r.state!.foundations.find((f) => f.id === w.f1)).toMatchObject({ areaId: w.pr, notes: 'moved for access', quantity: 6 })
  })

  it('the server accepts it as a structure change (admins), like other foundation edits', async () => {
    const { permissionForCommand } = await import('@/shared/rbac')
    expect(permissionForCommand('construction', 'editFoundation')).toBe('structure.manage')
  })
})
