import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import * as K from '@/domains/construction/actions'
import { anchorageInstances, deriveRequirements } from '@/domains/construction/tracker/requirements'
import type { ConstructionState } from '@/domains/construction/types'
import { checkIntegrity, readModule } from '../service'
import { createTestDb, d1Over } from './sqliteD1'

const MIGRATION = '0028_anchorage_mounts.sql'
const before = () => readdirSync('migrations').filter((f) => f.endsWith('.sql') && f < MIGRATION).sort()
const state = async (raw: DatabaseSync) => (await readModule(d1Over(raw), 'construction')).state as unknown as ConstructionState
const count = (raw: DatabaseSync, table: string) => (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

/** What each foundation had before: plinths of each type × quantity, straight from the old tables (archived foundations need no materials, as before). */
const oldTotals = (raw: DatabaseSync) => Object.fromEntries((raw.prepare(`SELECT p.foundation_id AS f, p.anchorage_type_id AS t, count(*) * f.quantity AS n FROM plinths p JOIN foundations f ON f.id = p.foundation_id WHERE p.anchorage_type_id IS NOT NULL AND f.archived = 0 GROUP BY p.foundation_id, p.anchorage_type_id`).all() as { f: string; t: string; n: number }[]).map((r) => [`${r.f}|${r.t}`, r.n]))
const newTotals = (s: ConstructionState) => Object.fromEntries(anchorageInstances(s).map((r) => [`${r.foundationId}|${r.typeId}`, r.instances]))

describe('migration 0028: anchorage mounts', () => {
  const legacy = () => {
    const db = createTestDb({ migrate: false })
    for (const f of before()) db.raw.exec(readFileSync(`migrations/${f}`, 'utf8'))
    db.raw.exec("INSERT INTO companies (id, name) VALUES ('c', 'Acme')")
    db.raw.exec("INSERT INTO projects (id, company_id, name, job_number, client, location, scope, status, status_note) VALUES ('p', 'c', 'P', '1', '', '', '', 'active', '')")
    db.raw.exec("INSERT INTO areas (id, project_id, name, sequence) VALUES ('a', 'p', 'Area', 1)")
    db.raw.exec("INSERT INTO anchorage_types (id, project_id, code, description, seq) VALUES ('t1', 'p', 'OP1-A11', '', 0), ('t2', 'p', 'OP1-B2', '', 1)")
    // F1 × 4: 2 plinths of t1 and 1 of t2 (the old way: one anchorage per plinth), a footing bolt and an embed plate. F2: footing only, nothing mounted. F3: plinths with no type.
    db.raw.exec("INSERT INTO foundations (id, area_id, number, quantity, seq) VALUES ('f1', 'a', 'F-1', 4, 0), ('f2', 'a', 'F-2', 1, 1), ('f3', 'a', 'F-3', 2, 2)")
    db.raw.exec("INSERT INTO foundation_anchorage_groups (id, foundation_id, anchorage_type_id, plinth_count, seq) VALUES ('g1', 'f1', 't1', 2, 0), ('g2', 'f1', 't2', 1, 1), ('g3', 'f3', NULL, 2, 2)")
    db.raw.exec("INSERT INTO plinths (id, foundation_id, idx, anchorage_type_id, notes, group_id, seq) VALUES ('p1', 'f1', 1, 't1', 'keep', 'g1', 0), ('p2', 'f1', 2, 't1', '', 'g1', 1), ('p3', 'f1', 3, 't2', '', 'g2', 2), ('p4', 'f3', 1, NULL, '', 'g3', 3), ('p5', 'f3', 2, NULL, '', 'g3', 4)")
    db.raw.exec("INSERT INTO foundation_bolts (id, foundation_id, qty, spec, diameter, length, length_unit, thread, nuts_per_bolt, washers_per_bolt, nut_size, washer_size, seq) VALUES ('b1', 'f1', 3, '', 'M16', 400, 'mm', 'all-thread', 1, 1, '', '', 0)")
    db.raw.exec("INSERT INTO foundation_embeds (id, foundation_id, component_id, qty, mode, thickness, width, length, plate_unit, seq) VALUES ('e1', 'f1', '', 2, 'per-foundation', 10, 200, 200, 'mm', 0)")
    return db
  }

  it('maps each plinth set with an anchorage type to one anchorage per plinth, and changes nothing else', async () => {
    const db = legacy()
    const old = { totals: oldTotals(db.raw), plinths: db.raw.prepare('SELECT * FROM plinths ORDER BY id').all(), groups: db.raw.prepare('SELECT * FROM foundation_anchorage_groups ORDER BY id').all(), bolts: db.raw.prepare('SELECT * FROM foundation_bolts').all() }
    db.raw.exec(readFileSync(`migrations/${MIGRATION}`, 'utf8'))
    expect(db.raw.prepare('SELECT id, foundation_id, mount_group_id, anchorage_type_id, qty FROM foundation_anchorages ORDER BY id').all()).toEqual([
      { id: 'fa-g1', foundation_id: 'f1', mount_group_id: 'g1', anchorage_type_id: 't1', qty: 1 },
      { id: 'fa-g2', foundation_id: 'f1', mount_group_id: 'g2', anchorage_type_id: 't2', qty: 1 },
    ])
    expect(db.raw.prepare('SELECT * FROM plinths ORDER BY id').all()).toEqual(old.plinths) // the physical plinths, their records and types are untouched
    expect(db.raw.prepare('SELECT * FROM foundation_anchorage_groups ORDER BY id').all()).toEqual(old.groups)
    expect(db.raw.prepare('SELECT * FROM foundation_bolts').all()).toEqual(old.bolts.map((b) => ({ ...(b as object), mount_group_id: null }))) // footing bolts stay on the footing
    expect(db.raw.prepare('SELECT mount_group_id FROM foundation_embeds').all()).toEqual([{ mount_group_id: null }])
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '28' })
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // The application reads the same anchorage totals it did before the migration.
    expect(newTotals(await state(db.raw))).toEqual(old.totals)
    expect(old.totals).toEqual({ 'f1|t1': 8, 'f1|t2': 4 })
    expect((await checkIntegrity(db.d1)).ok).toBe(true)
  })

  it('an empty database migrates too, and a mount must name a real set or footing', () => {
    const db = createTestDb({ seed: false })
    expect(count(db.raw, 'foundation_anchorages')).toBe(0)
    expect(() => db.raw.exec("INSERT INTO foundation_anchorages (id, foundation_id, mount_group_id, anchorage_type_id, qty, seq) VALUES ('x', 'nope', NULL, 'nope', 1, 0)")).toThrow()
    expect(() => db.raw.exec("INSERT INTO foundation_anchorages (id, foundation_id, mount_group_id, anchorage_type_id, qty, seq) VALUES ('x', 'nope', NULL, 'nope', 0, 0)")).toThrow()
  })
})

