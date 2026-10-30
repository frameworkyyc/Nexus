import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { buildCatalog, displayOf } from '../tracker/catalog'
import { emptyTracker } from '../tracker/types'
import { foundationQuantity, foundationTotals, plinthsPerFoundation, totalPlinths } from '../foundationQuantity'
import { emptyConstruction } from '../empty'
import type { ConstructionState } from '../types'

const base = (): ConstructionState => {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  s = apply(s, K.createArea(s.projects[0].id, 'E-House', []))
  return s
}
function apply(s: ConstructionState, r: K.Reducer, ctx: K.Ctx = {}): ConstructionState { const o = r(s, ctx); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: ConstructionState, r: K.Reducer, ctx: K.Ctx = {}) => r(s, ctx).error
const AREA = (s: ConstructionState) => s.areas[0].id
const rec = (s: ConstructionState, name: string) => s.foundations.find((f) => f.number === name)!
const plinthsOf = (s: ConstructionState, id: string) => s.plinths.filter((p) => p.foundationId === id)

describe('foundation quantity and plinths per foundation', () => {
  it('one row stands for many foundations: 18 × 4 plinths = 72, with only 4 plinth records', () => {
    const s = apply(base(), K.createFoundation(AREA(base()), 'FND-101', 'E-House foundation', 4, 18))
    const f = rec(s, 'FND-101')
    expect(s.foundations).toHaveLength(1)
    expect(f).toMatchObject({ quantity: 18, plinthsPerFoundation: 4, description: 'E-House foundation' })
    expect(foundationQuantity(f)).toBe(18)
    expect(plinthsOf(s, f.id)).toHaveLength(4) // not 72, and not 18 foundation records
    expect(totalPlinths(f, plinthsOf(s, f.id).length)).toBe(72)
  })

  it('defaults the quantity to 1 and keeps the stable id', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-101', '', 2))
    expect(rec(s, 'FND-101').quantity).toBe(1)
    expect(rec(s, 'FND-101').id).toBe(`f-${AREA(b)}-FND-101`)
  })

  it('accepts only positive whole-number quantities', () => {
    const b = base()
    for (const bad of [0, -1, 2.5, NaN, Infinity, 1_000_001]) expect(err(b, K.createFoundation(AREA(b), 'X-1', '', 1, bad)), String(bad)).toMatch(/whole number of 1 or more/)
    expect(err(b, K.createFoundation(AREA(b), 'X-1', '', 1, '18' as unknown as number))).toMatch(/whole number of 1 or more/)
    expect(err(b, K.createFoundation(AREA(b), 'X-1', '', 1, 18))).toBeUndefined()
  })

  it('treats an unknown plinth count as unknown, not zero', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-102', '', null, 6))
    const f = rec(s, 'FND-102')
    expect(f.plinthsPerFoundation).toBeNull()
    expect(plinthsOf(s, f.id)).toHaveLength(0)
    expect(plinthsPerFoundation(f, 0)).toBeNull()
    expect(totalPlinths(f, 0)).toBeNull()
    const zero = apply(b, K.createFoundation(AREA(b), 'FND-103', '', 0, 6))
    expect(totalPlinths(rec(zero, 'FND-103'), 0)).toBe(0) // a known zero is different from unknown
    expect(err(b, K.createFoundation(AREA(b), 'X-1', '', -1))).toMatch(/Plinths per foundation/)
    expect(err(b, K.createFoundation(AREA(b), 'X-1', '', 2.5))).toMatch(/Plinths per foundation/)
    expect(err(b, K.createFoundation(AREA(b), 'X-1', '', 101))).toMatch(/Plinths per foundation/)
  })

  it('totals never include unknown plinth counts, and say how many were left out', () => {
    const b = base()
    const s = apply(b, K.addFoundations(AREA(b), [
      { number: 'FND-101', description: '', plinthCount: 4, quantity: 18 }, { number: 'FND-102', description: '', plinthCount: 4, quantity: 6 }, { number: 'FND-103', description: '', plinthCount: null, quantity: 2 },
    ]))
    expect(foundationTotals(s.foundations, s.plinths)).toEqual({ designations: 3, physical: 26, knownPlinths: 96, unknownDesignations: 1 })
  })

  it('older records without the new fields count as quantity 1 with their existing plinth records', () => {
    const b = base()
    const legacy = apply(b, K.createFoundation(AREA(b), 'OLD-1', '', 3))
    const stripped = { ...legacy, foundations: legacy.foundations.map(({ quantity: _q, plinthsPerFoundation: _p, ...f }) => { void _q; void _p; return f }) }
    const f = stripped.foundations[0]
    expect(foundationQuantity(f)).toBe(1)
    expect(plinthsPerFoundation(f, 3)).toBe(3)
    expect(totalPlinths(f, 3)).toBe(3)
  })
})

