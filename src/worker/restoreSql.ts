import type { Backup } from './service'

/**
 * Turns a Nexus backup file into SQL for `wrangler d1 execute`. Standalone (no imports at runtime) so the operator script can
 * load it directly. Tables are written parents-first with INSERT OR REPLACE; with `wipe`, every table is emptied first
 * (children first). Wiping is destructive and is never the default.
 */
const ORDER = [
  'companies', 'projects', 'areas', 'foundations', 'plinths', 'activities',
  'vehicles', 'vehicle_assignments', 'odometer_readings', 'service_targets', 'maintenance_records', 'tire_sets', 'tread_measurements',
  'accessories', 'accessory_placements', 'inspections', 'inspection_defects',
  'material_import_batches', 'material_lines', 'material_line_ops', 'material_receipts', 'workbook_summary_rows', 'anchorage_sheet_rows', 'import_flags', 'flag_acknowledgements',
  'change_log', 'module_versions', 'schema_info',
]

const literal = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

export function backupToSql(backup: Backup, opts: { wipe?: boolean } = {}): string {
  const out: string[] = [
    `-- Nexus restore generated from a backup taken ${backup.createdAt} (schema ${backup.schemaVersion}).`,
    '-- Apply migrations to the target database first. Review before running: INSERT OR REPLACE overwrites rows with the same id.',
  ]
  if (opts.wipe) {
    out.push('-- WIPE requested: every table below is emptied first. This cannot be undone except from another backup or D1 Time Travel.')
    for (const t of [...ORDER].reverse()) if (t !== 'schema_info' && t !== 'module_versions') out.push(`DELETE FROM ${t};`)
  }
  for (const t of ORDER) {
    const rows = backup.tables[t] ?? []
    if (!rows.length) continue
    const cols = Object.keys(rows[0])
    for (const r of rows) out.push(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(r[c])).join(', ')});`)
  }
  return out.join('\n') + '\n'
}
