import * as K from '../actions'
import * as A from '../tracker/actions'
import { emptyConstruction } from '../empty'
import { refreshRequirements } from '../tracker/requirements'
import { procurementRows, type ProcRow } from '../tracker/procurement'
import { emptyTracker, type TrackerState } from '../tracker/types'
import type { ConstructionState } from '../types'

export const TODAY = '2026-10-30'
export const NOW = '2026-10-30T12:00:00Z'

export function build(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
export function run(t: TrackerState, c: ConstructionState, r: A.Reducer): TrackerState { const o = r(t, { construction: c, actor: 'jo@example.com', now: NOW }); if (o.error !== undefined) throw new Error(o.error); return o.state }
export const fails = (t: TrackerState, c: ConstructionState, r: A.Reducer) => r(t, { construction: c, actor: 'jo@example.com', now: NOW }).error
export const tracked = (c: ConstructionState, t: TrackerState = emptyTracker()) => refreshRequirements(t, c, { log: true, at: NOW })

/** Two areas, three foundations, two anchorage designations, and all six material categories (bolts, nuts, washers, sole plates, templates, embed plates). */
export function world() {
  let c: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  c = build(c, K.createOrganization({ name: 'Northline' }))
  c = build(c, K.createProject({ name: 'P1' }))
  const pid = c.projects[0].id
  c = build(c, K.createArea(pid, 'E-House', []))
  c = build(c, K.createArea(pid, 'Pipe Rack', []))
  c = build(c, K.addAnchorageType(pid, 'OP1-D2', 'D2'))
  c = build(c, K.addAnchorageType(pid, 'OP1-D3', 'D3'))
  const [D2, D3] = c.anchorageTypes.map((t) => t.id)
  const bolt = (d: string) => ({ kind: 'bolt' as const, qty: 4, diameter: d, length: 900, lengthUnit: 'mm' as const, thread: 'both-ends' as const, topThread: 100, bottomThread: 80, nutsPerBolt: 2, washersPerBolt: 2 })
  c = build(c, K.setAnchorageComponents(D2, [bolt('M25'), { kind: 'sole-plate', qty: 1, size: '6 x 280 x 280 mm' }, { kind: 'template', qty: 1, spec: '19 mm plywood' }]))
  c = build(c, K.setAnchorageComponents(D3, [bolt('M30'), { kind: 'embed-plate', qty: 1, size: '16 x 320 x 520 mm' }]))
  const [eh, pr] = c.areas.map((a) => a.id)
  c = build(c, K.createFoundation(eh, 'F-1', '', null, 5, { groups: [{ anchorageTypeId: D2, count: 1 }] }))
  c = build(c, K.createFoundation(eh, 'F-2', '', null, 3, { groups: [{ anchorageTypeId: D3, count: 1 }] }))
  c = build(c, K.createFoundation(pr, 'F-3', '', null, 4, { groups: [{ anchorageTypeId: D2, count: 1 }, { anchorageTypeId: D3, count: 1 }] }))
  const [f1, f2, f3] = c.foundations.map((f) => f.id)
  return { c, eh, pr, D2, D3, f1, f2, f3 }
}

export const CATEGORIES = ['bolt', 'nut', 'washer', 'sole-plate', 'template', 'embed-plate'] as const
export const liveRows = (t: TrackerState, c: ConstructionState) => procurementRows(t, c).filter((r) => r.required > 0)

/** An order for every requirement in full. */
export const orderAll = (t: TrackerState, c: ConstructionState, rows: ProcRow[], name = 'Everything') =>
  run(t, c, A.createPurchaseOrder({ name, number: '', supplier: '', date: TODAY, lines: rows.map((r) => ({ key: r.key, qty: r.required })) }, TODAY))
export const receipt = (rows: ProcRow[], f = 1) => rows.map((r) => ({ key: r.key, qty: Math.max(1, Math.floor(r.required * f)) }))

/** Allocate to every foundation exactly what it needs of a requirement (limited by what has been received). */
export function allocateFully(t: TrackerState, c: ConstructionState, row: ProcRow): TrackerState {
  const needs = new Map<string, number>()
  for (const x of row.contributions) if (x.foundationId) needs.set(x.foundationId, (needs.get(x.foundationId) ?? 0) + x.qty)
  return run(t, c, A.setAllocations(row.key, [...needs].map(([foundationId, qty]) => ({ foundationId, qty }))))
}
