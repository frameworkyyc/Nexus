/** The slice of Cloudflare's D1 binding that Nexus uses. Declared here so the Worker has no type dependency and tests can supply SQLite. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}
export interface D1 {
  prepare(sql: string): D1Statement
  /** Executes the statements in order inside one transaction: if any fails, none are kept. Also gives reads one consistent snapshot. */
  batch(statements: D1Statement[]): Promise<{ results?: Record<string, unknown>[] }[]>
}

export type Cell = string | number | null
export type Row = Record<string, Cell>
export type RowSet = Record<string, Row[]>

export interface TableDef {
  name: string
  pk: string
  columns: string[] // includes pk
  module: 'fleet' | 'materials' | 'construction' | 'reference'
  /** Foreign keys: column → parent table (parent primary key). Used to keep migrations from inserting orphans. */
  refs?: Record<string, string>
  /** Natural keys that must stay unique (besides the primary key). */
  unique?: string[][]
  /** At most one row matching `when` per `key` (mirrors the database's partial unique indexes). */
  exclusive?: { when: (r: Row) => boolean; key: string[]; message: string }[]
}

/**
 * Operational tables, parents before children. Writes insert/update in this order and delete in reverse, so foreign keys
 * (enforced by D1) are always satisfied inside a batch.
 */
