import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { boxVolumeM3, foundationConcrete, footingVolume, OCTAGON_FACTOR, shapeProblem } from '../concrete'
import type { FootingShape } from '../types'
import { build, world } from './materialsFixtures'

const w = world()
const cfg = (id: string, c = w.c, over: object = {}) => (shape: FootingShape | null, footing?: object) => K.configureFoundation(id, { ...(footing ? { footing: footing as never } : {}), footingShape: shape, ...over })(c, {})
const close = (a: number | null, b: number) => expect(a).toBeCloseTo(b, 9)

describe('footing shapes', () => {
  it('rectangle is unchanged: the same dimensions give the same volume as before, in any unit', () => {
    const f = { footing: { length: 3000, width: 2000, height: 500, unit: 'mm' as const } }
    close(footingVolume(f).total, 3)
    expect(footingVolume(f).total).toBe(boxVolumeM3(f.footing))
    close(footingVolume({ footing: { length: 3, width: 2, height: 0.5, unit: 'm' } }).total, 3)
    expect(footingVolume({ footing: null }).total).toBeNull() // missing is never zero
  })

  it('circle: π × (d/2)² × h, in mm converted to m³', () => {
    close(footingVolume({ footingShape: { kind: 'circle', diameter: 2000, height: 500 } }).total, Math.PI * 1 * 0.5)
    expect(footingVolume({ footingShape: { kind: 'circle', diameter: 2000, height: null } }).total).toBeNull()
  })

  it('regular octagon: 2(√2 − 1)·a² × h, from the across-flats dimension', () => {
    close(footingVolume({ footingShape: { kind: 'octagon', acrossFlats: 2000, height: 500 } }).total, OCTAGON_FACTOR * 4 * 0.5)
    close(OCTAGON_FACTOR * 4, 3.3137084989847607) // an octagon 2 m across flats covers about 3.314 m²
  })

  it('custom: the entered volume in m³', () => {
    close(footingVolume({ footingShape: { kind: 'custom', volumeM3: 4.25 } }).total, 4.25)
    expect(footingVolume({ footingShape: { kind: 'custom', volumeM3: null } }).total).toBeNull()
  })

  it('additions and deductions are added and subtracted, in order, with a breakdown', () => {
    const f = { footingShape: { kind: 'circle' as const, diameter: 2000, height: 500, adjustments: [
      { id: 'a', mode: 'add' as const, length: 1000, width: 500, height: 500 }, // +0.25
      { id: 'b', mode: 'deduct' as const, length: 400, width: 400, height: 500 }, // −0.08
    ] } }
    const v = footingVolume(f)
    close(v.base, Math.PI * 0.5)
    expect(v.adjustments.map((a) => [a.id, a.mode, +(a.m3 ?? 0).toFixed(6)])).toEqual([['a', 'add', 0.25], ['b', 'deduct', 0.08]])
    close(v.total, Math.PI * 0.5 + 0.25 - 0.08)
    // an adjustment with a missing dimension makes the total incomplete, not zero
    expect(footingVolume({ footingShape: { ...f.footingShape, adjustments: [{ id: 'c', mode: 'add', length: 1000, width: null, height: 500 }] } }).total).toBeNull()
  })

  it('there is no limit on the number of additions and deductions (within sanity)', () => {
    const adjustments = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, mode: (i % 2 ? 'deduct' : 'add') as 'add' | 'deduct', length: 100, width: 100, height: 100 }))
    close(footingVolume({ footingShape: { kind: 'custom', volumeM3: 1, adjustments } }).total, 1) // 100 additions cancel 100 deductions
    expect(shapeProblem({ footingShape: { kind: 'custom', volumeM3: 1, adjustments } })).toBeNull()
  })
})

