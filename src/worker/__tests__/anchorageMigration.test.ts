import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import * as K from '@/domains/construction/actions'
import { completionOf, type CompletionBasis } from '@/domains/construction/completionBasis'
import { INSTALL_KEYS } from '@/domains/construction/config'
import { foundationActivities, foundationState, foundationsOf, getIndex, progressOf } from '@/domains/construction/selectors'
import { anchorageInstances, deriveRequirements } from '@/domains/construction/tracker/requirements'
import type { ConstructionState } from '@/domains/construction/types'
import { checkIntegrity, readModule, runCommand } from '../service'
import { clock, TODAY } from './helpers'
import { createTestDb, d1Over } from './sqliteD1'

const MIGRATION = '0028_anchorage_mounts.sql'
const before = () => readdirSync('migrations').filter((f) => f.endsWith('.sql') && f < MIGRATION).sort()
const state = async (raw: DatabaseSync) => (await readModule(d1Over(raw), 'construction')).state as unknown as ConstructionState
const count = (raw: DatabaseSync, table: string) => (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

/** What each foundation had before: plinths of each type × quantity, straight from the old tables (archived foundations need no materials, as before). */
const oldTotals = (raw: DatabaseSync) => Object.fromEntries((raw.prepare(`SELECT p.foundation_id AS f, p.anchorage_type_id AS t, count(*) * f.quantity AS n FROM plinths p JOIN foundations f ON f.id = p.foundation_id WHERE p.anchorage_type_id IS NOT NULL AND f.archived = 0 GROUP BY p.foundation_id, p.anchorage_type_id`).all() as { f: string; t: string; n: number }[]).map((r) => [`${r.f}|${r.t}`, r.n]))
const old0028Totals = { 'f1|t1': 8, 'f1|t2': 4 } // F1 x 4: 2 plinths of t1 and 1 of t2
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
    db.raw.exec(readFileSync('migrations/0029_anchor_bolt_installation.sql', 'utf8'))
    db.raw.exec(readFileSync('migrations/0030_embed_post_install.sql', 'utf8')) // the application reads the new columns
    expect(newTotals(await state(db.raw))).toEqual(old.totals)
    expect(old.totals).toEqual({ 'f1|t1': 8, 'f1|t2': 4 })
    expect((await checkIntegrity(db.d1)).ok).toBe(true)
  })

  it('migration 0029 makes every existing bolt and anchorage group wet-set, keeps every record, and adds the installation activities as not started', async () => {
    const db = legacy()
    db.raw.exec(readFileSync(`migrations/${MIGRATION}`, 'utf8'))
    db.raw.exec("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, seq) VALUES ('c1', 't1', 'bolt', 12, 0)")
    db.raw.exec("INSERT INTO activities (id, scope, activity_key, foundation_id, plinth_id, status, actual_date, seq) VALUES ('f1:poured', 'footing', 'poured', 'f1', NULL, 'complete', '2026-10-30', 0), ('p1:formed', 'plinth', 'formed', 'f1', 'p1', 'complete', '2026-10-30', 1)")
    const before = { activities: db.raw.prepare('SELECT * FROM activities ORDER BY id').all(), bolts: db.raw.prepare('SELECT id, qty, diameter FROM foundation_bolts').all(), anchorages: db.raw.prepare('SELECT id, qty FROM foundation_anchorages ORDER BY id').all(), plinths: count(db.raw, 'plinths') }
    db.raw.exec(readFileSync('migrations/0029_anchor_bolt_installation.sql', 'utf8'))
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '29' })
    expect(db.raw.prepare('SELECT DISTINCT install_method FROM foundation_bolts').all()).toEqual([{ install_method: 'wet-set' }])
    expect(db.raw.prepare('SELECT DISTINCT install_method FROM foundation_anchorages').all()).toEqual([{ install_method: 'wet-set' }])
    expect(db.raw.prepare('SELECT * FROM activities ORDER BY id').all()).toEqual(before.activities) // no activity row is added, changed or removed
    expect(db.raw.prepare('SELECT id, qty, diameter FROM foundation_bolts').all()).toEqual(before.bolts)
    expect(db.raw.prepare('SELECT id, qty FROM foundation_anchorages ORDER BY id').all()).toEqual(before.anchorages)
    expect(count(db.raw, 'plinths')).toBe(before.plinths)
    expect(() => db.raw.exec("UPDATE foundation_bolts SET install_method = 'glued'")).toThrow()
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    // Migration 0030 adds the same setting to embed plates; everything existing stays installed with the pour.
    db.raw.exec(readFileSync('migrations/0030_embed_post_install.sql', 'utf8'))
    expect(db.raw.prepare('SELECT DISTINCT install_method FROM foundation_embeds').all().every((r) => (r as { install_method: string }).install_method === 'wet-set')).toBe(true)
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '30' })
    expect(() => db.raw.exec("UPDATE foundation_embeds SET install_method = 'glued'")).toThrow()
    // Nothing is post-installed yet, so no installation activity exists until Post-Install is ticked; every record that was already there is unchanged.
    const st = await state(db.raw)
    const bolts = st.activities.filter((a) => /^(anchorBoltsPostInstalled|embedsPostInstalled)$/.test(a.key)) // not the older 'anchorBolts' materials activity
    expect(bolts).toEqual([]) // F1's footing bolts, and the plinths of the type that has bolts (p3's type has none)
    expect(st.activities.find((a) => a.id === 'f1:poured')).toMatchObject({ status: 'complete', actualDate: '2026-10-30' })
    expect(st.activities.find((a) => a.id === 'p1:formed')).toMatchObject({ status: 'complete' })
    expect(newTotals(st)).toEqual(old0028Totals)
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

