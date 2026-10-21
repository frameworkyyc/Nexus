import { TABLES, writeStatements, type D1, type D1Statement, type Row, type RowSet, type TableDef } from './db'
import { MODULES } from './modules'
import { fleetToRows } from './repo/fleet'
import { materialsToRows } from './repo/materials'
import { checkIntegrity, HttpError, readModule, systemClock, type Clock, type IntegrityReport } from './service'
import { isRequestId, validateParsedTracker } from './validate'
import type { FleetState } from '@/domains/fleet/types'
import type { TrackerState } from '@/domains/construction/tracker/types'
import type { ModuleName } from '@/shared/registry'

/**
 * Moves records saved in this browser (the prototype's localStorage) onto the server. Nothing is overwritten silently:
 * every incoming row is classified as new, identical, conflicting or blocked, and only new rows are written unless the
 * caller names specific conflicts to replace. Running it again after an interruption finds the earlier rows identical.
 */
export interface MigrationBundle { format: 'nexus-browser-export'; exportedAt?: string; fleet?: FleetState; materials?: TrackerState }

export interface Conflict { table: string; id: string; differing: string[] }
export interface Blocked { table: string; id: string; reason: string }
export interface TableReport { table: string; incoming: number; imported: number; identical: number; replaced: number; conflicts: Conflict[]; blocked: Blocked[] }
export interface MigrationReport { modules: Partial<Record<ModuleName, TableReport[]>>; imported: number; identical: number; conflicts: number; blocked: number; replaced: number }

const IGNORED = new Set(['seq', 'batch_id'])
const key = (t: TableDef, r: Row) => String(r[t.pk])
const contentEqual = (t: TableDef, a: Row, b: Row) => t.columns.filter((c) => !IGNORED.has(c)).every((c) => a[c] === b[c])
const differing = (t: TableDef, a: Row, b: Row) => t.columns.filter((c) => !IGNORED.has(c) && a[c] !== b[c])
const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v)

export function validateBundle(b: unknown): string | null {
  const x = b as Partial<MigrationBundle> | null
  if (!x || x.format !== 'nexus-browser-export') return 'This is not a Nexus browser export.'
  if (!x.fleet && !x.materials) return 'The export contains no fleet or materials records.'
  if (x.fleet) {
    for (const k of ['vehicles', 'assignments', 'odometer', 'serviceTargets', 'inspections', 'maintenance', 'tireSets', 'accessories'] as const) if (!Array.isArray((x.fleet as unknown as Record<string, unknown>)[k])) return `The fleet records are incomplete (“${k}” is missing). Open Nexus once so they are upgraded, then export again.`
  }
  if (x.materials) {
    const m = x.materials as unknown as { acknowledged?: unknown; lines?: unknown }
    const bad = validateParsedTracker(m)
    if (bad) return bad
    if (typeof m.acknowledged !== 'object' || m.acknowledged === null) return 'The material records are incomplete.'
  }
  return null
}

function incomingRows(module: ModuleName, bundle: MigrationBundle, serverRows: RowSet): RowSet {
  if (module === 'fleet') return fleetToRows(bundle.fleet!)
  const state = bundle.materials!
  const sha = state.meta?.sha256 ?? null
  const id = `batch-browser-${(sha ?? 'nofingerprint').slice(0, 12)}`
  const rows = materialsToRows(state, { batches: [], currentBatchId: id, isImport: true, prevBatch: {} })
  const server = (serverRows.material_import_batches ?? []).find((b) => sha && b.sha256 === sha)
  const batchId = server ? String(server.id) : id
  if (server) rows.material_import_batches = []
  for (const t of ['material_lines', 'workbook_summary_rows', 'anchorage_sheet_rows', 'import_flags']) rows[t] = (rows[t] ?? []).map((r) => ({ ...r, batch_id: batchId }))
  return rows
}