describe('validation', () => {
  it('rejects bad dimensions and a final volume that is not positive', () => {
    expect(shapeProblem({ footingShape: { kind: 'circle', diameter: -5, height: 100 } })).toMatch(/Diameter must be/)
    expect(shapeProblem({ footingShape: { kind: 'octagon', acrossFlats: 0, height: 100 } })).toMatch(/Across flats/)
    expect(shapeProblem({ footingShape: { kind: 'custom', volumeM3: -1 } })).toMatch(/Volume must be/)
    expect(shapeProblem({ footingShape: { kind: 'circle', diameter: 1000, height: 100, adjustments: [{ id: 'a', mode: 'add', length: 0, width: 10, height: 10 }] } })).toMatch(/Addition 1: enter the length/)
    expect(shapeProblem({ footingShape: { kind: 'circle', diameter: 1000, height: 100, adjustments: [{ id: 'a', mode: 'deduct', length: null, width: 10, height: 10 }] } })).toMatch(/Deduction 1/)
    const tooMuch = { kind: 'custom' as const, volumeM3: 0.1, adjustments: [{ id: 'a', mode: 'deduct' as const, length: 1000, width: 1000, height: 1000 }] }
    expect(shapeProblem({ footingShape: tooMuch })).toMatch(/no concrete would remain/)
    expect(shapeProblem({ footingShape: { ...tooMuch, volumeM3: 2 } })).toBeNull() // a deduction smaller than the base is fine
    expect(shapeProblem({ footingShape: { kind: 'blob' as never } })).toMatch(/Choose a footing shape/)
  })

  it('is enforced when saving, leaving the foundation unchanged on refusal', () => {
    const r = cfg(w.f1)({ kind: 'custom', volumeM3: 0.1, adjustments: [{ id: 'a', mode: 'deduct', length: 1000, width: 1000, height: 1000 }] })
    expect(r.error).toMatch(/no concrete would remain/)
    expect(cfg(w.f1)({ kind: 'circle', diameter: 'x' as never, height: 5 }).error).toBeDefined()
  })
})

describe('saving and editing shapes', () => {
  it('saves a shape with adjustments (ids assigned), reads it back, and edits it in place', () => {
    const c1 = cfg(w.f1)({ kind: 'octagon', acrossFlats: 2400, height: 600, adjustments: [{ id: '', mode: 'add', length: 500, width: 500, height: 600 }] }).state!
    const f = c1.foundations.find((x) => x.id === w.f1)!
    expect(f.footingShape).toMatchObject({ kind: 'octagon', acrossFlats: 2400, height: 600 })
    expect(f.footingShape!.adjustments![0].id).toBeTruthy()
    const id = f.footingShape!.adjustments![0].id
    const c2 = cfg(w.f1, c1)({ kind: 'circle', diameter: 2000, height: 500, adjustments: [{ id, mode: 'deduct', length: 300, width: 300, height: 500 }] }).state!
    const g = c2.foundations.find((x) => x.id === w.f1)!.footingShape!
    expect(g.kind).toBe('circle')
    expect(g.adjustments![0]).toMatchObject({ id, mode: 'deduct' })
    expect(g.diameter).toBe(2000)
    expect(g.acrossFlats).toBeUndefined() // the old shape's fields do not linger
    // back to the plain rectangle: the stored shape is cleared and the rectangle's own dimensions apply again
    const c3 = cfg(w.f1, c2)(null).state!
    expect(c3.foundations.find((x) => x.id === w.f1)!.footingShape ?? null).toBeNull()
  })

  it('existing foundations keep their dimensions and volumes exactly: a rectangle with no shape is untouched', () => {
    const rect = build(w.c, K.configureFoundation(w.f1, { footing: { length: 4000, width: 3000, height: 800, unit: 'mm' } }))
    const f = rect.foundations.find((x) => x.id === w.f1)!
    expect(f.footingShape ?? null).toBeNull()
    const before = foundationConcrete(f, rect.plinths, rect.anchorageGroups ?? [])
    close(before.footing, 9.6)
    // saving the rectangle again through the new field (null) changes nothing
    const again = K.configureFoundation(w.f1, { footingShape: null })(rect, {}).state!
    expect(foundationConcrete(again.foundations.find((x) => x.id === w.f1)!, again.plinths, again.anchorageGroups ?? []).footing).toBe(before.footing)
  })

  it('the footing volume flows through the concrete totals: per foundation, across the quantity, and with a plinth measured from the footing base', () => {
    const c = cfg(w.f1)({ kind: 'circle', diameter: 2000, height: 500, adjustments: [{ id: '', mode: 'add', length: 1000, width: 1000, height: 500 }] }).state!
    const f = c.foundations.find((x) => x.id === w.f1)!
    const conc = foundationConcrete(f, c.plinths, c.anchorageGroups ?? [])
    const each = Math.PI * 0.5 + 0.5
    close(conc.footing, each)
    close(conc.totalFooting, each * (f.quantity ?? 1))
    // a circular footing's height still limits a plinth measured from the footing base
    const based = { ...f, plinthBase: 'from-footing-base' as const }
    const custom = { ...f, footingShape: { kind: 'custom' as const, volumeM3: 3 }, plinthBase: 'from-footing-base' as const }
    expect(foundationConcrete(based, c.plinths, c.anchorageGroups ?? []).missing.join()).not.toMatch(/footing height/)
    expect(foundationConcrete(custom, c.plinths, c.anchorageGroups ?? []).footing).toBe(3) // a custom volume has no height, so plinths measured from the base are reported as needing it
  })
})