export const TABLES: TableDef[] = [
  { name: 'companies', pk: 'id', columns: ['id', 'name'], module: 'reference' },
  { name: 'projects', pk: 'id', columns: ['id', 'company_id', 'name', 'job_number', 'client', 'location', 'scope', 'status', 'status_note'], module: 'construction', refs: { company_id: 'companies' } },
  { name: 'areas', pk: 'id', columns: ['id', 'project_id', 'name', 'sequence'], module: 'construction', refs: { project_id: 'projects' }, unique: [['project_id', 'name']] },
  { name: 'foundations', pk: 'id', columns: ['id', 'area_id', 'number', 'description', 'notes', 'archived', 'seq'], module: 'construction', refs: { area_id: 'areas' }, unique: [['area_id', 'number']] },
  { name: 'plinths', pk: 'id', columns: ['id', 'foundation_id', 'idx', 'notes', 'seq'], module: 'construction', refs: { foundation_id: 'foundations' }, unique: [['foundation_id', 'idx']] },
  { name: 'activities', pk: 'id', columns: ['id', 'scope', 'activity_key', 'foundation_id', 'plinth_id', 'status', 'planned_date', 'actual_date', 'notes', 'seq'], module: 'construction', refs: { foundation_id: 'foundations', plinth_id: 'plinths' } },

  { name: 'vehicles', pk: 'id', columns: ['id', 'company_id', 'unit_number', 'year', 'make', 'model', 'vin', 'licence_plate', 'notes', 'expected_life_km', 'inspection_interval_days', 'seq'], module: 'fleet', refs: { company_id: 'companies' }, unique: [['unit_number']] },
  { name: 'vehicle_assignments', pk: 'id', columns: ['id', 'vehicle_id', 'project_id', 'start_date', 'end_date', 'seq'], module: 'fleet', refs: { vehicle_id: 'vehicles', project_id: 'projects' } },
  { name: 'odometer_readings', pk: 'id', columns: ['id', 'vehicle_id', 'reading_date', 'reading', 'unit', 'review', 'flag', 'corrects_id', 'note', 'review_note', 'reviewed_date', 'seq'], module: 'fleet', refs: { vehicle_id: 'vehicles' } },
  { name: 'service_targets', pk: 'id', columns: ['id', 'vehicle_id', 'odometer', 'set_date', 'note', 'service_type', 'warn_within_km', 'interval_km', 'seq'], module: 'fleet', refs: { vehicle_id: 'vehicles' } },
  { name: 'maintenance_records', pk: 'id', columns: ['id', 'vehicle_id', 'service_date', 'service_type', 'odometer', 'description', 'condition', 'notes', 'seq'], module: 'fleet', refs: { vehicle_id: 'vehicles' } },
  { name: 'tire_sets', pk: 'id', columns: ['id', 'vehicle_id', 'manufacturer', 'model', 'size', 'classes_json', 'studded', 'origin', 'active', 'install_date', 'install_odometer', 'removal_date', 'removal_odometer', 'condition', 'expected_life_km', 'replace_at_mm', 'notes', 'seq'], module: 'fleet', refs: { vehicle_id: 'vehicles' }, exclusive: [{ when: (r) => r.active === 1, key: ['vehicle_id'], message: 'another tire set is already active on this vehicle' }] },
  { name: 'tread_measurements', pk: 'id', columns: ['id', 'tire_set_id', 'measured_date', 'odometer', 'depth_mm', 'note', 'seq'], module: 'fleet', refs: { tire_set_id: 'tire_sets' } },
  { name: 'accessories', pk: 'id', columns: ['id', 'name', 'category', 'description', 'specification', 'cost', 'warranty', 'notes', 'seq'], module: 'fleet' },
  { name: 'accessory_placements', pk: 'id', columns: ['id', 'accessory_id', 'seq', 'vehicle_id', 'install_date', 'install_odometer', 'end_date', 'end_odometer', 'end_reason', 'to_vehicle_id', 'note'], module: 'fleet', refs: { accessory_id: 'accessories', vehicle_id: 'vehicles', to_vehicle_id: 'vehicles' }, exclusive: [{ when: (r) => r.end_reason === null, key: ['accessory_id'], message: 'the accessory is already installed on a vehicle' }] },
  { name: 'inspections', pk: 'id', columns: ['id', 'vehicle_id', 'inspection_date', 'submitted_by', 'notes', 'review', 'reviewed_by', 'reviewed_date', 'review_note', 'condition', 'demo', 'seq'], module: 'fleet', refs: { vehicle_id: 'vehicles' }, unique: [['vehicle_id', 'inspection_date']] },
  { name: 'inspection_defects', pk: 'id', columns: ['id', 'inspection_id', 'description', 'status', 'resolved_date', 'resolution_note', 'seq'], module: 'fleet', refs: { inspection_id: 'inspections' } },

  { name: 'material_import_batches', pk: 'id', columns: ['id', 'file_name', 'file_size', 'sha256', 'imported_at', 'counts_json', 'seq'], module: 'materials' },
  { name: 'suppliers', pk: 'id', columns: ['id', 'name', 'name_key', 'archived', 'created_at', 'created_by', 'seq'], module: 'materials', unique: [['name_key']] },
  { name: 'category_suppliers', pk: 'category', columns: ['category', 'supplier_id'], module: 'materials', refs: { supplier_id: 'suppliers' } },
  { name: 'material_lines', pk: 'id', columns: ['id', 'batch_id', 'source_sheet', 'source_row', 'area', 'footing_type', 'anchorage_type', 'footings', 'plinths', 'bolts', 'component', 'category', 'required_qty', 'calc_json', 'source_status', 'source_comments_json', 'source_removed', 'seq'], module: 'materials', refs: { batch_id: 'material_import_batches' } },
  { name: 'material_line_ops', pk: 'line_id', columns: ['line_id', 'ordered_qty', 'confirmed_no_receipts', 'notes', 'unit', 'supplier', 'supplier_id', 'po_ref', 'expected_date', 'archived'], module: 'materials', refs: { line_id: 'material_lines', supplier_id: 'suppliers' } },
  { name: 'material_receipts', pk: 'id', columns: ['id', 'line_id', 'receipt_date', 'qty', 'reference', 'note', 'recorded_by', 'seq'], module: 'materials', refs: { line_id: 'material_lines' } },
  { name: 'manual_materials', pk: 'id', columns: ['id', 'area', 'location', 'anchorage_ref', 'category', 'name', 'description', 'specification', 'area_id', 'foundation_id', 'anchorage_type_id', 'size', 'required_qty', 'unit', 'supplier', 'supplier_id', 'po_ref', 'expected_date', 'claimed_status', 'ordered_qty', 'confirmed_no_receipts', 'notes', 'archived', 'created_at', 'created_by', 'seq'], module: 'materials', refs: { area_id: 'areas', foundation_id: 'foundations', supplier_id: 'suppliers' } },
  { name: 'manual_material_receipts', pk: 'id', columns: ['id', 'material_id', 'receipt_date', 'qty', 'reference', 'note', 'recorded_by', 'seq'], module: 'materials', refs: { material_id: 'manual_materials' } },
  { name: 'material_audit', pk: 'id', columns: ['id', 'at', 'actor', 'action', 'material_id', 'label', 'summary', 'changes_json', 'seq'], module: 'materials' },
  { name: 'workbook_summary_rows', pk: 'id', columns: ['id', 'batch_id', 'source_sheet', 'source_row', 'area', 'item', 'total_qty', 'status', 'seq'], module: 'materials', refs: { batch_id: 'material_import_batches' } },
  { name: 'anchorage_sheet_rows', pk: 'id', columns: ['id', 'batch_id', 'source_sheet', 'source_row', 'footing_type', 'anchorage_type', 'footings', 'plinths', 'bolts', 'component', 'category', 'required_qty', 'calc_json', 'grade', 'source_status', 'seq'], module: 'materials', refs: { batch_id: 'material_import_batches' } },
  { name: 'import_flags', pk: 'id', columns: ['id', 'batch_id', 'code', 'severity', 'source_sheet', 'source_row', 'line_id', 'message', 'seq'], module: 'materials', refs: { batch_id: 'material_import_batches' } },
  { name: 'flag_acknowledgements', pk: 'flag_id', columns: ['flag_id', 'ack_date', 'note'], module: 'materials', refs: { flag_id: 'import_flags' } },
]

