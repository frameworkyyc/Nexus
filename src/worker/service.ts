import { loadRows, TABLES, writeStatements, type D1, type D1Statement, type Row, type RowSet } from './db'
import { MODULES } from './modules'
import { isRequestId, validateImportMeta, validateParsedTracker } from './validate'
import { requireCommandPermission, type Actor } from './roles'
import { MODULE_NAMES, SERVER_COMMANDS, type ModuleName } from '@/shared/registry'

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message) }
}

export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() }

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/* ── Reading ───────────────────────────────────────────────────────────── */

export interface Snapshot { rows: RowSet; version: number; // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any }

export async function readModule(db: D1, module: ModuleName): Promise<Snapshot> {
  const spec = MODULES[module]
  // Both reads are started inside async functions so that a failure while preparing either one rejects the Promise.all instead of throwing
  // after the other read has already started, which would leave that read's rejection unhandled.
  const [rows, v] = await Promise.all([
    loadRows(db, spec.tables),
    (async () => db.prepare('SELECT version FROM module_versions WHERE module = ?').bind(module).first<{ version: number }>())(),
  ])
  return { rows, version: Number(v?.version ?? 0), state: spec.fromRows(rows) }
}

export async function versions(db: D1): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT module, version FROM module_versions').all<{ module: string; version: number }>()
  return Object.fromEntries(results.map((r) => [r.module, Number(r.version)]))
}

/* ── Commands ──────────────────────────────────────────────────────────── */

export interface CommandRequest { module: unknown; name: unknown; args: unknown; requestId: unknown; clientToday: unknown }

const guardStatement = (db: D1, module: string, version: number): D1Statement =>
  db.prepare('INSERT INTO write_guard (stale) SELECT 1 WHERE (SELECT version FROM module_versions WHERE module = ?) <> ?').bind(module, version)

