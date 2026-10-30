import { describe, expect, it } from 'vitest'
import * as A from '../tracker/actions'
import type { MaterialInput } from '../tracker/materialModel'
import { importWorkbookFile } from '../tracker/import'
import { demoTrackerSeed } from '../tracker/demoSeed'
import { activeLines, allLines, dashboardCounts, deliveryState, filterLines, outstandingOf, previewImport, receivedOf, sortLines, toCsv } from '../tracker/selectors'
import { emptyTracker, type TrackerState } from '../tracker/types'
import { can, permissionForCommand } from '@/shared/rbac'
import { sampleWorkbook } from './xlsxBuilder'

const TODAY = '2026-10-21'
const META = { fileName: 'sample.xlsx', fileSize: 1, sha256: null, importedAt: '2026-10-21T00:00:00Z' }
const CTX = { actor: 'ana@example.com', now: '2026-10-21T15:00:00.000Z' }
const apply = (s: TrackerState, r: A.Reducer, ctx: A.Reducer extends (s: never, c?: infer C) => unknown ? C : never = CTX) => { const o = r(s, ctx); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: TrackerState, r: A.Reducer) => r(s, CTX).error
const item = (over: Partial<MaterialInput> = {}): MaterialInput => ({
  area: 'North Area', location: 'F-101', anchorageRef: '', category: 'bolt', name: 'Anchor bolt 3/4" x 460 mm', description: '', specification: 'ASTM F1554 Gr.36', size: '3/4" x 460 mm', requiredQty: 24, unit: 'ea',
  supplier: 'Acme', poRef: 'PO-1', expectedDate: '2026-11-01', claimedStatus: '', notes: '', ...over,
})
async function withWorkbook(): Promise<TrackerState> {
  return apply(emptyTracker(), A.importTracker(await importWorkbookFile(sampleWorkbook()), META))
}

describe('adding materials', () => {
  it('adds a material with every workbook-style field and a stable id', () => {
    const s = apply(emptyTracker(), A.addMaterials([item()]))
    expect(s.manual).toHaveLength(1)
    expect(s.manual[0]).toMatchObject({ origin: 'manual', area: 'North Area', footingType: 'F-101', component: 'Anchor bolt 3/4" x 460 mm', specification: 'ASTM F1554 Gr.36', size: '3/4" x 460 mm', requiredQty: 24, unit: 'ea', supplier: 'Acme', poRef: 'PO-1', expectedDate: '2026-11-01', receipts: [] })
    expect(s.manual[0].id).toMatch(/^mm-/)
    expect(s.lines).toHaveLength(0) // workbook lines are a separate list
  })

  it('validates required fields and quantities', () => {
    const s = emptyTracker()
    expect(err(s, A.addMaterials([item({ area: ' ' })]))).toMatch(/Area is required/)
    expect(err(s, A.addMaterials([item({ name: '' })]))).toMatch(/name is required/)
    expect(err(s, A.addMaterials([item({ requiredQty: 0 })]))).toMatch(/1 or more/)
    expect(err(s, A.addMaterials([item({ requiredQty: 2.5 })]))).toMatch(/whole number/)
    expect(err(s, A.addMaterials([item({ requiredQty: NaN })]))).toMatch(/number/)
    expect(err(s, A.addMaterials([item({ expectedDate: '2026-13-45' })]))).toMatch(/valid expected/)
    expect(err(s, A.addMaterials([item({ claimedStatus: 'Shipped' })]))).toMatch(/Pending, Delivered/)
    expect(err(s, A.addMaterials([item({ category: 'rocket' as never })]))).toMatch(/category/)
    expect(err(s, A.addMaterials([]))).toMatch(/at least one/)
  })

  it('Quick Add is all-or-nothing and names the failing row', () => {
    const s = emptyTracker()
    const out = A.addMaterials([item({ name: 'A' }), item({ name: 'B' }), item({ name: 'C', requiredQty: 0 })])(s, CTX)
    expect(out.error).toMatch(/^Row 3:/)
    const ok = apply(s, A.addMaterials([item({ name: 'A' }), item({ name: 'B' }), item({ name: 'C' })]))
    expect(ok.manual.map((m) => m.component)).toEqual(['A', 'B', 'C'])
  })

  it('stops duplicates (same area, foundation, name, specification, size) unless added deliberately', async () => {
    const s = apply(emptyTracker(), A.addMaterials([item()]))
    expect(err(s, A.addMaterials([item({ name: '  anchor BOLT 3/4" x 460 mm ' })]))).toMatch(/already exists/)
    expect(err(emptyTracker(), A.addMaterials([item(), item()]))).toMatch(/already exists/) // duplicate inside one batch
    expect(apply(s, A.addMaterials([item({ location: 'F-102' })])).manual).toHaveLength(2) // other foundation is a different record
    expect(apply(s, A.addMaterials([item()], true)).manual).toHaveLength(2)
    // a workbook line counts too
    const w = await withWorkbook()
    const l = w.lines[0]
    expect(err(w, A.addMaterials([item({ area: l.area, location: l.footingType, name: l.component, specification: '', size: '' })]))).toMatch(/already exists/)
  })

  it('does not touch existing workbook records', async () => {
    const w = await withWorkbook()
    const before = JSON.stringify(w.lines)
    const s = apply(w, A.addMaterials([item()]))
    expect(JSON.stringify(s.lines)).toBe(before)
    expect(allLines(s)).toHaveLength(w.lines.length + 1)
  })
})