describe('bulk entry', () => {
  it('adds several names with quantities as one row each, not one per physical foundation', () => {
    const b = base()
    const s = apply(b, K.addFoundations(AREA(b), [{ number: 'FND-101', description: '', plinthCount: 4, quantity: 18 }, { number: 'FND-102', description: '', plinthCount: 4, quantity: 6 }, { number: 'FND-103', description: '', plinthCount: 4, quantity: 2 }]))
    expect(s.foundations.map((f) => [f.number, f.quantity])).toEqual([['FND-101', 18], ['FND-102', 6], ['FND-103', 2]])
    expect(s.foundations).toHaveLength(3)
  })

  it('keeps duplicate-name validation inside an area, all-or-nothing, and still allows the same name in another area', () => {
    let b = base()
    b = apply(b, K.createArea(b.projects[0].id, 'Piperack', []))
    const [a1, a2] = b.areas.map((a) => a.id)
    expect(err(b, K.addFoundations(a1, [{ number: 'FND-101', description: '', plinthCount: 1, quantity: 2 }, { number: 'fnd-101', description: '', plinthCount: 1, quantity: 3 }]))).toMatch(/Row 2: Foundation fnd-101 already exists/)
    const withOne = apply(b, K.addFoundations(a1, [{ number: 'FND-101', description: '', plinthCount: 1, quantity: 2 }]))
    expect(err(withOne, K.addFoundations(a1, [{ number: 'FND-200', description: '', plinthCount: 1, quantity: 2 }, { number: 'FND-101', description: '', plinthCount: 1, quantity: 2 }]))).toMatch(/already exists/)
    expect(withOne.foundations).toHaveLength(1) // the failed batch added nothing
    expect(err(withOne, K.addFoundations(a1, [{ number: 'FND-201', description: '', plinthCount: 1, quantity: 0 }]))).toMatch(/Quantity must be/)
    expect(apply(withOne, K.addFoundations(a2, [{ number: 'FND-101', description: '', plinthCount: 1, quantity: 5 }])).foundations).toHaveLength(2)
  })

  it('an area can be set up with quantities', () => {
    const b = base()
    const s = apply(b, K.createArea(b.projects[0].id, 'Tanks', [{ number: 'T-1', description: '', plinthCount: 2, quantity: 12 }]))
    expect(s.foundations.find((f) => f.number === 'T-1')).toMatchObject({ quantity: 12, plinthsPerFoundation: 2 })
  })
})