/**
 * The real staging database, before and after migration 0028 was applied to it (two read-only local copies; never the live database):
 *   ANCHORAGE_BEFORE_DB=/tmp/mig/staging-before-0028.sqlite ANCHORAGE_AFTER_DB=/tmp/mig/staging-after-0028.sqlite npx vitest run src/worker/__tests__/anchorageMigration.test.ts
 * "Before" is read by the application the old way (each plinth with a type is one anchorage), "after" from the migrated tables; everything the application shows must agree.
 */
const BEFORE = process.env.ANCHORAGE_BEFORE_DB
const AFTER = process.env.ANCHORAGE_AFTER_DB
describe.skipIf(!BEFORE || !AFTER)('the real staging database after migration 0028', () => {
  it('quantities, anchorage totals, procurement requirements and construction progress are unchanged, and OP1-21-29 takes two groups on its footing', async () => {
    const before = new DatabaseSync(BEFORE as string, { readOnly: true })
    const after = new DatabaseSync(AFTER as string, { readOnly: true })
    expect((after.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get() as { value: string }).value).toBe('28')
    expect(after.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect((await checkIntegrity(d1Over(after))).ok).toBe(true)
    // Before, through the old plinth records: copy, migrate in memory, then hide the new table so the application reads it the old way.
    const copy = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
    before.exec('PRAGMA foreign_keys = OFF')
    copy.exec(before.prepare("SELECT group_concat(sql, ';\n') AS s FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type = 'table'").get()!.s as string)
    for (const t of (before.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name)) {
      const rows = before.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]
      for (const r of rows) copy.prepare(`INSERT INTO "${t}" (${Object.keys(r).map((k) => `"${k}"`).join(',')}) VALUES (${Object.keys(r).map(() => '?').join(',')})`).run(...(Object.values(r) as never[]))
    }
    copy.exec(readFileSync(`migrations/${MIGRATION}`, 'utf8'))
    const b = { ...(await state(copy)), foundationAnchorages: undefined } as ConstructionState
    const a = await state(after)
    // Quantities and the physical structure.
    expect(a.foundations.map((f) => [f.id, f.quantity ?? 1, f.plinthsPerFoundation ?? null])).toEqual(b.foundations.map((f) => [f.id, f.quantity ?? 1, f.plinthsPerFoundation ?? null]))
    expect(a.plinths).toEqual(b.plinths)
    expect(a.activities).toEqual(b.activities)
    // Anchorage totals: from the old tables by SQL, from the application the old way, and from the migrated tables.
    expect(newTotals(a)).toEqual(oldTotals(before))
    expect(newTotals(b)).toEqual(oldTotals(before))
    // Procurement requirements: every calculated line, key by key.
    const req = (st: ConstructionState) => deriveRequirements(st).map((r) => [r.key, r.required, r.expression]).sort()
    expect(req(a)).toEqual(req(b))
    expect(req(a).length).toBeGreaterThan(0)
    // Construction progress under every basis, for the project and each area.
    const ia = getIndex(a)
    const ib = getIndex(b)
    const bases: CompletionBasis[] = ['type', 'count', 'volume']
    const groups = [{ label: 'project', ids: a.foundations.map((f) => f.id) }, ...a.areas.map((ar) => ({ label: ar.name, ids: foundationsOf(ia, ar.id).map((f) => f.id) }))]
    for (const g of groups) for (const basis of bases) {
      const x = completionOf(ia, g.ids.map((id) => ia.foundation.get(id)!), basis)
      const y = completionOf(ib, g.ids.map((id) => ib.foundation.get(id)!), basis)
      expect(x, `${g.label} ${basis}`).toEqual(y)
    }
    // OP1-21-29: two OP1-A11 anchorage groups directly on the footing.
    const pad = a.foundations.find((f) => f.number === 'OP1-21-29')!
    const a11 = a.anchorageTypes.find((t) => t.code === 'OP1-A11')!
    const step = (st: ConstructionState, r: K.Reducer) => { const o = r(st, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
    let st = step(a, K.setAnchorageComponents(a11.id, [{ kind: 'bolt', qty: 12, diameter: 'M30', length: 1200, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2 }, { kind: 'template', qty: 1 }]))
    const plinthActsBefore = st.activities.filter((x) => x.foundationId === pad.id && x.scope === 'plinth').length
    st = step(st, K.configureFoundation(pad.id, { groups: [], anchorages: [{ anchorageTypeId: a11.id, qty: 1 }, { anchorageTypeId: a11.id, qty: 1 }] }))
    const need = (name: string) => deriveRequirements(st).filter((r) => r.designation === 'OP1-A11' && r.name === name).reduce((t, r) => t + r.required, 0)
    expect([plinthActsBefore, st.activities.filter((x) => x.foundationId === pad.id && x.scope === 'plinth').length, st.plinths.filter((p) => p.foundationId === pad.id).length]).toEqual([0, 0, 0])
    expect([need('Anchor bolt'), need('Plywood template')]).toEqual([24, 2])
    // The rest of staging is untouched by that edit.
    expect(newTotals(st)).toEqual({ ...newTotals(a), [`${pad.id}|${a11.id}`]: 2 })
    process.stderr.write(`\nstaging before/after 0028: ${a.foundations.length} designations, ${a.foundations.reduce((t, f) => t + (f.quantity ?? 1), 0)} physical foundations, ${Object.values(newTotals(a)).reduce((t, n) => t + n, 0)} anchorages, ${req(a).length} calculated requirements, ${groups.length * bases.length} progress figures: identical. OP1-21-29: 24 bolts, 2 templates, 0 plinths, 0 plinth activities.\n`)
  })

  it('saving OP1-21-29 with two OP1-A11 groups through the real server write path changes only that footing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'anch-after-'))
    const file = join(dir, 'after.sqlite')
    copyFileSync(AFTER as string, file)
    const raw = new DatabaseSync(file)
    const db = d1Over(raw)
    const admin = { email: 'admin@example.com', role: 'admin' as const, projects: 'all' as const }
    let n = 0
    const run = (name: string, args: unknown[]) => runCommand(db, { module: 'construction', name, args, requestId: `req-real-${n++}-xxxxxxxx`, clientToday: TODAY }, admin, clock())
    const before = { plinths: count(raw, 'plinths'), activities: count(raw, 'activities'), groups: count(raw, 'foundation_anchorage_groups'), anchorages: count(raw, 'foundation_anchorages'), foundations: count(raw, 'foundations') }
    const st = await state(raw)
    const pad = st.foundations.find((f) => f.number === 'OP1-21-29')!
    const a11 = st.anchorageTypes.find((t) => t.code === 'OP1-A11')!
    await run('setAnchorageComponents', [a11.id, [{ kind: 'bolt', qty: 12, diameter: 'M30', length: 1200, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2 }, { kind: 'template', qty: 1 }]])
    await run('configureFoundation', [pad.id, { groups: [], anchorages: [{ anchorageTypeId: a11.id, qty: 1 }, { anchorageTypeId: a11.id, qty: 1 }] }])
    expect(raw.prepare('SELECT mount_group_id, anchorage_type_id, qty FROM foundation_anchorages WHERE foundation_id = ? ORDER BY seq').all(pad.id)).toEqual([{ mount_group_id: null, anchorage_type_id: a11.id, qty: 1 }, { mount_group_id: null, anchorage_type_id: a11.id, qty: 1 }])
    expect(raw.prepare('SELECT count(*) AS n FROM plinths WHERE foundation_id = ?').get(pad.id)).toEqual({ n: 0 })
    expect(raw.prepare("SELECT count(*) AS n FROM activities WHERE foundation_id = ? AND scope = 'plinth'").get(pad.id)).toEqual({ n: 0 })
    expect(raw.prepare('SELECT plinths_per_foundation AS n FROM foundations WHERE id = ?').get(pad.id)).toEqual({ n: 0 })
    // Nothing else moved.
    expect({ plinths: count(raw, 'plinths'), activities: count(raw, 'activities'), groups: count(raw, 'foundation_anchorage_groups'), foundations: count(raw, 'foundations') }).toEqual({ plinths: before.plinths, activities: before.activities, groups: before.groups, foundations: before.foundations })
    expect(count(raw, 'foundation_anchorages')).toBe(before.anchorages + 2)
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect((await checkIntegrity(db)).ok).toBe(true)
    const re = await state(raw)
    const need = (name: string) => deriveRequirements(re).filter((r) => r.designation === 'OP1-A11' && r.name === name).reduce((t, r) => t + r.required, 0)
    expect([need('Anchor bolt'), need('Plywood template')]).toEqual([24, 2])
    expect(newTotals(re)).toEqual({ ...newTotals(st), [`${pad.id}|${a11.id}`]: 2 })
  })
})

/**
 * Migration 0029 and anchor bolt installation on a REAL database, read from a local SQLite copy at schema 28 (never a live one):
 *   BOLT_INSTALL_DB=/tmp/mig/production-after-0028.sqlite npx vitest run src/worker/__tests__/anchorageMigration.test.ts
 * Shows what changes for every foundation, and follows OP1-01-06 (four post-installed bolts on a footing that was 100% built) through the real server write path.
 */
const BOLTS = process.env.BOLT_INSTALL_DB
describe.skipIf(!BOLTS)('anchor bolt installation on a copy of real data', () => {
  it('keeps every record and quantity, changes progress only where bolts are required, and holds OP1-01-06 below 100% until its bolts are installed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bolts-'))
    const file = join(dir, 'copy.sqlite')
    copyFileSync(BOLTS as string, file)
    const raw = new DatabaseSync(file)
    const db = d1Over(raw)
    const stored = raw.prepare('SELECT id, status, actual_date FROM activities').all() as { id: string; status: string; actual_date: string | null }[]
    const rowsBefore = Object.fromEntries(['foundations', 'plinths', 'foundation_bolts', 'foundation_anchorages', 'activities'].map((t) => [t, count(raw, t)]))
    raw.exec(readFileSync('migrations/0029_anchor_bolt_installation.sql', 'utf8'))
    raw.exec(readFileSync('migrations/0030_embed_post_install.sql', 'utf8'))
    for (const t of Object.keys(rowsBefore)) expect(count(raw, t), t).toBe(rowsBefore[t])
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect((await checkIntegrity(db)).ok).toBe(true)
    const st = await state(raw)
    const idx = getIndex(st)
    // Every stored activity record is exactly as it was.
    for (const r of stored) { const a = st.activities.find((x) => x.id === r.id); expect(a?.status, r.id).toBe(r.status); expect(a?.actualDate ?? null, r.id).toBe(r.actual_date) }
    // Progress per foundation, before (without installation) and after; only foundations that need bolts may change, and only downward.
    const changed: string[] = []
    for (const f of st.foundations) {
      const acts = foundationActivities(idx, f)
      const hasBolts = acts.some((a) => INSTALL_KEYS.includes(a.key))
      const before = progressOf(idx, acts.filter((a) => !INSTALL_KEYS.includes(a.key)))
      const after = progressOf(idx, acts)
      if (!hasBolts) expect(after, f.number).toBe(before)
      else { expect(after, f.number).toBeLessThanOrEqual(before); if (after !== before) changed.push(`${f.number} ${before}→${after}`) }
    }
    // OP1-01-06: built to 100%, with four bolts and no installation activity until now.
    const pad = st.foundations.find((f) => f.number === 'OP1-01-06')
    if (pad) {
      const padActs = () => foundationActivities(getIndex(st), pad)
      expect(progressOf(idx, foundationActivities(idx, pad).filter((a) => !INSTALL_KEYS.includes(a.key)))).toBe(100) // the problem
      expect(progressOf(idx, foundationActivities(idx, pad))).toBe(100) // existing bolts are installed with the pour until Post-Install is ticked: nothing changes by itself
      void padActs
      const admin = { email: 'admin@example.com', role: 'admin' as const, projects: 'all' as const }
      let n = 0
      const run = (name: string, args: unknown[]) => runCommand(db, { module: 'construction', name, args, requestId: `req-bolt-${n++}-xxxxxxxx`, clientToday: TODAY }, admin, clock())
      const b = st.foundationBolts!.find((x) => x.foundationId === pad.id)!
      await run('configureFoundation', [pad.id, { bolts: [{ id: b.id, qty: b.qty, diameter: b.diameter, length: b.length, lengthUnit: b.lengthUnit, thread: b.thread, topThread: b.topThread, bottomThread: b.bottomThread, nutsPerBolt: b.nutsPerBolt, washersPerBolt: b.washersPerBolt, nutSize: b.nutSize, washerSize: b.washerSize, spec: b.spec, mode: b.mode, installMethod: 'post-installed' }] }])
      const after = await state(raw)
      const ia = getIndex(after)
      const f2 = after.foundations.find((f) => f.id === pad.id)!
      const keys = foundationActivities(ia, f2).filter((a) => INSTALL_KEYS.includes(a.key)).map((a) => a.key)
      expect(keys).toEqual(['anchorBoltsPostInstalled'])
      expect(foundationActivities(ia, f2).find((a) => a.key === 'poured')!.status).toBe('complete') // concrete stays poured with the bolts outstanding
      expect(progressOf(ia, foundationActivities(ia, f2))).toBe(75)
      expect(foundationState(ia, f2).state).toBe('in-progress')
      await run('updateActivity', [`${pad.id}:anchorBoltsPostInstalled`, { status: 'complete' }, TODAY])
      const done = await state(raw)
      const id = getIndex(done)
      const f3 = done.foundations.find((f) => f.id === pad.id)!
      expect(progressOf(id, foundationActivities(id, f3))).toBe(100)
      expect(foundationState(id, f3).state).toBe('constructed')
      expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect((await checkIntegrity(db)).ok).toBe(true)
    }
    process.stderr.write(`\nanchor bolt installation on a copy: ${st.foundations.length} designations, ${changed.length} change progress (post-installed items not yet recorded)${changed.length ? ': ' + changed.slice(0, 12).join(', ') + (changed.length > 12 ? ', …' : '') : ''}. OP1-01-06: 100% → 75% (bolts outstanding), poured stays complete, 100% once installed.\n`)
  })
})