describe('editing', () => {
  it('edits a material entered in Nexus and records what changed', () => {
    let s = apply(emptyTracker(), A.addMaterials([item()]))
    const id = s.manual[0].id
    s = apply(s, A.editMaterial(id, { requiredQty: 30, supplier: 'Other', specification: 'ASTM F1554 Gr.55' }))
    expect(s.manual[0]).toMatchObject({ requiredQty: 30, supplier: 'Other', specification: 'ASTM F1554 Gr.55', id })
    const last = s.history.filter((h) => h.materialId === id)
    expect(last.map((h) => h.action)).toEqual(['created', 'quantity', 'edited'])
    expect(last[1].changes).toEqual([{ field: 'Required', from: '24', to: '30' }])
  })

  it('rejects an edit that would make two materials identical, and invalid values', () => {
    let s = apply(emptyTracker(), A.addMaterials([item(), item({ location: 'F-102' })]))
    expect(err(s, A.editMaterial(s.manual[1].id, { location: 'F-101' }))).toMatch(/duplicate/)
    expect(err(s, A.editMaterial(s.manual[1].id, { requiredQty: -1 }))).toMatch(/1 or more/)
    expect(err(s, A.editMaterial('mm-nope', { notes: 'x' }))).toMatch(/no longer exists/)
    s = apply(s, A.editMaterial(s.manual[1].id, { notes: ' ok ' }))
    expect(s.manual[1].notes).toBe('ok')
  })

  it('keeps a workbook line’s source facts locked but lets Nexus-side details change', async () => {
    const w = await withWorkbook()
    const l = w.lines[0]
    expect(err(w, A.editMaterial(l.id, { requiredQty: 1 }))).toMatch(/comes from the workbook/)
    expect(err(w, A.editMaterial(l.id, { area: 'Elsewhere' }))).toMatch(/comes from the workbook/)
    const s = apply(w, A.editMaterial(l.id, { supplier: 'Acme', poRef: 'PO-9', expectedDate: '2026-12-01' }))
    const after = s.lines.find((x) => x.id === l.id)!
    expect(after).toMatchObject({ supplier: 'Acme', poRef: 'PO-9', expectedDate: '2026-12-01', requiredQty: l.requiredQty, area: l.area, component: l.component, sourceStatus: l.sourceStatus })
  })

  it('bulk edit changes every selected material or none', async () => {
    const s0 = apply(emptyTracker(), A.addMaterials([item({ name: 'A' }), item({ name: 'B' })]))
    const ids = s0.manual.map((m) => m.id)
    const s = apply(s0, A.bulkEditMaterials(ids, { supplier: 'Bulk Co', area: 'South Area', location: 'F-200' }))
    expect(s.manual.every((m) => m.supplier === 'Bulk Co' && m.area === 'South Area' && m.footingType === 'F-200')).toBe(true)
    const w = await withWorkbook()
    const mixed = apply(w, A.addMaterials([item()]))
    const before = JSON.stringify(mixed)
    expect(A.bulkEditMaterials([mixed.manual[0].id, mixed.lines[0].id], { area: 'Moved' })(mixed, CTX).error).toMatch(/comes from the workbook/)
    expect(JSON.stringify(mixed)).toBe(before)
    expect(err(s, A.bulkEditMaterials([], { supplier: 'x' }))).toMatch(/at least one/)
    expect(err(s, A.bulkEditMaterials(ids, {}))).toMatch(/what to change/)
  })
})