describe('editing', () => {
  it('edits the quantity without touching plinths, activities or ids', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-101', '', 4, 18))
    const id = rec(s, 'FND-101').id
    const t = apply(s, K.editFoundation(id, { quantity: 20 }))
    expect(rec(t, 'FND-101')).toMatchObject({ id, quantity: 20, plinthsPerFoundation: 4 })
    expect(t.plinths).toEqual(s.plinths)
    expect(t.activities).toEqual(s.activities)
    for (const bad of [0, -3, 1.5]) expect(err(s, K.editFoundation(id, { quantity: bad }))).toMatch(/whole number of 1 or more/)
  })

  it('adds plinths when the count rises; removes untouched ones; refuses to remove plinths with recorded work', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-101', '', 2, 3))
    const id = rec(s, 'FND-101').id
    const up = apply(s, K.editFoundation(id, { plinthsPerFoundation: 4 }))
    expect(plinthsOf(up, id).map((p) => p.index)).toEqual([1, 2, 3, 4])
    expect(up.activities.filter((a) => a.plinthId === `${id}-p4`).length).toBeGreaterThan(0)
    expect(up.activities.filter((a) => a.id.startsWith(`${id}:`) && a.scope === 'footing')).toHaveLength(s.activities.filter((a) => a.id.startsWith(`${id}:`) && a.scope === 'footing').length) // no duplicate footing activities
    const down = apply(up, K.editFoundation(id, { plinthsPerFoundation: 1 }))
    expect(plinthsOf(down, id)).toHaveLength(1)
    expect(down.activities.some((a) => a.plinthId === `${id}-p2`)).toBe(false)
    const worked = { ...up, activities: up.activities.map((a) => (a.plinthId === `${id}-p4` ? { ...a, status: 'complete' as const } : a)) }
    expect(err(worked, K.editFoundation(id, { plinthsPerFoundation: 2 }))).toMatch(/Work or notes have been recorded/)
    expect(err(up, K.editFoundation(id, { plinthsPerFoundation: null }))).toMatch(/cannot be set back to unknown/)
    const unknown = apply(b, K.createFoundation(AREA(b), 'FND-102', '', null))
    expect(plinthsOf(apply(unknown, K.editFoundation(rec(unknown, 'FND-102').id, { plinthsPerFoundation: 3 })), rec(unknown, 'FND-102').id)).toHaveLength(3)
  })

  it('renaming keeps the id and the quantity', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-101', '', 4, 18))
    const id = rec(s, 'FND-101').id
    const t = apply(s, K.renameFoundation(id, 'FND-101A'))
    expect(rec(t, 'FND-101A')).toMatchObject({ id, quantity: 18 })
  })
})

describe('materials stay separate from foundation quantity', () => {
  const NUCOR = { id: 'sup-nucor', name: 'Nucor' }
  const addMaterial = (c: ConstructionState, foundationId: string) => {
    const t = { ...emptyTracker(), suppliers: [NUCOR] }
    const input = { areaId: c.areas[0].id, foundationId, anchorageTypeId: '', category: 'bolt' as const, name: 'Anchor bolt', description: '', specification: '', size: '', requiredQty: 24, unit: 'ea', supplierId: NUCOR.id, poRef: '', expectedDate: '', claimedStatus: '', notes: '' }
    const r = A.addMaterials([input])(t, { construction: c })
    if (r.error !== undefined) throw new Error(r.error)
    return r.state
  }

  it('shows the foundation name, keeps the foundation reference, and a quantity change does not alter material quantities', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-101', '', 4, 18))
    const id = rec(s, 'FND-101').id
    const t = addMaterial(s, id)
    expect(displayOf(t.manual[0], buildCatalog(s, t), t.suppliers).foundation).toBe('FND-101')
    const bumped = apply(s, K.editFoundation(id, { quantity: 40 }))
    const after = buildCatalog(bumped, t)
    expect(after.foundations.find((f) => f.id === id)!.number).toBe('FND-101')
    expect(t.manual[0]).toMatchObject({ foundationId: id, requiredQty: 24 }) // untouched: a separate concept
  })

  it('archiving is still blocked while active materials use the foundation', () => {
    const b = base()
    const s = apply(b, K.createFoundation(AREA(b), 'FND-101', '', 4, 18))
    const id = rec(s, 'FND-101').id
    expect(err(s, K.archiveFoundation(id, true), { materials: addMaterial(s, id) })).toMatch(/1 active material is assigned/)
  })
})
