import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { componentProblem, type ComponentInput } from '../configActions'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../tracker/selectors'
import * as A from '../tracker/actions'
import { itemsOf, deriveRequirements } from '../tracker/requirements'
import { materialsModel } from '../tracker/model'
import { procurementRows } from '../tracker/procurement'
import type { ConstructionState } from '../types'
import { build, run, tracked, TODAY, world } from './materialsFixtures'

const top = (over: Partial<ComponentInput> = {}): ComponentInput => ({ kind: 'top-plate', qty: 2, thickness: 12, width: 300, length: 400, lengthUnit: 'mm', ...over })

describe('Top plate anchorage component', () => {
  it('needs thickness, width and length, and nothing about a centre hole', () => {
    expect(componentProblem(top(), 1)).toBeNull()
    expect(componentProblem(top({ thickness: null }), 1)).toMatch(/thickness/)
    expect(componentProblem(top({ width: 0 }), 1)).toMatch(/width/)
    expect(componentProblem(top({ length: null }), 1)).toMatch(/length/)
    expect(componentProblem(top({ lengthUnit: 'cm' as 'mm' }), 1)).toMatch(/mm or inches/)
    expect(componentProblem(top({ qty: 0 }), 1)).toMatch(/whole number of 1 to 1,000/)
    expect(componentProblem(top({ centerHole: 40 }), 1)).toBeNull() // never asked for or required; ignored if sent
  })

  it('is saved with the anchorage type, in its own unit, with no centre hole, and survives a reload of the same state', () => {
    const { c, D2 } = world()
    const c2 = build(c, K.setAnchorageComponents(D2, [...c.anchorageComponents!.filter((x) => x.anchorageTypeId === D2).map((x) => ({ ...x })), top({ lengthUnit: 'in', thickness: 0.5, width: 12, length: 16, spec: 'CSA G40.21 350W', centerHole: 40 })]))
    const saved = c2.anchorageComponents!.find((x) => x.kind === 'top-plate')!
    expect(saved).toMatchObject({ anchorageTypeId: D2, qty: 2, thickness: 0.5, width: 12, length: 16, lengthUnit: 'in', spec: 'CSA G40.21 350W', centerHole: null, size: '0.5 × 12 × 16 in' })
    // existing components of the type are untouched
    expect(c2.anchorageComponents!.filter((x) => x.anchorageTypeId === D2 && x.kind !== 'top-plate').map((x) => x.kind).sort()).toEqual(c.anchorageComponents!.filter((x) => x.anchorageTypeId === D2).map((x) => x.kind).sort())
  })

  it('rejects an incomplete top plate without changing anything', () => {
    const { c, D3 } = world()
    const r = K.setAnchorageComponents(D3, [top({ width: null })])(c, {})
    expect(r.error).toMatch(/width/)
  })

  it('becomes a Top plates material per anchorage: category, name, size and quantity', () => {
    const { c, D2 } = world()
    const comp = { ...c.anchorageComponents![0], id: 'x', anchorageTypeId: D2, kind: 'top-plate' as const, qty: 2, label: '', spec: 'G40.21', size: '', thickness: 12, width: 300, length: 400, lengthUnit: 'mm' as const, centerHole: null }
    expect(itemsOf(comp)).toEqual([{ category: 'top-plate', name: 'Top plate', spec: 'G40.21', size: '12 × 300 × 400 mm', each: 2 }])
    expect(CATEGORY_LABEL['top-plate']).toBe('Top plates')
    expect(CATEGORY_ORDER).toContain('top-plate')
    expect(CATEGORY_ORDER.indexOf('top-plate')).toBe(CATEGORY_ORDER.indexOf('sole-plate') + 1)
  })

  const withTop = () => {
    const w = world()
    const comps = w.c.anchorageComponents!.filter((x) => x.anchorageTypeId === w.D2).map((x) => ({ ...x }))
    const c: ConstructionState = build(w.c, K.setAnchorageComponents(w.D2, [...comps, top({ qty: 2 })]))
    return { ...w, c }
  }

  it('is included in the derived requirements: quantity per anchorage × anchorages on the foundations that use the type', () => {
    const { c } = withTop() // F-1: 5 footings with one D2 plinth; F-3: 4 footings with one D2 plinth
    const reqs = deriveRequirements(c).filter((r) => r.category === 'top-plate')
    expect(reqs.map((r) => r.areaName).sort()).toEqual(['E-House', 'Pipe Rack']) // one requirement per area and specification
    expect(reqs.every((r) => r.name === 'Top plate' && r.size === '12 × 300 × 400 mm')).toBe(true)
    expect(reqs.find((r) => r.areaName === 'E-House')!.required).toBe(2 * 5)
    expect(reqs.find((r) => r.areaName === 'Pipe Rack')!.required).toBe(2 * 4)
  })

  it('can be ordered, received and tracked like any other material, and appears in the unified model', () => {
    const { c } = withTop()
    let t = tracked(c)
    const rows = procurementRows(t, c).filter((r) => r.category === 'top-plate' && r.required > 0)
    expect(rows.length).toBeGreaterThan(0)
    const r = rows[0]
    expect(r).toMatchObject({ name: 'Top plate', size: '12 × 300 × 400 mm', status: 'pending', ordered: 0, received: 0 })
    t = run(t, c, A.createPurchaseOrder({ name: 'Top plates', number: 'PO-TP', supplier: 'Acme', date: TODAY, lines: [{ key: r.key, qty: r.required }] }, TODAY))
    const id = t.orders!.at(-1)!.id
    t = run(t, c, A.recordDelivery({ orderId: id, date: TODAY, lines: [{ key: r.key, qty: 1 }] }, TODAY))
    const after = procurementRows(t, c).find((x) => x.key === r.key)!
    expect(after).toMatchObject({ ordered: r.required, received: 1, status: 'partial' })
    expect(materialsModel(t, c).rows.find((x) => x.key === r.key)).toMatchObject({ ordered: r.required, received: 1 })
  })

  it('changing the top plate recalculates the requirement without touching orders or deliveries', () => {
    const { c, D2 } = withTop()
    let t = tracked(c)
    const r = procurementRows(t, c).find((x) => x.category === 'top-plate' && x.required > 0)!
    t = run(t, c, A.createPurchaseOrder({ name: 'TP', number: '', supplier: '', date: TODAY, lines: [{ key: r.key, qty: 2 }] }, TODAY))
    const comps = c.anchorageComponents!.filter((x) => x.anchorageTypeId === D2).map((x) => (x.kind === 'top-plate' ? { ...x, qty: 3 } : { ...x }))
    const c2 = build(c, K.setAnchorageComponents(D2, comps))
    const t2 = tracked(c2, t)
    expect(t2.orders).toEqual(t.orders)
    expect(t2.orderLines).toEqual(t.orderLines)
    expect(procurementRows(t2, c2).filter((x) => x.category === 'top-plate').reduce((a, x) => a + x.required, 0)).toBe(3 * (5 + 4))
  })
})