describe('quantities and deliveries', () => {
  it('outstanding = required − total verified received, across partial deliveries and multiple receipts', () => {
    let s = apply(emptyTracker(), A.addMaterials([item({ requiredQty: 100 })]))
    const id = s.manual[0].id
    expect(deliveryState(s.manual[0])).toBe('unverified-pending')
    expect(outstandingOf(s.manual[0])).toBeNull() // unknown, not "100"
    s = apply(s, A.addReceipt(id, { date: '2026-10-10', qty: 40, reference: 'DN-1', note: '' }, TODAY))
    expect(receivedOf(s.manual[0])).toBe(40)
    expect(outstandingOf(s.manual[0])).toBe(60)
    expect(deliveryState(s.manual[0])).toBe('partial')
    s = apply(s, A.addReceipt(id, { date: '2026-10-12', qty: 35, reference: '', note: 'second truck' }, TODAY))
    expect(receivedOf(s.manual[0])).toBe(75)
    expect(outstandingOf(s.manual[0])).toBe(25)
    s = apply(s, A.addReceipt(id, { date: '2026-10-15', qty: 25, reference: '', note: '' }, TODAY))
    expect(deliveryState(s.manual[0])).toBe('received')
    expect(outstandingOf(s.manual[0])).toBe(0)
    s = apply(s, A.addReceipt(id, { date: '2026-10-16', qty: 5, reference: '', note: '' }, TODAY))
    expect(deliveryState(s.manual[0])).toBe('over-received')
    expect(outstandingOf(s.manual[0])).toBe(0)
    expect(s.manual[0].receipts).toHaveLength(4)
  })

  it('records who recorded each receipt only when an identity is supplied, and validates receipts', () => {
    const s0 = apply(emptyTracker(), A.addMaterials([item()]))
    const id = s0.manual[0].id
    const withUser = apply(s0, A.addReceipt(id, { date: TODAY, qty: 5, reference: '', note: '' }, TODAY))
    expect(withUser.manual[0].receipts[0].by).toBe('ana@example.com')
    const anonymous = A.addReceipt(id, { date: TODAY, qty: 5, reference: '', note: '' }, TODAY)(s0)
    expect(anonymous.state!.manual[0].receipts[0].by).toBe('') // never invented
    expect(err(s0, A.addReceipt(id, { date: TODAY, qty: 0, reference: '', note: '' }, TODAY))).toMatch(/greater than zero/)
    expect(err(s0, A.addReceipt(id, { date: TODAY, qty: 1.5, reference: '', note: '' }, TODAY))).toMatch(/whole number/)
    expect(err(s0, A.addReceipt(id, { date: '2026-12-31', qty: 1, reference: '', note: '' }, TODAY))).toMatch(/future/)
  })

  it('a stated “Delivered” status never becomes a receipt', async () => {
    const s = apply(emptyTracker(), A.addMaterials([item({ claimedStatus: 'Delivered' })]))
    expect(s.manual[0].receipts).toEqual([])
    expect(deliveryState(s.manual[0])).toBe('unverified-delivered')
    expect(outstandingOf(s.manual[0])).toBeNull()
    const w = await withWorkbook()
    const delivered = w.lines.filter((l) => /^delivered$/i.test(l.sourceStatus))
    expect(delivered.length).toBeGreaterThan(0)
    expect(delivered.every((l) => l.receipts.length === 0 && deliveryState(l) === 'unverified-delivered')).toBe(true)
  })

  it('works on workbook lines too and voiding a receipt is recorded', async () => {
    let s = await withWorkbook()
    const l = s.lines[0]
    s = apply(s, A.addReceipt(l.id, { date: TODAY, qty: 3, reference: 'DN-7', note: '' }, TODAY))
    const rid = s.lines[0].receipts[0].id
    s = apply(s, A.removeReceipt(l.id, rid))
    expect(s.history.map((h) => h.action)).toEqual(expect.arrayContaining(['imported', 'receipt', 'receipt-removed']))
  })
})

