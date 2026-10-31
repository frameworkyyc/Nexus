import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { procurementRows } from '@/domains/construction/tracker/procurement'
import { refreshRequirements } from '@/domains/construction/tracker/requirements'
import { command, session } from './helpers'
import { applyMigrationFile, createTestDb } from './sqliteD1'

const before = () => readdirSync('migrations').filter((f) => f.endsWith('.sql') && f < '0024').sort()

describe('migration 0024: top plate component', () => {
  it('keeps every existing component and supplier preference exactly as it was, and then accepts top plates', () => {
    const db = createTestDb({ migrate: false })
    for (const f of before()) applyMigrationFile(db.raw, f)
    db.raw.prepare("INSERT INTO companies (id, name) VALUES ('co', 'Co')").run()
    db.raw.prepare("INSERT INTO projects (id, company_id, name, job_number, client, location, scope, status, status_note) VALUES ('pr', 'co', 'P', '', '', '', '', 'active', '')").run()
    db.raw.prepare("INSERT INTO anchorage_types (id, project_id, code, seq) VALUES ('at', 'pr', 'A', 0)").run()
    const type = { id: 'at' }
    const ins = db.raw.prepare("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, label, spec, size, diameter, length, length_unit, thread, top_thread, bottom_thread, nuts_per_bolt, washers_per_bolt, nut_size, washer_size, seq, center_hole, stud_count, stud_diameter, stud_length) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)")
    ins.run('c-bolt', type.id, 'bolt', 4, 'A325', '', 'M25', 900, 'mm', 'both-ends', 100, 80, 2, 2, 0, null, null, null, null)
    ins.run('c-sole', type.id, 'sole-plate', 1, '350W', '6 x 280 x 280 mm', '', null, 'in', null, null, null, 0, 0, 1, 40, null, null, null)
    ins.run('c-embed', type.id, 'embed-plate', 2, '', '16 x 300 x 300 mm', '', null, 'mm', null, null, null, 0, 0, 2, null, 4, 19, 150)
    const comps = () => db.raw.prepare('SELECT id, anchorage_type_id, kind, qty, label, spec, size, diameter, length, length_unit, thread, top_thread, bottom_thread, nuts_per_bolt, washers_per_bolt, nut_size, washer_size, seq, center_hole, stud_count, stud_diameter, stud_length FROM anchorage_components ORDER BY seq, id').all()
    const suppliers = () => db.raw.prepare('SELECT category, supplier_id FROM category_suppliers ORDER BY category').all()
    const [compsBefore, suppliersBefore, indexed] = [comps(), suppliers(), 'anchorage_components_type']
    expect(compsBefore).toHaveLength(3)
    expect(() => db.raw.prepare("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, seq) VALUES ('t', ?, 'top-plate', 1, 9)").run(type.id)).toThrow() // not yet allowed

    applyMigrationFile(db.raw, '0024_top_plate_component.sql')

    expect(comps()).toEqual(compsBefore) // same rows, same values, same order
    expect(suppliers()).toEqual(suppliersBefore)
    expect(db.raw.prepare('SELECT thickness, width FROM anchorage_components').all().every((r) => (r as { thickness: null; width: null }).thickness === null && (r as { width: null }).width === null)).toBe(true)
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexed)).toBeTruthy()
    db.raw.prepare("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, length, length_unit, thickness, width, seq) VALUES ('c-top', ?, 'top-plate', 2, 400, 'mm', 12, 300, 9)").run(type.id)
    expect(db.raw.prepare("SELECT kind, thickness, width, length, center_hole FROM anchorage_components WHERE id = 'c-top'").get()).toEqual({ kind: 'top-plate', thickness: 12, width: 300, length: 400, center_hole: null })
    expect(() => db.raw.prepare("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, thickness, seq) VALUES ('bad', ?, 'top-plate', 1, 0, 10)").run(type.id)).toThrow() // dimensions stay validated
    expect(() => db.raw.prepare("INSERT INTO anchorage_components (id, anchorage_type_id, kind, qty, seq) VALUES ('bad2', ?, 'gusset', 1, 11)").run(type.id)).toThrow()
    expect(db.raw.prepare("INSERT OR REPLACE INTO category_suppliers (category, supplier_id) VALUES ('top-plate', ?)").run(String((suppliersBefore[0] as { supplier_id: string }).supplier_id))).toBeTruthy()
    expect(db.raw.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get()).toEqual({ value: '24' })
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})

describe('top plates on the server', () => {
  it('are saved with the anchorage type and read back, with no centre hole, and drive a Top plates requirement', async () => {
    const s = session()
    const state = async (m: string) => (await s.call('GET', `/api/state/${m}`)).body.state
    await command(s, 'construction', 'createOrganization', [{ name: 'Northline' }])
    const pid = (await command(s, 'construction', 'createProject', [{ name: 'Plant' }])).body.state.projects[0].id
    await command(s, 'construction', 'createArea', [pid, 'E-House', []])
    await command(s, 'construction', 'addAnchorageType', [pid, 'A', 'Type A'])
    const c0 = await state('construction')
    const A = c0.anchorageTypes.find((t: { code: string }) => t.code === 'A').id
    const aid = c0.areas[0].id
    const bad = await command(s, 'construction', 'setAnchorageComponents', [A, [{ kind: 'top-plate', qty: 1, thickness: 12, width: 300 }]])
    expect(bad.status).toBe(422)
    expect(bad.body.error).toMatch(/length/)
    const ok = await command(s, 'construction', 'setAnchorageComponents', [A, [{ kind: 'top-plate', qty: 2, thickness: 12, width: 300, length: 400, lengthUnit: 'mm', spec: 'G40.21', centerHole: 40 }]])
    expect(ok.status).toBe(200)
    expect(s.db.raw.prepare("SELECT kind, qty, thickness, width, length, length_unit, center_hole, size FROM anchorage_components").all()).toEqual([{ kind: 'top-plate', qty: 2, thickness: 12, width: 300, length: 400, length_unit: 'mm', center_hole: null, size: '12 × 300 × 400 mm' }])
    expect((await state('construction')).anchorageComponents[0]).toMatchObject({ kind: 'top-plate', thickness: 12, width: 300, length: 400, lengthUnit: 'mm', centerHole: null })
    expect((await command(s, 'construction', 'createFoundation', [aid, 'OP-1', '', null, 3, { groups: [{ anchorageTypeId: A, count: 1 }] }])).status).toBe(200)
    const rows = procurementRows(refreshRequirements(await state('materials'), await state('construction'), { log: false }), await state('construction'))
    expect(rows.find((r) => r.category === 'top-plate')).toMatchObject({ name: 'Top plate', size: '12 × 300 × 400 mm', required: 6 })
    expect((await s.call('GET', '/api/integrity')).body.ok).toBe(true)
  })
})
