import { describe, expect, it } from 'vitest'
import { importWorkbookFile } from '@/domains/construction/tracker/import'
import { sampleWorkbook } from '@/domains/construction/__tests__/xlsxBuilder'
import { buildFleetSeed } from '@/domains/fleet/seed'
import type { FleetState } from '@/domains/fleet/types'
import type { TrackerState } from '@/domains/construction/tracker/types'
import { TABLES } from '../db'
import { backupToSql } from '../restoreSql'
import { checkIntegrity, createBackup, verifyBackup, type Backup } from '../service'
import { clock, command, session, TODAY, type Session } from './helpers'
import { createTestDb } from './sqliteD1'

async function populate(s: Session) {
  await command(s, 'fleet', 'recordOdometer', ['veh-T6010', { date: '2026-10-20', reading: 12_345, note: "driver's note" }, TODAY])
  await command(s, 'fleet', 'submitInspection', ['veh-T6010', { date: '2026-10-20', submittedBy: 'Clay', notes: 'ok', defects: ['light out'] }, TODAY])
  await command(s, 'construction', 'createFoundation', ['mole-sieve', '21-03', '', 2])
  const parsed = await importWorkbookFile(sampleWorkbook())
  await command(s, 'materials', 'importTracker', [parsed, { fileName: 't.xlsx', fileSize: 1, sha256: 'd'.repeat(64), importedAt: '' }])
  const t = (await s.call('GET', '/api/state/materials')).body.state as TrackerState
  await command(s, 'materials', 'addReceipt', [t.lines[3].id, { date: '2026-10-10', qty: 5, reference: 'PS-1', note: '' }, TODAY])
}

describe('backups', () => {
  it('exports every operational table with counts and a checksum', async () => {
    const s = session()
    await populate(s)
    const res = await s.call('GET', '/api/backup')
    expect(res.status).toBe(200)
    const b = res.body as Backup
    expect(b).toMatchObject({ format: 'nexus-backup', formatVersion: 1, schemaVersion: '23' })
    for (const t of TABLES) expect(b.tables).toHaveProperty(t.name)
    expect(b.counts.vehicles).toBe(4)
    expect(b.counts.material_lines).toBe(14)
    expect(b.counts.material_receipts).toBe(1)
    expect(b.counts.change_log).toBe(5)
    expect(await verifyBackup(b)).toBeNull()
  })

  it('detects a damaged or edited backup', async () => {
    const s = session()
    const b = JSON.parse(JSON.stringify((await s.call('GET', '/api/backup')).body)) as Backup
    b.tables.vehicles[0].unit_number = 'EDITED'
    expect(await verifyBackup(b)).toMatch(/checksum/)
    expect(await verifyBackup({ format: 'other' })).toMatch(/not a Nexus backup/)
    expect(await verifyBackup(null)).toMatch(/not a Nexus backup/)
  })

  it('a backup restores into a fresh database exactly, including history', async () => {
    const original = session()
    await populate(original)
    const backup = (await original.call('GET', '/api/backup')).body as Backup
    const sql = backupToSql(backup)
    expect(sql).not.toMatch(/DELETE FROM/) // restoring never wipes unless asked
    const fresh = createTestDb() // migrations applied, seed rows present
    fresh.raw.exec(sql)
    const restored = session(fresh)
    const again = (await restored.call('GET', '/api/backup')).body as Backup
    expect(again.tables).toEqual(backup.tables)
    expect(await verifyBackup(again)).toBeNull()
    const f = (await restored.call('GET', '/api/state/fleet')).body.state as FleetState
    expect(f.odometer.map((r) => r.reading)).toContain(12_345)
    expect(f.odometer.find((r) => r.reading === 12_345)!.note).toBe("driver's note") // quoting survives
  })

  it('a wiping restore replaces newer unwanted data when explicitly requested', async () => {
    const original = session()
    await populate(original)
    const backup = (await original.call('GET', '/api/backup')).body as Backup
    const target = session()
    await command(target, 'fleet', 'recordOdometer', ['veh-T6005', { date: '2026-10-21', reading: 99_999, note: 'wrong' }, TODAY])
    target.db.raw.exec(backupToSql(backup, { wipe: true }))
    const f = (await target.call('GET', '/api/state/fleet')).body.state as FleetState
    expect(f.odometer.some((r) => r.reading === 99_999)).toBe(false)
    expect((await target.call('GET', '/api/backup')).body.tables).toEqual(backup.tables)
  })

  it('an interrupted restore can simply be run again', async () => {
    const original = session()
    await populate(original)
    const sql = backupToSql((await original.call('GET', '/api/backup')).body as Backup)
    const fresh = createTestDb()
    fresh.raw.exec(sql)
    fresh.raw.exec(sql) // second run over the same database
    expect((await session(fresh).call('GET', '/api/backup')).body.counts.vehicles).toBe(4)
  })

  it('stamps the backup time from the clock', async () => {
    const s = session()
    expect((await createBackup(s.env.DB!, clock())).createdAt).toBe('2026-10-21T15:00:00.000Z')
  })
})

describe('integrity checks', () => {
  it('pass on healthy data and report a clear failure on contradictory data', async () => {
    const s = session()
    await populate(s)
    expect((await checkIntegrity(s.env.DB!)).ok).toBe(true)
    // Contradiction: "nothing received" confirmed on a line that has receipts.
    const line = (await s.env.DB!.prepare('SELECT line_id FROM material_receipts LIMIT 1').first<{ line_id: string }>())!.line_id
    s.db.raw.prepare('INSERT OR REPLACE INTO material_line_ops (line_id, ordered_qty, confirmed_no_receipts, notes) VALUES (?, NULL, 1, \'\')').run(line)
    const report = await checkIntegrity(s.env.DB!)
    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => !c.ok)?.name).toMatch(/Nothing received/)
  })

  it('is available to the signed-in owner', async () => {
    const s = session()
    const r = await s.call('GET', '/api/integrity')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(buildFleetSeed().vehicles).toHaveLength(4)
  })
})