const logStatement = (db: D1, module: string, name: string, args: unknown, actor: string, requestId: string, at: Date, version: number): D1Statement => {
  let json = JSON.stringify(args)
  if (json.length > 100_000) json = JSON.stringify({ omitted: 'large payload', characters: json.length })
  return db.prepare('INSERT INTO change_log (request_id, module, command, args_json, actor, created_at, result_version) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(requestId, module, name, json, actor, at.toISOString(), version)
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Applies one command with the same reducer the browser uses. The change is validated against the stored records, written in
 * a single transaction together with its audit entry, and refused if another change landed first (it is then re-evaluated
 * against the newer records). A repeated request id is answered, not applied twice.
 */
export async function runCommand(db: D1, req: CommandRequest, actorIn: Actor, clock: Clock = systemClock) {
  const actor = actorIn.email
  const module = req.module as ModuleName
  if (!MODULE_NAMES.includes(module)) throw new HttpError(400, 'Unknown module.', 'bad-request')
  const name = String(req.name)
  const creator = SERVER_COMMANDS[module][name]
  if (!creator) throw new HttpError(400, `“${name}” cannot be saved to the server.`, 'unsupported')
  // Authorization comes first and uses only the role the server resolved for the verified identity.
  requireCommandPermission(actorIn, module, name)
  if (!isRequestId(req.requestId)) throw new HttpError(400, 'Missing or invalid request id.', 'bad-request')
  if (!Array.isArray(req.args)) throw new HttpError(400, 'Command arguments must be a list.', 'bad-request')
  const now = clock.now()
  const clientToday = String(req.clientToday)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clientToday) || Math.abs((Date.parse(clientToday) - Date.parse(isoDate(now))) / 86_400_000) > 1) throw new HttpError(400, 'This device’s date differs from the server’s by more than a day. Check the device clock.', 'clock')

  const answered = async () => {
    const snap = await readModule(db, module)
    return { version: snap.version, state: snap.state, replayed: true as const }
  }
  const prior = await db.prepare('SELECT id FROM change_log WHERE request_id = ?').bind(req.requestId).first()
  if (prior) return answered()

  let args = req.args as unknown[]
  let importBatchId: string | undefined
  if (module === 'materials' && name === 'importTracker') {
    const bad = validateParsedTracker(args[0]) ?? validateImportMeta(args[1])
    if (bad) throw new HttpError(400, bad, 'invalid')
    const meta = args[1] as { sha256: string | null; fileName: string; fileSize: number }
    if (meta.sha256 && !/^[0-9a-f]{64}$/.test(meta.sha256)) throw new HttpError(400, 'The file fingerprint is invalid.', 'invalid')
    if (meta.sha256) {
      const existing = await db.prepare('SELECT imported_at FROM material_import_batches WHERE sha256 = ?').bind(meta.sha256).first<{ imported_at: string }>()
      if (existing) { const snap = await readModule(db, module); return { version: snap.version, state: snap.state, noop: 'already-imported' as const, importedAt: existing.imported_at } }
    }
    args = [args[0], { ...meta, importedAt: now.toISOString() }]
    importBatchId = `batch-${(meta.sha256 ?? 'nofingerprint').slice(0, 12)}-${now.getTime().toString(36)}`
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const snap = await readModule(db, module)
    let result: { state?: unknown; error?: string }
    // Rules that look at another module's records get them from the server's own database, never from the request.
    const refs: Record<string, unknown> = {}
    if (module === 'materials') refs.construction = (await readModule(db, 'construction')).state
    if (module === 'fleet') refs.construction = (await readModule(db, 'construction')).state
    // (moving a foundation to another area checks them too; other foundation edits do not need them)
    if (module === 'construction' && (['archiveFoundation', 'archiveArea', 'archiveAnchorageType'].includes(name) || (name === 'editFoundation' && (req.args[1] as { areaId?: unknown } | undefined)?.areaId !== undefined))) refs.materials = (await readModule(db, 'materials')).state
    try { result = creator(...args)(snap.state, { actor, now: now.toISOString(), ...refs }) } catch (e) { throw new HttpError(400, `The change could not be applied: ${messageOf(e)}`, 'command-failed') }
    if (result.error !== undefined) throw new HttpError(422, result.error, 'rejected')
    const spec = MODULES[module]
    const next = spec.toRows(result.state, { prevRows: snap.rows, isImport: !!importBatchId, importBatchId })
    const statements = [
      guardStatement(db, module, snap.version),
      ...writeStatements(db, snap.rows, next, spec.tables),
      logStatement(db, module, name, args, actor, req.requestId, now, snap.version + 1),
      db.prepare('UPDATE module_versions SET version = ? WHERE module = ?').bind(snap.version + 1, module),
    ]
    try {
      await db.batch(statements)
    } catch (e) {
      const m = messageOf(e)
      if (/CHECK constraint failed.*stale|write_guard/i.test(m)) continue // someone else wrote first: re-run against the newer records
      if (/change_log\.request_id/i.test(m)) return answered() // the same request already landed
      throw new HttpError(409, `The change conflicts with saved records and was not saved (${m.replace(/^D1_ERROR: /, '').slice(0, 200)}).`, 'integrity')
    }
    const fresh = await readModule(db, module)
    return { version: fresh.version, state: fresh.state }
  }
  throw new HttpError(409, 'The records are changing too quickly to save. Try again.', 'busy')
}

/* ── Backup and integrity ──────────────────────────────────────────────── */

const BACKUP_TABLES: { name: string; columns: string[] }[] = [
  ...TABLES.map((t) => ({ name: t.name, columns: t.columns })),
  { name: 'change_log', columns: ['id', 'request_id', 'module', 'command', 'args_json', 'actor', 'created_at', 'result_version'] },
  { name: 'module_versions', columns: ['module', 'version'] },
  { name: 'schema_info', columns: ['key', 'value'] },
]