export const tablesOf = (module: TableDef['module']) => TABLES.filter((t) => t.module === module)

/** Rows of the given tables, in creation order, read as one consistent snapshot. */
export async function loadRows(db: D1, tables: TableDef[]): Promise<RowSet> {
  const stmts = tables.map((t) => db.prepare(`SELECT ${t.columns.join(', ')} FROM ${t.name} ORDER BY ${t.columns.includes('seq') ? 'seq, ' : t.columns.includes('sequence') ? 'sequence, ' : ''}${t.pk}`))
  const res = await db.batch(stmts)
  return Object.fromEntries(tables.map((t, i) => [t.name, (res[i]?.results ?? []) as Row[]]))
}

const CHUNK = 40
const same = (a: Row, b: Row, cols: string[]) => cols.every((c) => a[c] === b[c])

/**
 * Statements that turn the stored rows `prev` into `next`: changed and new rows are upserted, removed rows deleted. Rows travel
 * as JSON documents (`json_each`), so even a large import is a handful of statements, well inside D1's bound-parameter limit.
 */
export function writeStatements(db: D1, prev: RowSet, next: RowSet, tables: TableDef[]): D1Statement[] {
  const upserts: D1Statement[] = []
  const deletes: D1Statement[] = []
  for (const t of tables) {
    const before = new Map((prev[t.name] ?? []).map((r) => [String(r[t.pk]), r]))
    const after = new Map((next[t.name] ?? []).map((r) => [String(r[t.pk]), r]))
    const changed = [...after.values()].filter((r) => { const old = before.get(String(r[t.pk])); return !old || !same(old, r, t.columns) })
    const removed = [...before.keys()].filter((k) => !after.has(k))
    const select = t.columns.map((c) => `json_extract(j.value, '$.${c}')`).join(', ')
    const update = t.columns.filter((c) => c !== t.pk).map((c) => `${c} = excluded.${c}`).join(', ')
    const sql = `INSERT INTO ${t.name} (${t.columns.join(', ')}) SELECT ${select} FROM json_each(?) j WHERE true ON CONFLICT(${t.pk}) DO ${update ? `UPDATE SET ${update}` : 'NOTHING'}`
    for (let i = 0; i < changed.length; i += CHUNK) upserts.push(db.prepare(sql).bind(JSON.stringify(changed.slice(i, i + CHUNK))))
    for (let i = 0; i < removed.length; i += CHUNK) deletes.push(db.prepare(`DELETE FROM ${t.name} WHERE ${t.pk} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(removed.slice(i, i + CHUNK))))
  }
  // Parents first when writing; children first when deleting. `tables` is already parents-first, so deletes are reversed.
  return [...upserts, ...deletes.reverse()]
}
