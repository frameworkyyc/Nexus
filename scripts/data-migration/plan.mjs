/**
 * Classification of EVERY table for the staging -> production data migration. A table that is not listed here stops the migration (a new migration that adds a table must be classified
 * before data can move). Actions:
 *   migrate  copied when its group is selected (--groups).
 *   review   copied only when named explicitly (--include <table>); a person decides.
 *   exclude  never copied, and the tool refuses to copy it even when asked.
 * `merge: 'skip-identical'` means rows already present in the target are left alone when identical (never overwritten) and are a conflict when different.
 * `filter` is a SQL condition applied to the SOURCE rows. Everything else follows the foreign keys: a row whose parent was not migrated is excluded with it (and reported).
 */
export const GROUPS = { construction: 'construction', materials: 'materials', fleet: 'fleet' }
/** Which module version counter a group bumps in the target (so open browsers reload). */
export const GROUP_MODULE = { construction: 'construction', materials: 'materials', fleet: 'fleet' }

const m = (group, reason, extra = {}) => ({ action: 'migrate', group, reason, ...extra })
const x = (reason) => ({ action: 'exclude', reason })
const r = (group, reason, extra = {}) => ({ action: 'review', group, reason, ...extra })
/** Fleet tables are a review decision made once for the whole group: they move only when --groups names fleet. */
const f = (reason, extra = {}) => r('fleet', reason, { viaGroup: true, ...extra })

export const TABLES = {
  // Construction: the organization, projects and everything built on them.
  companies: m('construction', 'The organization.'),
  projects: m('construction', 'Projects.'),
  areas: m('construction', 'Project areas.'),
  anchorage_types: m('construction', 'The anchorage library.'),
  anchorage_components: m('construction', 'What each anchorage type is made of.'),
  foundations: m('construction', 'Foundation designations, footing dimensions and shapes.'),
  foundation_anchorage_groups: m('construction', 'Plinth groups per foundation.'),
  foundation_bolts: m('construction', 'Footing anchor bolts.'),
  foundation_embeds: m('construction', 'Embed plates on foundations.'),
  foundation_units: m('construction', 'Individual foundations within a designation.'),
  foundation_unit_embeds: m('construction', 'Embed plates on individual foundations.'),
  library_embed_plates: m('construction', 'Embed plates saved to the project library.'),
  plinths: m('construction', 'Plinths.'),
  activities: m('construction', 'Recorded construction, survey, QA/QC and civil activities.'),
  pours: m('construction', 'Concrete pours.'),
  pour_items: m('construction', 'Pour contents.'),
  // Materials and procurement.
  manual_materials: m('materials', 'Material requirements (calculated from anchorage types and entered by hand).'),
  manual_material_receipts: m('materials', 'Receipts against those materials.'),
  purchase_orders: m('materials', 'Purchase orders.'),
  purchase_order_lines: m('materials', 'Purchase order lines.'),
  procurement_deliveries: m('materials', 'Deliveries.'),
  procurement_delivery_lines: m('materials', 'Delivery lines.'),
  material_allocations: m('materials', 'Allocations of delivered material to foundations.'),
  material_installations: m('materials', 'Recorded installations.'),
  material_import_batches: m('materials', 'Workbook imports (empty unless a workbook was imported).'),
  material_lines: m('materials', 'Imported workbook lines.'),
  material_line_ops: m('materials', 'Operational edits to imported lines.'),
  material_receipts: m('materials', 'Receipts against imported lines.'),
  workbook_summary_rows: m('materials', 'Imported workbook summary rows.'),
  anchorage_sheet_rows: m('materials', 'Imported anchorage sheet rows.'),
  import_flags: m('materials', 'Import review flags.'),
  flag_acknowledgements: m('materials', 'Acknowledged import flags.'),
  suppliers: m('materials', 'Supplier directory. Production already has the seeded entry; identical rows are left alone.', { merge: 'skip-identical' }),
  category_suppliers: m('materials', 'Preferred supplier per category. Production already has "bolts -> Nucor"; identical rows are left alone.', { merge: 'skip-identical' }),
  material_audit: r('materials', 'Append-only history of material changes (who changed what). Travels with the materials it describes, but it names staging users: decide.'),
  // Fleet is organization-level, not project data: a person decides whether it moves with the projects.
  fleet_categories: f('Fleet categories.'),
  vehicles: f('Vehicles and equipment.'),
  vehicle_assignments: f('Which project each vehicle is assigned to.'),
  odometer_readings: f('Odometer and meter readings.'),
  service_targets: f('Service targets.'),
  maintenance_records: f('Maintenance records.'),
  tire_sets: f('Tire sets.'),
  tread_measurements: f('Tread measurements.'),
  accessory_types: f('Accessory types.'),
  accessories: f('Accessories.'),
  accessory_placements: f('Accessory placements.'),
  inspections: f('Vehicle inspections. Records flagged as demonstration records (demo = 1) are never copied.', { filter: 'demo = 0' }),
  inspection_defects: f('Inspection defects.'),
  // Never copied.
  user_roles: x('Members and their roles: authentication and authorization records. Production members are invited in production.'),
  user_projects: x('Project assignments of members.'),
  role_audit: x('History of membership changes.'),
  auth_sessions: x('Sign-in sessions.'),
  change_log: x('Staging command history: request ids, staging actors and development activity. Production starts its own.'),
  module_versions: x('Concurrency counters: production keeps its own; the tool only bumps the counters of the modules it migrates.'),
  schema_info: x('Schema version: production has its own.'),
  d1_migrations: x('Migration ledger: production has its own.'),
  write_guard: x('Concurrency guard (never holds rows).'),
  sqlite_sequence: x('SQLite bookkeeping for AUTOINCREMENT tables.'),
  odometer_readings_before_0011: x('A staging-only backup table left by an old staging migration; production does not have it.'),
}

/**
 * References that are not declared as foreign keys but that the application relies on. Used to cascade exclusions and to validate. `skip` ignores empty values and
 * values with a reserved prefix.
 */
export const LOGICAL_REFS = [
  { table: 'procurement_delivery_lines', column: 'order_line_id', parent: 'purchase_order_lines' },
  { table: 'purchase_order_lines', column: 'area_id', parent: 'areas' },
  { table: 'procurement_delivery_lines', column: 'area_id', parent: 'areas' },
  { table: 'material_installations', column: 'area_id', parent: 'areas' },
  { table: 'material_allocations', column: 'foundation_id', parent: 'foundations' },
  { table: 'manual_materials', column: 'anchorage_type_id', parent: 'anchorage_types', skip: (v) => v === '' || String(v).startsWith('wb:') },
  { table: 'foundation_embeds', column: 'component_id', parent: 'anchorage_components', alsoIn: ['library_embed_plates'], skip: (v) => v === '' },
  { table: 'foundation_unit_embeds', column: 'component_id', parent: 'anchorage_components', alsoIn: ['library_embed_plates'], skip: (v) => v === '' },
  { table: 'material_audit', column: 'material_id', parent: 'manual_materials', alsoIn: ['material_lines'], skip: (v) => v === '' },
]