export interface Backup {
  format: 'nexus-backup'
  formatVersion: 1
  createdAt: string
  schemaVersion: string
  counts: Record<string, number>
  checksum: string
  tables: Record<string, Row[]>
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

/** A complete, self-checking export of every operational table, read as one consistent snapshot. */
export async function createBackup(db: D1, clock: Clock = systemClock): Promise<Backup> {
  const res = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT ${t.columns.join(', ')} FROM ${t.name} ORDER BY ${t.columns[0]}`)))
  const tables = Object.fromEntries(BACKUP_TABLES.map((t, i) => [t.name, (res[i]?.results ?? []) as Row[]]))
  const info = Object.fromEntries((tables.schema_info ?? []).map((r) => [String(r.key), String(r.value)]))
  return {
    format: 'nexus-backup', formatVersion: 1, createdAt: clock.now().toISOString(), schemaVersion: info.schema_version ?? 'unknown',
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), checksum: await sha256(JSON.stringify(tables)), tables,
  }
}

export async function verifyBackup(b: unknown): Promise<string | null> {
  const x = b as Partial<Backup> | null
  if (!x || x.format !== 'nexus-backup' || typeof x.tables !== 'object' || !x.tables) return 'This is not a Nexus backup file.'
  if (typeof x.checksum !== 'string' || (await sha256(JSON.stringify(x.tables))) !== x.checksum) return 'The backup’s checksum does not match: the file was changed or damaged.'
  return null
}

export interface IntegrityReport { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }

/** Cheap invariants worth checking after an import, a restore or on a schedule. */
export async function checkIntegrity(db: D1): Promise<IntegrityReport> {
  const checks: IntegrityReport['checks'] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  try {
    const { results } = await db.prepare('PRAGMA foreign_key_check').all()
    add('Foreign keys', results.length === 0, results.length ? `${results.length} rows reference missing records` : 'All references resolve')
  } catch (e) { add('Foreign keys', false, `Could not run the check: ${messageOf(e)}`) }
  const scalar = async (sql: string) => Number((await db.prepare(sql).first<{ n: number }>())?.n ?? 0)
  const dupActive = await scalar('SELECT COUNT(*) AS n FROM (SELECT vehicle_id FROM tire_sets WHERE active = 1 GROUP BY vehicle_id HAVING COUNT(*) > 1)')
  add('One active tire set per vehicle', dupActive === 0, dupActive ? `${dupActive} vehicles have several active sets` : 'OK')
  const openPlacements = await scalar('SELECT COUNT(*) AS n FROM (SELECT accessory_id FROM accessory_placements WHERE end_reason IS NULL GROUP BY accessory_id HAVING COUNT(*) > 1)')
  add('Accessory installed on one vehicle at a time', openPlacements === 0, openPlacements ? `${openPlacements} accessories are installed twice` : 'OK')
  const lines = await scalar('SELECT COUNT(*) AS n FROM material_lines')
  const recv = await scalar('SELECT COUNT(*) AS n FROM material_receipts r LEFT JOIN material_lines l ON l.id = r.line_id WHERE l.id IS NULL')
  add('Receipts belong to material lines', recv === 0, recv ? `${recv} receipts have no line` : `${lines} lines checked`)
  const both = await scalar('SELECT COUNT(*) AS n FROM material_line_ops WHERE confirmed_no_receipts = 1 AND line_id IN (SELECT line_id FROM material_receipts)')
  add('“Nothing received” not combined with receipts', both === 0, both ? `${both} lines contradict themselves` : 'OK')
  const misplaced = await scalar('SELECT COUNT(*) AS n FROM manual_materials m JOIN foundations f ON f.id = m.foundation_id WHERE m.area_id IS NULL OR f.area_id <> m.area_id')
  add('Material foundations belong to the material’s area', misplaced === 0, misplaced ? `${misplaced} materials point at a foundation in another area` : 'OK')
  const logMax = await scalar('SELECT COALESCE(MAX(result_version), 0) AS n FROM change_log')
  const verMax = await scalar('SELECT COALESCE(MAX(version), 0) AS n FROM module_versions')
  add('Change log is consistent with module versions', logMax <= verMax, `highest logged version ${logMax}, highest module version ${verMax}`)
  return { ok: checks.every((c) => c.ok), checks }
}
