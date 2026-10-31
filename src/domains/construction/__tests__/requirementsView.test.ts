import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { mergeAcrossAreas, procurementRows } from '../tracker/procurement'
import { refreshRequirements } from '../tracker/requirements'
import { emptyTracker } from '../tracker/types'
import type { ConstructionState } from '../types'
import { groupByCategory } from '../procurement/RequirementsView'
import { readChoice } from '@/lib/usePersistentChoice'

const NOW = '2026-10-30T12:00:00Z', TODAY = '2026-10-30'
function build(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }

function world() {
  let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  c = build(c, K.createOrganization({ name: 'Northline' }))
  c = build(c, K.createProject({ name: 'P1' }))
  const pid = c.projects[0].id
  c = build(c, K.createArea(pid, 'E-House', []))
  c = build(c, K.createArea(pid, 'Pipe Rack', []))
  c = build(c, K.addAnchorageType(pid, 'OP1-D2', 'D2'))
  c = build(c, K.addAnchorageType(pid, 'OP1-D3', 'D3'))
  const [D2, D3] = c.anchorageTypes.map((t) => t.id)
  const parts = [{ kind: 'bolt' as const, qty: 4, diameter: 'M25', length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 }, { kind: 'template' as const, qty: 1, spec: '19 mm plywood' }]
  c = build(c, K.setAnchorageComponents(D2, parts))
  c = build(c, K.setAnchorageComponents(D3, parts))
  const [eh, pr] = c.areas.map((a) => a.id)
  c = build(c, K.createFoundation(eh, 'F-D2', '', null, 5, { groups: [{ anchorageTypeId: D2, count: 1 }] }))
  c = build(c, K.createFoundation(eh, 'F-D3', '', null, 10, { groups: [{ anchorageTypeId: D3, count: 1 }] }))
  c = build(c, K.createFoundation(pr, 'PR-1', '', null, 2, { groups: [{ anchorageTypeId: D2, count: 1 }] }))
  return { c, eh, pr }
}

describe('requirements grouped by category', () => {
  it('lists categories in the standard order with the number of requirements and the outstanding quantity of each', () => {
    const { c } = world()
    const t = refreshRequirements(emptyTracker(), c, { log: true, at: NOW })
    const rows = procurementRows(t, c).filter((r) => r.required > 0)
    const g = groupByCategory(rows)
    expect(g.map((x) => x.category)).toEqual(['bolt', 'nut', 'washer', 'template'])
    expect(g.find((x) => x.category === 'template')).toMatchObject({ count: 3, outstanding: 5 + 10 + 2 }) // E-House D2, E-House D3, Pipe Rack D2
    expect(g.every((x) => x.count === x.items.length)).toBe(true)
    expect(g.reduce((a, x) => a + x.count, 0)).toBe(rows.length) // every requirement appears in exactly one category
  })

  it('the area filter and the project-wide overview use the same rows; outstanding follows deliveries, and orders and records are untouched', () => {
    const { c, eh } = world()
    let t = refreshRequirements(emptyTracker(), c, { log: true, at: NOW })
    const all = procurementRows(t, c).filter((r) => r.required > 0)
    const house = all.filter((r) => r.areaId === eh)
    expect(groupByCategory(house).find((x) => x.category === 'template')).toMatchObject({ count: 2, outstanding: 15 })
    expect(groupByCategory(all).find((x) => x.category === 'template')!.count).toBe(3)
    const tpl = house.find((r) => r.category === 'template' && r.designation === 'OP1-D2')!
    const run = (r: A.Reducer) => { const o = r(t, { construction: c, actor: 'a', now: NOW }); if (o.error !== undefined) throw new Error(o.error); t = o.state }
    run(A.createPurchaseOrder({ number: '', supplier: '', date: TODAY, lines: [{ key: tpl.key, qty: 5 }] }, TODAY))
    run(A.recordDelivery({ date: TODAY, lines: [{ key: tpl.key, qty: 3 }] }, TODAY))
    const after = procurementRows(t, c).filter((r) => r.required > 0)
    expect(groupByCategory(after).find((x) => x.category === 'template')!.outstanding).toBe(17 - 3)
    expect(after.map((r) => r.key)).toEqual(all.map((r) => r.key)) // same requirements, same keys: selection by key still works
    expect(mergeAcrossAreas(after).reduce((a, m) => a + m.required, 0)).toBe(after.reduce((a, r) => a + r.required, 0))
  })
})

describe('remembered view', () => {
  const store = (v: string | null) => ({ getItem: () => v })
  it('uses the stored view when it is valid, otherwise the default', () => {
    expect(readChoice(store('blocks'), 'k', ['list', 'blocks'] as const, 'list')).toBe('blocks')
    expect(readChoice(store('nonsense'), 'k', ['list', 'blocks'] as const, 'list')).toBe('list')
    expect(readChoice(store(null), 'k', ['list', 'blocks'] as const, 'list')).toBe('list')
    expect(readChoice(undefined, 'k', ['list', 'blocks'] as const, 'blocks')).toBe('blocks') // storage unavailable
    expect(readChoice({ getItem: () => { throw new Error('blocked') } }, 'k', ['list', 'blocks'] as const, 'list')).toBe('list')
  })
})
