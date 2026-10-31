import { loadRows, type D1 } from './db'
import { MODULES } from './modules'
import { readOnlyDb } from './readOnlyDb'
import { redactRows, stripEmails } from './publicView'
import { versions, type Clock } from './service'
import { MODULE_NAMES, type ModuleName } from '@/shared/registry'

/**
 * The public snapshot: ONE sanitized JSON document in a private R2 bucket. The editable (staging) side builds it from the database through the public
 * policy and writes it; the public site only ever reads it. The public site therefore has no database and no way to reach staging records.
 *
 * One object, replaced in a single write, so the three modules in it always belong together and a reader never sees a half-written update.
 */
export const SNAPSHOT_KEY = 'snapshot.json'
export const SNAPSHOT_FORMAT = 1
/** Even when no change is seen, the publisher rebuilds this often, in case a record was changed outside Nexus's own commands. */
export const MAX_SNAPSHOT_AGE_MS = 30 * 60 * 1000

export interface Snapshot {
  format: number
  generatedAt: string
  schemaVersion: string
  versions: Record<string, number>
  modules: Record<ModuleName, { version: number; state: unknown }>
}

/** What the editable side may do with the bucket: write the snapshot and look at what is there. */
export interface SnapshotWriter {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }): Promise<unknown>
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>
}
/** What the public site may do with the bucket: read the snapshot. There is no put(), delete() or list() on this type. */
export interface SnapshotReader {
  get(key: string): Promise<{ text(): Promise<string> } | null>
}

/** Builds the sanitized snapshot from the database. Only SELECT statements can run (the database is wrapped), and every row passes the public policy. */
export async function buildSnapshot(rawDb: D1, clock: Clock): Promise<Snapshot> {
  const db = readOnlyDb(rawDb)
  const v = await versions(db)
  const info = await db.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").first<{ value: string }>()
  const modules = {} as Snapshot['modules']
  for (const name of MODULE_NAMES) {
    const spec = MODULES[name]
    const rows = await loadRows(db, spec.tables)
    modules[name] = { version: Number(v[name] ?? 0), state: stripEmails(spec.fromRows(redactRows(rows))) }
  }
  return { format: SNAPSHOT_FORMAT, generatedAt: clock.now().toISOString(), schemaVersion: info?.value ?? 'unknown', versions: Object.fromEntries(MODULE_NAMES.map((m) => [m, modules[m].version])), modules }
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
/** A last check before anything is published: the document must be well formed and carry no e-mail address. A failure keeps the previous snapshot. */
export function assertPublishable(snapshot: Snapshot, json: string): void {
  if (snapshot.format !== SNAPSHOT_FORMAT) throw new Error('Snapshot format is wrong.')
  for (const m of MODULE_NAMES) if (!snapshot.modules[m] || typeof snapshot.modules[m].version !== 'number') throw new Error(`Snapshot is missing module ${m}.`)
  if (EMAIL.test(json)) throw new Error('Snapshot contains an e-mail address, so it was not published.')
}

/** Builds and publishes the snapshot. Resolves to the snapshot's generation time; throws (leaving the previous snapshot in place) if it cannot. */
export async function publishSnapshot(db: D1, bucket: SnapshotWriter, clock: Clock): Promise<string> {
  const snapshot = await buildSnapshot(db, clock)
  const json = JSON.stringify(snapshot)
  assertPublishable(snapshot, json)
  await bucket.put(SNAPSHOT_KEY, json, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
    customMetadata: { generatedAt: snapshot.generatedAt, schemaVersion: snapshot.schemaVersion, versions: JSON.stringify(snapshot.versions) },
  })
  return snapshot.generatedAt
}

/** After a change in staging: publish, but never let a publishing problem touch the change itself. */
export async function publishAfterChange(env: { DB?: D1; PUBLIC_SNAPSHOT?: SnapshotWriter }, clock: Clock): Promise<void> {
  if (!env.DB || !env.PUBLIC_SNAPSHOT) return
  try { await publishSnapshot(env.DB, env.PUBLIC_SNAPSHOT, clock) } catch (e) { console.error('Public snapshot was not refreshed', e instanceof Error ? e.message : e) }
}

/**
 * The fallback for missed updates (run on a schedule by the publisher Worker): republish when the module versions in the database differ from the
 * snapshot's, when there is no snapshot, or when the snapshot is older than MAX_SNAPSHOT_AGE_MS. Costs a handful of reads when nothing changed.
 */
export async function refreshIfStale(env: { DB?: D1; PUBLIC_SNAPSHOT?: SnapshotWriter }, clock: Clock): Promise<'published' | 'current' | 'skipped'> {
  if (!env.DB || !env.PUBLIC_SNAPSHOT) return 'skipped'
  const db = readOnlyDb(env.DB)
  const current = await versions(db)
  const head = await env.PUBLIC_SNAPSHOT.head(SNAPSHOT_KEY)
  const meta = head?.customMetadata
  let same = false
  if (meta?.versions && meta.generatedAt) {
    try {
      const was = JSON.parse(meta.versions) as Record<string, number>
      const age = clock.now().getTime() - new Date(meta.generatedAt).getTime()
      same = age >= 0 && age < MAX_SNAPSHOT_AGE_MS && MODULE_NAMES.every((m) => Number(was[m] ?? -1) === Number(current[m] ?? 0))
    } catch { same = false }
  }
  if (same) return 'current'
  await publishSnapshot(env.DB, env.PUBLIC_SNAPSHOT, clock)
  return 'published'
}