/**
 * The same migration on a REAL database, read from a local SQLite copy at schema 27 (never a live one):
 *   ANCHORAGE_MIGRATION_DB=/tmp/mig/staging.sqlite npx vitest run src/worker/__tests__/anchorageMigration.test.ts
 * The copy is duplicated first; the original is not changed.
 */
const REAL = process.env.ANCHORAGE_MIGRATION_DB
describe.skipIf(!REAL)('migration 0028 on a copy of real data', () => {
  it('keeps every plinth, group and anchorage total, and passes the integrity check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anch-'))
    const file = join(dir, 'copy.sqlite')
    copyFileSync(REAL as string, file)
    const raw = new DatabaseSync(file)
    const tables = ['foundations', 'plinths', 'foundation_anchorage_groups', 'foundation_bolts', 'foundation_embeds', 'activities']
    const rows = Object.fromEntries(tables.map((t) => [t, count(raw, t)]))
    const totals = oldTotals(raw)
    const typed = (raw.prepare('SELECT count(*) AS n FROM foundation_anchorage_groups WHERE anchorage_type_id IS NOT NULL').get() as { n: number }).n
    raw.exec(readFileSync(`migrations/${MIGRATION}`, 'utf8'))
    for (const t of tables) expect(count(raw, t), t).toBe(rows[t])
    expect(count(raw, 'foundation_anchorages')).toBe(typed)
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(newTotals(await state(raw))).toEqual(totals)
    expect((await checkIntegrity(d1Over(raw))).ok).toBe(true)
    // The real example, in memory on the migrated copy: OP1-21-29 is one pad with no plinths and two OP1-A11 anchorage groups of 12 bolts and a template each.
    const migrated = await state(raw)
    const a11 = migrated.anchorageTypes.find((t) => t.code === 'OP1-A11')
    const pad = migrated.foundations.find((f) => f.number === 'OP1-21-29')
    if (a11 && pad) {
      const step = (st: ConstructionState, r: K.Reducer) => { const o = r(st, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
      let st = step(migrated, K.setAnchorageComponents(a11.id, [{ kind: 'bolt', qty: 12, diameter: 'M30', length: 1200, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2 }, { kind: 'template', qty: 1 }]))
      st = step(st, K.configureFoundation(pad.id, { groups: [], anchorages: [{ anchorageTypeId: a11.id, qty: 1 }, { anchorageTypeId: a11.id, qty: 1 }] }))
      const need = (name: string) => deriveRequirements(st).filter((r) => r.designation === 'OP1-A11' && r.name === name).reduce((t, r) => t + r.required, 0)
      expect(need('Anchor bolt')).toBe(24)
      expect(need('Plywood template')).toBe(2)
      expect(st.plinths.filter((p) => p.foundationId === pad.id)).toHaveLength(0)
      expect(st.activities.filter((x) => x.foundationId === pad.id && x.scope === 'plinth')).toHaveLength(0)
      expect(st.foundations.find((f) => f.id === pad.id)!.plinthsPerFoundation).toBe(0)
      process.stderr.write(`\nOP1-21-29 on the migrated copy: ${need('Anchor bolt')} bolts, ${need('Plywood template')} templates, ${st.plinths.filter((p) => p.foundationId === pad.id).length} plinths, ${st.activities.filter((x) => x.foundationId === pad.id).length} activities (footing only)\n`)
    }
    process.stderr.write(`\nmigration 0028 on a copy: ${typed} anchorage groups created from ${rows.foundation_anchorage_groups} plinth sets; ${Object.keys(totals).length} (foundation, type) totals identical, e.g. ${Object.values(totals).reduce((a, b) => a + b, 0)} anchorages in all\n`)
  })
})