describe('archive, history and import safety', () => {
  it('archiving hides a material from totals but keeps receipts and history; it can be restored', () => {
    let s = apply(emptyTracker(), A.addMaterials([item()]))
    const id = s.manual[0].id
    s = apply(s, A.addReceipt(id, { date: TODAY, qty: 4, reference: '', note: '' }, TODAY))
    s = apply(s, A.archiveMaterials([id], true))
    expect(s.manual[0].receipts).toHaveLength(1)
    expect(activeLines(s)).toHaveLength(0)
    expect(dashboardCounts(activeLines(s)).total).toBe(0)
    expect(filterLines(allLines(s), {})).toHaveLength(0)
    expect(filterLines(allLines(s), { archived: 'archived' })).toHaveLength(1)
    s = apply(s, A.archiveMaterials([id], false))
    expect(activeLines(s)).toHaveLength(1)
    expect(s.history.map((h) => h.action)).toEqual(['created', 'receipt', 'archived', 'restored'])
  })

  it('history is append-only, attributed to the supplied identity, and never invents one', () => {
    const s = apply(emptyTracker(), A.addMaterials([item()]))
    expect(s.history[0]).toMatchObject({ action: 'created', by: 'ana@example.com', at: CTX.now })
    const anon = A.addMaterials([item()])(emptyTracker())
    expect(anon.state!.history[0].by).toBe('')
    const more = apply(s, A.editMaterial(s.manual[0].id, { notes: 'hello' }))
    expect(more.history.slice(0, 1)).toEqual(s.history) // earlier entries untouched
  })

  it('re-import keeps materials entered in Nexus, suppliers, receipts, archive state and history', async () => {
    let s = await withWorkbook()
    s = apply(s, A.addMaterials([item()]))
    const l = s.lines[0]
    s = apply(s, A.editMaterial(l.id, { supplier: 'Acme' }))
    s = apply(s, A.addReceipt(l.id, { date: TODAY, qty: 2, reference: '', note: '' }, TODAY))
    s = apply(s, A.archiveMaterials([s.lines[1].id], true))
    const again = apply(s, A.importTracker(await importWorkbookFile(sampleWorkbook()), { ...META, fileName: 'again.xlsx' }))
    expect(again.manual).toEqual(s.manual)
    expect(again.lines[0]).toMatchObject({ supplier: 'Acme' })
    expect(again.lines[0].receipts).toHaveLength(1)
    expect(again.lines[1].archived).toBe(true)
    expect(again.history.length).toBeGreaterThan(s.history.length)
    const pv = previewImport(s, await importWorkbookFile(sampleWorkbook()))
    expect(pv).toMatchObject({ newLines: 0, unchanged: 14, changedQty: [], duplicatesInFile: 0 })
    expect(pv.preservedEntries).toBeGreaterThan(0)
  })

  it('removing imported data keeps materials added in Nexus', async () => {
    let s = await withWorkbook()
    s = apply(s, A.addMaterials([item()]))
    const cleared = apply(s, A.clearTracker())
    expect(cleared.lines).toEqual([])
    expect(cleared.manual).toHaveLength(1)
  })
})

describe('dashboard, sorting and export', () => {
  it('counts line items by verified delivery state', () => {
    const s = demoTrackerSeed()
    const c = dashboardCounts(activeLines(s))
    expect(c.total).toBe(12) // one of the 13 sample records is archived
    expect(c.delivered + c.partial + c.pending + c.unverified).toBe(c.total)
    expect(c.partial).toBeGreaterThan(0)
    expect(c.unverified).toBe(1)
  })

  it('sorts by quantity and status and filters by supplier and specification', () => {
    const s = demoTrackerSeed()
    const lines = activeLines(s)
    expect(sortLines(lines, 'required', 'desc')[0].requiredQty).toBe(48)
    expect(sortLines(lines, 'area', 'asc')[0].area).toBe('Pipe Rack C') // the Electrical Building record is archived
    expect(filterLines(lines, { supplier: 'Demo Lumber Yard' }).map((l) => l.category)).toEqual(['template', 'template'])
    expect(filterLines(lines, { search: 'grout' })).toHaveLength(1)
  })

  it('exports Excel-compatible CSV, quoting values and neutralising formulas', () => {
    let s = apply(emptyTracker(), A.addMaterials([item({ name: '=HYPERLINK("http://x")', notes: 'a, "b"\nc' })]))
    s = apply(s, A.addReceipt(s.manual[0].id, { date: TODAY, qty: 4, reference: '', note: '' }, TODAY))
    const csv = toCsv(allLines(s))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain('"a, ""b"" c"')
    const [, row] = csv.trim().split('\r\n')
    expect(row).toContain(',24,4,20,')
  })
})

describe('demo data', () => {
  it('is fictional, entered-in-Nexus material with no recorded users and no workbook', () => {
    const s = demoTrackerSeed()
    expect(s.meta).toBeNull()
    expect(s.lines).toEqual([])
    expect(s.manual.every((m) => m.origin === 'manual' && m.id.startsWith('mm-demo-') && m.receipts.every((r) => !r.by) && !m.createdBy)).toBe(true)
    expect(s.manual.some((m) => m.archived)).toBe(true)
  })
})

describe('permissions', () => {
  it('viewer reads only; editor edits but cannot archive or manage; admin can', () => {
    for (const p of ['materials.add', 'materials.edit', 'materials.receive', 'materials.bulk', 'materials.archive', 'access.manage', 'data.edit'] as const) expect(can('viewer', p)).toBe(false)
    expect(can('viewer', 'view')).toBe(true)
    for (const p of ['materials.add', 'materials.edit', 'materials.receive', 'materials.bulk'] as const) expect(can('editor', p)).toBe(true)
    for (const p of ['materials.archive', 'materials.void-receipt', 'access.manage', 'materials.configure'] as const) expect(can('editor', p)).toBe(false)
    expect(can('admin', 'access.manage')).toBe(true)
    expect(can(null, 'view')).toBe(false)
    expect(permissionForCommand('materials', 'archiveMaterials')).toBe('materials.archive')
    expect(permissionForCommand('materials', 'somethingNew')).toBe('materials.configure') // unknown commands fail closed to admin
    expect(permissionForCommand('fleet', 'recordOdometer')).toBe('data.edit')
  })
})
