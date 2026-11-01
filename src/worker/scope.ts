import type { D1, Row, RowSet } from './db'
import { HttpError } from './service'
import type { Actor } from './roles'

/**
 * Project-specific access. Administrators (and any actor without a project list) see everything. Everyone else sees only the projects they
 * are assigned to: rows are filtered out of what they read, and a change that would touch a row of another project is refused. Records that
 * belong to no project (the supplier directory, workbook lines, fleet vehicles) stay shared.
 */
export type ProjectScope = 'all' | string[]
export const scopeOf = (actor: Actor): ProjectScope => actor.projects ?? 'all'

interface Index {
  area: Map<string, string>; foundationArea: Map<string, string>; pour: Map<string, string>; anchorage: Map<string, string>; unitFoundation: Map<string, string>
  manual: Map<string, { area: string | null; foundation: string | null }>; orderAreas: Map<string, Set<string>>; deliveryOrder: Map<string, string>
}
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const empty = (): Index => ({ area: new Map(), foundationArea: new Map(), pour: new Map(), anchorage: new Map(), unitFoundation: new Map(), manual: new Map(), orderAreas: new Map(), deliveryOrder: new Map() })

/** Where each record sits, read from the database; `overlay` adds the rows of a change that is about to be written. */
export async function loadIndex(db: D1): Promise<Index> {
  const q = async (sql: string) => (await db.prepare(sql).all<Row>()).results
  const ix = empty()
  const [areas, foundations, pours, types, units, manual, lines, deliveries] = await Promise.all([
    q('SELECT id, project_id FROM areas'), q('SELECT id, area_id FROM foundations'), q('SELECT id, project_id FROM pours'), q('SELECT id, project_id FROM anchorage_types'),
    q('SELECT id, foundation_id FROM foundation_units'), q('SELECT id, area_id, foundation_id FROM manual_materials'), q('SELECT order_id, area_id FROM purchase_order_lines'), q('SELECT id, order_id FROM procurement_deliveries'),
  ])
  overlay(ix, { areas, foundations, pours, anchorage_types: types, foundation_units: units, manual_materials: manual, purchase_order_lines: lines, procurement_deliveries: deliveries })
  return ix
}

export function overlay(ix: Index, rows: RowSet): void {
  for (const r of rows.areas ?? []) { const p = str(r.project_id); if (p) ix.area.set(String(r.id), p) }
  for (const r of rows.foundations ?? []) { const a = str(r.area_id); if (a) ix.foundationArea.set(String(r.id), a) }
  for (const r of rows.pours ?? []) { const p = str(r.project_id); if (p) ix.pour.set(String(r.id), p) }
  for (const r of rows.anchorage_types ?? []) { const p = str(r.project_id); if (p) ix.anchorage.set(String(r.id), p) }
  for (const r of rows.foundation_units ?? []) { const f = str(r.foundation_id); if (f) ix.unitFoundation.set(String(r.id), f) }
  for (const r of rows.manual_materials ?? []) ix.manual.set(String(r.id), { area: str(r.area_id), foundation: str(r.foundation_id) })
  for (const r of rows.purchase_order_lines ?? []) { const o = str(r.order_id), a = str(r.area_id); if (o && a) ix.orderAreas.set(o, (ix.orderAreas.get(o) ?? new Set()).add(a)) }
  for (const r of rows.procurement_deliveries ?? []) { const o = str(r.order_id); if (o) ix.deliveryOrder.set(String(r.id), o) }
}

const ofFoundation = (ix: Index, id: unknown) => { const a = ix.foundationArea.get(String(id)); return a ? ix.area.get(a) ?? null : null }
const ofArea = (ix: Index, id: unknown) => (str(id) ? ix.area.get(String(id)) ?? null : null)
const list = (p: string | null): string[] => (p ? [p] : [])
const ofOrder = (ix: Index, id: unknown) => [...(ix.orderAreas.get(String(id)) ?? [])].map((a) => ix.area.get(a)).filter((p): p is string => !!p)

/** The projects a row belongs to. Empty = not project-specific. */
export function projectsOfRow(table: string, r: Row, ix: Index): string[] {
  switch (table) {
    case 'projects': return list(str(r.id))
    case 'areas': case 'anchorage_types': case 'library_embed_plates': case 'pours': case 'vehicle_assignments': return list(str(r.project_id))
    case 'foundations': return list(ofArea(ix, r.area_id))
    case 'foundation_embeds': case 'foundation_units': case 'foundation_bolts': case 'foundation_anchorage_groups': case 'plinths': case 'activities': case 'material_allocations': return list(ofFoundation(ix, r.foundation_id))
    case 'pour_items': return list(ix.pour.get(String(r.pour_id)) ?? null)
    case 'anchorage_components': return list(ix.anchorage.get(String(r.anchorage_type_id)) ?? null)
    case 'foundation_unit_embeds': return list(ofFoundation(ix, ix.unitFoundation.get(String(r.unit_id))))
    case 'manual_materials': return list(ofArea(ix, r.area_id) ?? ofFoundation(ix, r.foundation_id))
    case 'manual_material_receipts': case 'material_audit': { const m = ix.manual.get(String(r.material_id)); return m ? list(ofArea(ix, m.area) ?? ofFoundation(ix, m.foundation)) : [] }
    case 'purchase_order_lines': case 'procurement_delivery_lines': case 'material_installations': return list(ofArea(ix, r.area_id))
    case 'purchase_orders': return ofOrder(ix, r.id)
    case 'procurement_deliveries': return ofOrder(ix, r.order_id)
    default: return []
  }
}

const visible = (projects: string[], scope: string[]) => projects.length === 0 || projects.some((p) => scope.includes(p))

/** The rows a scoped actor may see. */
export function scopeRows(rows: RowSet, ix: Index, scope: ProjectScope): RowSet {
  if (scope === 'all') return rows
  return Object.fromEntries(Object.entries(rows).map(([t, rs]) => [t, rs.filter((r) => visible(projectsOfRow(t, r, ix), scope))]))
}

const sameRow = (a: Row, b: Row) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k])

/** Refuses a change that adds, edits or removes a row of a project the actor is not assigned to. */
export function assertWritable(prev: RowSet, next: RowSet, ix: Index, scope: ProjectScope, pk: (table: string) => string): void {
  if (scope === 'all') return
  for (const table of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const key = pk(table)
    const before = new Map((prev[table] ?? []).map((r) => [String(r[key]), r]))
    const after = new Map((next[table] ?? []).map((r) => [String(r[key]), r]))
    for (const [id, r] of after) { const old = before.get(id); if ((!old || !sameRow(old, r)) && !visible(projectsOfRow(table, r, ix), scope)) throw forbidden() }
    for (const [id, r] of before) if (!after.has(id) && !visible(projectsOfRow(table, r, ix), scope)) throw forbidden()
  }
}
const forbidden = () => new HttpError(403, 'You do not have access to that project.', 'project-forbidden')