async function externalIds(db: D1, tables: TableDef[]): Promise<Record<string, Set<string>>> {
  const inModule = new Set(tables.map((t) => t.name))
  const needed = new Map<string, string>()
  for (const t of tables) for (const parent of Object.values(t.refs ?? {})) if (!inModule.has(parent)) needed.set(parent, TABLES.find((x) => x.name === parent)!.pk)
  const out: Record<string, Set<string>> = {}
  for (const [table, pk] of needed) out[table] = new Set(((await db.prepare(`SELECT ${pk} AS id FROM ${table}`).all<{ id: string }>()).results).map((r) => String(r.id)))
  return out
}

interface ModulePlan { module: ModuleName; snapshotVersion: number; server: RowSet; merged: RowSet; reports: TableReport[]; changed: boolean }

async function plan(db: D1, module: ModuleName, bundle: MigrationBundle, overwrite: Set<string>): Promise<ModulePlan> {
  const spec = MODULES[module]
  const snap = await readModule(db, module)
  const incoming = incomingRows(module, bundle, snap.rows)
  const external = await externalIds(db, spec.tables)
  const merged: RowSet = Object.fromEntries(spec.tables.map((t) => [t.name, [...(snap.rows[t.name] ?? [])]]))
  const reports: TableReport[] = []
  const present = (name: string) => new Set((merged[name] ?? []).map((r) => String(r[TABLES.find((t) => t.name === name)!.pk])))
  for (const t of spec.tables) {
    const rep: TableReport = { table: t.name, incoming: (incoming[t.name] ?? []).length, imported: 0, identical: 0, replaced: 0, conflicts: [], blocked: [] }
    const serverMap = new Map((snap.rows[t.name] ?? []).map((r) => [key(t, r), r]))
    let nextSeq = Math.max(-1, ...(snap.rows[t.name] ?? []).map((r) => Number(r.seq ?? -1))) + 1
    for (const row of incoming[t.name] ?? []) {
      const existing = serverMap.get(key(t, row))
      if (existing) {
        if (contentEqual(t, existing, row)) { rep.identical++; continue }
        const id = `${t.name}:${key(t, row)}`
        if (overwrite.has(id)) {
          merged[t.name] = merged[t.name].map((r) => (key(t, r) === key(t, row) ? { ...row, ...(t.columns.includes('seq') ? { seq: existing.seq } : {}), ...(t.columns.includes('batch_id') ? { batch_id: existing.batch_id } : {}) } : r))
          rep.replaced++
        } else rep.conflicts.push({ table: t.name, id: key(t, row), differing: differing(t, existing, row) })
        continue
      }
      const clash = (t.unique ?? []).find((cols) => (merged[t.name] ?? []).some((r) => key(t, r) !== key(t, row) && cols.every((c) => norm(r[c]) === norm(row[c]))))
      if (clash) { rep.blocked.push({ table: t.name, id: key(t, row), reason: `another record already uses the same ${clash.join(' + ')}` }); continue }
      const dup = (t.exclusive ?? []).find((x) => x.when(row) && (merged[t.name] ?? []).some((r) => key(t, r) !== key(t, row) && x.when(r) && x.key.every((c) => r[c] === row[c])))
      if (dup) { rep.blocked.push({ table: t.name, id: key(t, row), reason: `${dup.message} (resolve the conflicting record first)` }); continue }
      const orphan = Object.entries(t.refs ?? {}).find(([col, parent]) => row[col] !== null && row[col] !== undefined && !present(parent).has(String(row[col])) && !external[parent]?.has(String(row[col])))
      if (orphan) { rep.blocked.push({ table: t.name, id: key(t, row), reason: `its ${orphan[1]} record (${String(row[orphan[0]])}) is not on the server` }); continue }
      merged[t.name].push(t.columns.includes('seq') ? { ...row, seq: nextSeq++ } : row)
      rep.imported++
    }
    reports.push(rep)
  }
  const changed = reports.some((r) => r.imported + r.replaced > 0)
  return { module, snapshotVersion: snap.version, server: snap.rows, merged, reports, changed }
}

const summarize = (plans: ModulePlan[]): MigrationReport => {
  const all = plans.flatMap((p) => p.reports)
  return {
    modules: Object.fromEntries(plans.map((p) => [p.module, p.reports.filter((r) => r.incoming > 0)])),
    imported: all.reduce((s, r) => s + r.imported, 0), identical: all.reduce((s, r) => s + r.identical, 0), replaced: all.reduce((s, r) => s + r.replaced, 0),
    conflicts: all.reduce((s, r) => s + r.conflicts.length, 0), blocked: all.reduce((s, r) => s + r.blocked.length, 0),
  }
}

const modulesOf = (b: MigrationBundle): ModuleName[] => [...(b.fleet ? (['fleet'] as const) : []), ...(b.materials ? (['materials'] as const) : [])]

/** Shows what an import would do without writing anything. */
export async function previewMigration(db: D1, bundle: MigrationBundle): Promise<MigrationReport> {
  const bad = validateBundle(bundle)
  if (bad) throw new HttpError(400, bad, 'invalid')
  return summarize(await Promise.all(modulesOf(bundle).map((m) => plan(db, m, bundle, new Set()))))
}

export interface ApplyRequest { bundle: MigrationBundle; overwrite?: string[]; confirmedReal?: boolean; requestId?: unknown }

/**
 * Writes the new rows (and any conflicts the caller chose to replace) in one transaction. Refuses unless the caller confirms
 * the browser data is real project data, so demonstration data is never imported by accident.
 */
export async function applyMigration(db: D1, req: ApplyRequest, actor: string, clock: Clock = systemClock): Promise<{ report: MigrationReport; integrity: IntegrityReport; replayed?: true }> {
  if (req.confirmedReal !== true) throw new HttpError(400, 'Confirm that this browser data is real project data before importing it.', 'unconfirmed')
  if (!isRequestId(req.requestId)) throw new HttpError(400, 'Missing or invalid request id.', 'bad-request')
  const bad = validateBundle(req.bundle)
  if (bad) throw new HttpError(400, bad, 'invalid')
  const overwrite = new Set(Array.isArray(req.overwrite) ? req.overwrite.map(String) : [])
  const mods = modulesOf(req.bundle)
  const prior = await db.prepare('SELECT 1 AS x FROM change_log WHERE request_id = ?').bind(`${req.requestId}-${mods[0]}`).first()
  const plans = await Promise.all(mods.map((m) => plan(db, m, req.bundle, overwrite)))
  const report = summarize(plans)
  if (prior) return { report, integrity: await checkIntegrity(db), replayed: true }
  const statements: D1Statement[] = []
  for (const p of plans.filter((x) => x.changed)) {
    const spec = MODULES[p.module]
    statements.push(
      db.prepare('INSERT INTO write_guard (stale) SELECT 1 WHERE (SELECT version FROM module_versions WHERE module = ?) <> ?').bind(p.module, p.snapshotVersion),
      ...writeStatements(db, p.server, p.merged, spec.tables),
      db.prepare('INSERT INTO change_log (request_id, module, command, args_json, actor, created_at, result_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(`${req.requestId}-${p.module}`, p.module, 'migrate.browser-data', JSON.stringify({ imported: summarize([p]).imported, replaced: summarize([p]).replaced, exportedAt: req.bundle.exportedAt ?? null }), actor, clock.now().toISOString(), p.snapshotVersion + 1),
      db.prepare('UPDATE module_versions SET version = ? WHERE module = ?').bind(p.snapshotVersion + 1, p.module),
    )
  }
  if (statements.length) {
    try { await db.batch(statements) } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (/stale|write_guard/i.test(m)) throw new HttpError(409, 'The server records changed while the import was being prepared. Preview again.', 'busy')
      throw new HttpError(409, `The import was not applied (${m.slice(0, 200)}). Nothing was changed; it is safe to retry.`, 'integrity')
    }
  }
  return { report, integrity: await checkIntegrity(db) }
}

