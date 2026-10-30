import { describe, expect, it } from 'vitest'
import * as A from '../tracker/actions'
import type { MaterialInput } from '../tracker/materialModel'
import { importWorkbookFile } from '../tracker/import'
import { demoTrackerSeed } from '../tracker/demoSeed'
import { buildSeed } from '../seed'
import * as K from '../actions'
import { anchorageFor, buildCatalog, displayOf, foundationsOfArea, legacyIssues, resolveLines } from '../tracker/catalog'
import { effectiveSupplier } from '../tracker/materialModel'
import { findSimilarSupplier, supplierKey } from '../tracker/suppliers'
import { activeLines, allLines, dashboardCounts, deliveryState, filterLines, outstandingOf, previewImport, receivedOf, sortLines, toCsv } from '../tracker/selectors'
import { emptyTracker, type TrackerState } from '../tracker/types'
import { can, permissionForCommand } from '@/shared/rbac'
import { sampleWorkbook } from './xlsxBuilder'

const TODAY = '2026-10-21'
const META = { fileName: 'sample.xlsx', fileSize: 1, sha256: null, importedAt: '2026-10-21T00:00:00Z' }
const C = buildSeed(TODAY)
const [AREA, AREA2] = C.areas
const FOUND = C.foundations.filter((f) => f.areaId === AREA.id)
const FOUND_OTHER = C.foundations.find((f) => f.areaId === AREA2.id)!
const CTX = { actor: 'ana@example.com', now: '2026-10-21T15:00:00.000Z', construction: C }
const NUCOR = { id: 'sup-nucor', name: 'Nucor' }
const ACME = { id: 'sup-acme', name: 'Acme Fasteners' }
const base = (): TrackerState => ({ ...emptyTracker(), suppliers: [NUCOR, ACME], preferredSuppliers: { bolt: NUCOR.id } })
const apply = (s: TrackerState, r: A.Reducer, ctx: Parameters<A.Reducer>[1] = CTX) => { const o = r(s, ctx); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: TrackerState, r: A.Reducer) => r(s, CTX).error
const item = (over: Partial<MaterialInput> = {}): MaterialInput => ({
  areaId: AREA.id, foundationId: FOUND[0].id, anchorageTypeId: '', category: 'bolt', name: 'Anchor bolt 3/4" x 460 mm', description: '', specification: 'ASTM F1554 Gr.36', size: '3/4" x 460 mm', requiredQty: 24, unit: 'ea',
  supplierId: NUCOR.id, poRef: 'PO-1', expectedDate: '2026-11-01', claimedStatus: '', notes: '', ...over,
})
async function withWorkbook(): Promise<TrackerState> {
  return apply(base(), A.importTracker(await importWorkbookFile(sampleWorkbook()), META))
}

describe('adding materials', () => {
  it('adds a material with every workbook-style field and a stable id', () => {
    const s = apply(base(), A.addMaterials([item()]))
    expect(s.manual).toHaveLength(1)
    expect(s.manual[0]).toMatchObject({ origin: 'manual', areaId: AREA.id, area: AREA.name, foundationId: FOUND[0].id, footingType: FOUND[0].number, supplierId: NUCOR.id, supplier: 'Nucor', component: 'Anchor bolt 3/4" x 460 mm', specification: 'ASTM F1554 Gr.36', size: '3/4" x 460 mm', requiredQty: 24, unit: 'ea', poRef: 'PO-1', expectedDate: '2026-11-01', receipts: [] })
    expect(s.manual[0].id).toMatch(/^mm-/)
    expect(s.lines).toHaveLength(0) // workbook lines are a separate list
  })

  it('validates required fields and quantities', () => {
    const s = base()
    expect(err(s, A.addMaterials([item({ areaId: '' })]))).toMatch(/Select an area/)
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
    const s = base()
    const out = A.addMaterials([item({ name: 'A' }), item({ name: 'B' }), item({ name: 'C', requiredQty: 0 })])(s, CTX)
    expect(out.error).toMatch(/^Row 3:/)
    const ok = apply(s, A.addMaterials([item({ name: 'A' }), item({ name: 'B' }), item({ name: 'C' })]))
    expect(ok.manual.map((m) => m.component)).toEqual(['A', 'B', 'C'])
  })

  it('stops duplicates (same area, foundation, name, specification, size) unless added deliberately', async () => {
    const s = apply(base(), A.addMaterials([item()]))
    expect(err(s, A.addMaterials([item({ name: '  anchor BOLT 3/4" x 460 mm ' })]))).toMatch(/already exists/)
    expect(err(base(), A.addMaterials([item(), item()]))).toMatch(/already exists/) // duplicate inside one batch
    expect(apply(s, A.addMaterials([item({ foundationId: FOUND[1].id })])).manual).toHaveLength(2) // other foundation is a different record
    expect(apply(s, A.addMaterials([item()], true)).manual).toHaveLength(2)
    // a workbook line counts too (matched by the area and foundation names it shows)
    const w = await withWorkbook()
    const l = { ...w.lines[0], area: AREA.name, footingType: FOUND[0].number }
    const wl = { ...w, lines: [l, ...w.lines.slice(1)] }
    expect(err(wl, A.addMaterials([item({ name: l.component, specification: '', size: '' })]))).toMatch(/already exists/)
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
    let s = apply(base(), A.addMaterials([item()]))
    const id = s.manual[0].id
    s = apply(s, A.editMaterial(id, { requiredQty: 30, supplierId: ACME.id, specification: 'ASTM F1554 Gr.55' }))
    expect(s.manual[0]).toMatchObject({ requiredQty: 30, supplierId: ACME.id, supplier: 'Acme Fasteners', specification: 'ASTM F1554 Gr.55', id })
    const last = s.history.filter((h) => h.materialId === id)
    expect(last.map((h) => h.action)).toEqual(['created', 'quantity', 'edited'])
    expect(last[1].changes).toEqual([{ field: 'Required', from: '24', to: '30' }])
  })

  it('rejects an edit that would make two materials identical, and invalid values', () => {
    let s = apply(base(), A.addMaterials([item(), item({ foundationId: FOUND[1].id })]))
    expect(err(s, A.editMaterial(s.manual[1].id, { foundationId: FOUND[0].id }))).toMatch(/duplicate/)
    expect(err(s, A.editMaterial(s.manual[1].id, { requiredQty: -1 }))).toMatch(/1 or more/)
    expect(err(s, A.editMaterial('mm-nope', { notes: 'x' }))).toMatch(/no longer exists/)
    s = apply(s, A.editMaterial(s.manual[1].id, { notes: ' ok ' }))
    expect(s.manual[1].notes).toBe('ok')
  })

  it('keeps a workbook line’s source facts locked but lets Nexus-side details change', async () => {
    const w = await withWorkbook()
    const l = w.lines[0]
    expect(err(w, A.editMaterial(l.id, { requiredQty: 1 }))).toMatch(/comes from the workbook/)
    expect(err(w, A.editMaterial(l.id, { areaId: AREA2.id }))).toMatch(/comes from the workbook/)
    const s = apply(w, A.editMaterial(l.id, { supplierId: ACME.id, poRef: 'PO-9', expectedDate: '2026-12-01' }))
    const after = s.lines.find((x) => x.id === l.id)!
    expect(after).toMatchObject({ supplierId: ACME.id, supplier: 'Acme Fasteners', poRef: 'PO-9', expectedDate: '2026-12-01', requiredQty: l.requiredQty, area: l.area, component: l.component, sourceStatus: l.sourceStatus })
  })

  it('bulk edit changes every selected material or none', async () => {
    const s0 = apply(base(), A.addMaterials([item({ name: 'A' }), item({ name: 'B' })]))
    const ids = s0.manual.map((m) => m.id)
    const s = apply(s0, A.bulkEditMaterials(ids, { supplierId: ACME.id, areaId: AREA2.id, foundationId: FOUND_OTHER.id }))
    expect(s.manual.every((m) => m.supplierId === ACME.id && m.areaId === AREA2.id && m.foundationId === FOUND_OTHER.id && m.area === AREA2.name && m.footingType === FOUND_OTHER.number)).toBe(true)
    const w = await withWorkbook()
    const mixed = apply(w, A.addMaterials([item()]))
    const before = JSON.stringify(mixed)
    expect(A.bulkEditMaterials([mixed.manual[0].id, mixed.lines[0].id], { areaId: AREA2.id, foundationId: FOUND_OTHER.id })(mixed, CTX).error).toMatch(/comes from the workbook/)
    expect(JSON.stringify(mixed)).toBe(before)
    expect(err(s, A.bulkEditMaterials([], { supplierId: ACME.id }))).toMatch(/at least one/)
    expect(err(s, A.bulkEditMaterials(ids, {}))).toMatch(/what to change/)
  })
})

describe('quantities and deliveries', () => {
  it('outstanding = required − total verified received, across partial deliveries and multiple receipts', () => {
    let s = apply(base(), A.addMaterials([item({ requiredQty: 100 })]))
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
    const s0 = apply(base(), A.addMaterials([item()]))
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
    const s = apply(base(), A.addMaterials([item({ claimedStatus: 'Delivered' })]))
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
    let s = apply(base(), A.addMaterials([item()]))
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
    const s = apply(base(), A.addMaterials([item()]))
    expect(s.history[0]).toMatchObject({ action: 'created', by: 'ana@example.com', at: CTX.now })
    const anon = A.addMaterials([item()])(base(), { construction: C })
    expect(anon.state!.history[0].by).toBe('')
    const more = apply(s, A.editMaterial(s.manual[0].id, { notes: 'hello' }))
    expect(more.history.slice(0, 1)).toEqual(s.history) // earlier entries untouched
  })

  it('re-import keeps materials entered in Nexus, suppliers, receipts, archive state and history', async () => {
    let s = await withWorkbook()
    s = apply(s, A.addMaterials([item()]))
    const l = s.lines[0]
    s = apply(s, A.editMaterial(l.id, { supplierId: ACME.id }))
    s = apply(s, A.addReceipt(l.id, { date: TODAY, qty: 2, reference: '', note: '' }, TODAY))
    s = apply(s, A.archiveMaterials([s.lines[1].id], true))
    const again = apply(s, A.importTracker(await importWorkbookFile(sampleWorkbook()), { ...META, fileName: 'again.xlsx' }))
    expect(again.manual).toEqual(s.manual)
    expect(again.lines[0]).toMatchObject({ supplierId: ACME.id })
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
    const s = demoTrackerSeed(C)
    const c = dashboardCounts(activeLines(s))
    expect(c.total).toBe(12) // one of the 13 sample records is archived
    expect(c.delivered + c.partial + c.pending + c.unverified).toBe(c.total)
    expect(c.partial).toBeGreaterThan(0)
    expect(c.unverified).toBe(1)
  })

  it('sorts by quantity and status and filters by supplier and specification', () => {
    const s = demoTrackerSeed(C)
    const lines = activeLines(s)
    expect(sortLines(lines, 'required', 'desc')[0].requiredQty).toBe(48)
    expect(sortLines(lines, 'area', 'asc')[0].area).toBe([...lines].map((l) => l.area).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))[0])
    expect(filterLines(lines, { supplier: 'Demo Lumber Yard' }).map((l) => l.category)).toEqual(['template', 'template'])
    expect(filterLines(lines, { search: 'grout' })).toHaveLength(1)
  })

  it('exports Excel-compatible CSV, quoting values and neutralising formulas', () => {
    let s = apply(base(), A.addMaterials([item({ name: '=HYPERLINK("http://x")', notes: 'a, "b"\nc' })]))
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
    const s = demoTrackerSeed(C)
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

const catalog = () => buildCatalog(C, base())
const kapply = (s: typeof C, r: K.Reducer, ctx: K.Ctx = {}) => { const o = r(s, ctx); if (o.error !== undefined) throw new Error(o.error); return o.state }
const kerr = (s: typeof C, r: K.Reducer, ctx: K.Ctx = {}) => r(s, ctx).error

describe('areas, foundations and anchorage come from project records', () => {
  it('offers the project’s own areas and only the selected area’s foundations', () => {
    const cat = catalog()
    expect(cat.areas.map((a) => a.id)).toEqual([...C.areas].sort((a, b) => a.sequence - b.sequence).map((a) => a.id))
    expect(foundationsOfArea(cat, AREA.id).every((f) => f.areaId === AREA.id)).toBe(true)
    expect(foundationsOfArea(cat, AREA.id).map((f) => f.id).sort()).toEqual(FOUND.map((f) => f.id).sort())
    expect(foundationsOfArea(cat, AREA2.id).some((f) => f.areaId === AREA.id)).toBe(false)
    expect(foundationsOfArea(cat, null)).toEqual([])
    expect(buildCatalog(C, base(), 'no-such-project').areas).toEqual([]) // scoped to one project
  })

  it('rejects text that is not a registered record — areas, foundations, anchorage and suppliers', () => {
    const s = base()
    expect(err(s, A.addMaterials([item({ areaId: 'Mole Sieve' })]))).toMatch(/project’s areas/)
    expect(err(s, A.addMaterials([item({ areaId: '' })]))).toMatch(/Select an area/)
    expect(err(s, A.addMaterials([item({ foundationId: 'F-typed-by-hand' })]))).toMatch(/foundation from the area/)
    expect(err(s, A.addMaterials([item({ anchorageTypeId: 'made-up' })]))).toMatch(/project’s library/)
    expect(err(s, A.addMaterials([item({ supplierId: 'Nucor' })]))).toMatch(/supplier directory/)
    expect(A.addMaterials([item()])(s).error).toMatch(/could not be loaded/) // no project records: fails closed, never saves
  })

  it('refuses a foundation from another area and clears nothing silently when the area changes', () => {
    const s = base()
    expect(err(s, A.addMaterials([item({ areaId: AREA.id, foundationId: FOUND_OTHER.id })]))).toMatch(/different area/)
    const added = apply(s, A.addMaterials([item()]))
    const id = added.manual[0].id
    expect(err(added, A.editMaterial(id, { areaId: AREA2.id }))).toMatch(/belongs to the previous area/)
    const moved = apply(added, A.editMaterial(id, { areaId: AREA2.id, foundationId: FOUND_OTHER.id }))
    expect(moved.manual[0]).toMatchObject({ areaId: AREA2.id, foundationId: FOUND_OTHER.id, area: AREA2.name, footingType: FOUND_OTHER.number })
    const cleared = apply(added, A.editMaterial(id, { areaId: AREA2.id, foundationId: '' }))
    expect(cleared.manual[0].foundationId).toBeNull()
  })

  it('prioritises anchorage types used on the selected foundation and never duplicates a definition', () => {
    const withTypes = C.anchorageTypes.length > 0 ? C : null
    expect(withTypes).not.toBeNull()
    const f = FOUND.find((x) => C.plinths.some((p) => p.foundationId === x.id && p.anchorageTypeId))!
    const used = new Set(C.plinths.filter((p) => p.foundationId === f.id).map((p) => p.anchorageTypeId))
    const list = anchorageFor(buildCatalog(C, base()), f.id)
    const firstOthers = list.findIndex((a) => !a.onFoundation)
    expect(list.slice(0, firstOthers).every((a) => used.has(a.id))).toBe(true)
    expect(new Set(list.map((a) => a.code.toLowerCase())).size).toBe(list.length)
  })

  it('offers workbook anchorage codes without duplicating the project library, and links them to foundations by name', async () => {
    const w = await withWorkbook()
    const code = w.lines[0].anchorageType
    const cat = buildCatalog({ ...C, anchorageTypes: [], plinths: [] }, w)
    expect(cat.anchorage.find((a) => a.code === code)).toMatchObject({ id: `wb:${code}`, source: 'workbook' })
    const lib = { ...C, anchorageTypes: [{ id: 'T-1', code, description: 'Project type', bolts: [], hardware: [] }] }
    const merged = buildCatalog(lib, w).anchorage.filter((a) => a.code.toLowerCase() === code.toLowerCase())
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('T-1') // the project library wins
    const added = apply(w, A.addMaterials([item({ anchorageTypeId: 'T-1' })]), { ...CTX, construction: lib })
    expect(added.manual[0]).toMatchObject({ anchorageTypeId: 'T-1', anchorageType: code })
  })
})

describe('foundation management', () => {
  it('creates foundations once; duplicates (even archived) are refused', () => {
    const area = AREA.id
    const s = kapply(C, K.createFoundation(area, 'Z-01', 'New one', 2))
    expect(s.foundations.find((f) => f.number === 'Z-01')).toMatchObject({ areaId: area, description: 'New one' })
    expect(kerr(s, K.createFoundation(area, 'z-01', '', 1))).toMatch(/already exists/)
    const archived = kapply(s, K.archiveFoundation(s.foundations.find((f) => f.number === 'Z-01')!.id, true), { materials: base() })
    expect(kerr(archived, K.createFoundation(area, 'Z-01', '', 1))).toMatch(/archived/)
  })

  it('renaming keeps the id, plinths, activities and material associations', () => {
    const f = FOUND[0]
    const s0 = apply(base(), A.addMaterials([item({ foundationId: f.id })]))
    const renamed = kapply(C, K.renameFoundation(f.id, 'RENAMED-01'))
    const same = renamed.foundations.find((x) => x.id === f.id)!
    expect(same.number).toBe('RENAMED-01')
    expect(renamed.plinths.filter((p) => p.foundationId === f.id)).toHaveLength(C.plinths.filter((p) => p.foundationId === f.id).length)
    expect(renamed.activities.filter((a) => a.foundationId === f.id)).toHaveLength(C.activities.filter((a) => a.foundationId === f.id).length)
    const cat = buildCatalog(renamed, s0)
    const shown = resolveLines(s0.manual, cat, s0.suppliers)[0]
    expect(shown.footingType).toBe('RENAMED-01') // the material follows the rename…
    expect(s0.manual[0].foundationId).toBe(f.id) // …and its own record never changed
    expect(kerr(C, K.renameFoundation(f.id, FOUND[1].number))).toMatch(/already exists/)
    expect(kerr(C, K.renameFoundation(f.id, 'bad number!'))).toMatch(/letters, digits/)
  })

  it('a renamed foundation’s old number can be reused without clashing ids', () => {
    const f = FOUND[0]
    const renamed = kapply(C, K.renameFoundation(f.id, 'RENAMED-01'))
    const again = kapply(renamed, K.createFoundation(AREA.id, f.number, 'reused', 1))
    expect(new Set(again.foundations.map((x) => x.id)).size).toBe(again.foundations.length)
  })

  it('archiving is refused while active materials use the foundation, and keeps every record when allowed', () => {
    const f = FOUND[0]
    const used = apply(base(), A.addMaterials([item({ foundationId: f.id })]))
    expect(kerr(C, K.archiveFoundation(f.id, true), { materials: used })).toMatch(/1 active material is assigned/)
    expect(kerr(C, K.archiveFoundation(f.id, true))).toMatch(/could not be checked/)
    const archivedMaterial = apply(used, A.archiveMaterials([used.manual[0].id], true))
    const s = kapply(C, K.archiveFoundation(f.id, true), { materials: archivedMaterial })
    expect(s.foundations.find((x) => x.id === f.id)!.archived).toBe(true)
    expect(s.plinths.length).toBe(C.plinths.length)
    expect(s.activities.length).toBe(C.activities.length)
    expect(foundationsOfArea(buildCatalog(s, base()), AREA.id).some((x) => x.id === f.id)).toBe(false) // not offered for new materials
    expect(A.addMaterials([item({ foundationId: f.id })])(base(), { ...CTX, construction: s }).error).toMatch(/archived/) // not offered for new materials
    const back = kapply(s, K.archiveFoundation(f.id, false))
    expect(back.foundations.find((x) => x.id === f.id)!.archived).toBe(false)
  })

  it('an archived foundation does not block editing a material that already uses it', () => {
    const f = FOUND[0]
    const s0 = apply(base(), A.addMaterials([item({ foundationId: f.id })]))
    const arch = kapply(C, K.archiveFoundation(f.id, true), { materials: apply(s0, A.archiveMaterials([s0.manual[0].id], true)) })
    const edited = apply(s0, A.editMaterial(s0.manual[0].id, { notes: 'still editable' }), { ...CTX, construction: arch })
    expect(edited.manual[0].notes).toBe('still editable')
    expect(A.addMaterials([item({ foundationId: f.id })])(base(), { ...CTX, construction: arch }).error).toMatch(/archived/)
  })

  it('sets up a new area together with its foundations', () => {
    const s = kapply(C, K.createArea(AREA.projectId, 'Control Building', [{ number: '61-01', description: 'Main', plinthCount: 4 }, { number: '61-02', description: '', plinthCount: 0 }]))
    const area = s.areas.find((a) => a.name === 'Control Building')!
    expect(area.id).toMatch(/^area-/)
    expect(s.foundations.filter((f) => f.areaId === area.id).map((f) => f.number)).toEqual(['61-01', '61-02'])
    expect(s.plinths.filter((p) => p.foundationId.includes('61-01'))).toHaveLength(4)
    expect(s.handover.some((h) => h.areaId === area.id)).toBe(true)
    expect(kerr(s, K.createArea(AREA.projectId, 'control building', []))).toMatch(/already exists/)
    expect(kerr(C, K.createArea(AREA.projectId, 'X', [{ number: '1', description: '', plinthCount: 1 }, { number: '1', description: '', plinthCount: 1 }]))).toMatch(/already exists/)
    expect(kerr(C, K.createArea('nope', 'X', []))).toMatch(/Project not found/)
    // materials can now be added to the new area and foundation
    const added = apply(base(), A.addMaterials([item({ areaId: area.id, foundationId: s.foundations.find((f) => f.areaId === area.id)!.id })]), { ...CTX, construction: s })
    expect(added.manual[0].area).toBe('Control Building')
  })
})

describe('supplier directory and preferred suppliers', () => {
  it('suggests the category’s preferred supplier, never replaces a manual choice, and re-suggests when untouched', () => {
    const pref = (c: string) => (c === 'bolt' ? NUCOR.id : '')
    const auto = { id: '', manual: false }
    expect(effectiveSupplier(auto, null, pref('bolt'))).toBe(NUCOR.id) // Anchor bolts → Nucor
    expect(effectiveSupplier(auto, null, pref('nut'))).toBe('') // no preference configured: left empty
    const manual = { id: ACME.id, manual: true }
    expect(effectiveSupplier(manual, null, pref('bolt'))).toBe(ACME.id) // an override survives a category change
    expect(effectiveSupplier(manual, null, pref('nut'))).toBe(ACME.id)
    expect(effectiveSupplier({ id: '', manual: true }, null, pref('bolt'))).toBe('') // deliberately none stays none
    expect(effectiveSupplier(auto, null, pref('nut'))).toBe('') // category changed, not overridden → follows the new category
  })

  it('a row’s own supplier survives changes to the shared default', () => {
    const shared = { id: NUCOR.id, manual: true }
    expect(effectiveSupplier(shared, ACME.id, '')).toBe(ACME.id)
    expect(effectiveSupplier({ id: ACME.id, manual: true }, ACME.id, '')).toBe(ACME.id)
    expect(effectiveSupplier({ id: ACME.id, manual: true }, null, '')).toBe(ACME.id)
  })

  it('a Quick Add batch keeps each row’s anchorage type and supplier', () => {
    const f = FOUND.find((x) => C.plinths.some((p) => p.foundationId === x.id && p.anchorageTypeId))!
    const types = [...new Set(C.plinths.filter((p) => p.foundationId === f.id).map((p) => p.anchorageTypeId!))]
    const s = apply(base(), A.addMaterials([
      item({ foundationId: f.id, name: 'Bolt A', anchorageTypeId: types[0], supplierId: NUCOR.id }),
      item({ foundationId: f.id, name: 'Specialty bolt', anchorageTypeId: C.anchorageTypes.find((t) => t.id !== types[0])!.id, supplierId: ACME.id }),
    ]))
    expect(s.manual.map((m) => [m.supplierId, m.anchorageTypeId])).toEqual([[NUCOR.id, types[0]], [ACME.id, C.anchorageTypes.find((t) => t.id !== types[0])!.id]])
  })

  it('treats near-identical names as one supplier and refuses duplicates', () => {
    for (const n of ['nucor', 'NUCOR', 'Nucor Inc.', ' Nucor  Corp ', 'N.u.c.o.r']) expect(supplierKey(n)).toBe('nucor')
    const list = [NUCOR, ACME]
    expect(findSimilarSupplier(list, 'NUCOR inc')).toEqual(NUCOR)
    expect(findSimilarSupplier(list, 'Acme Fastenrs')?.id).toBe(ACME.id) // one-letter slip
    expect(findSimilarSupplier(list, 'Acme Fasteners Co')?.id).toBe(ACME.id)
    expect(findSimilarSupplier(list, 'Nutter Bolts')).toBeUndefined()
    expect(err(base(), A.addSupplier('Acme Fasteners'))).toMatch(/looks like/)
    const s = base()
    expect(A.addSupplier('nucor')(s, CTX).error).toMatch(/looks like the existing supplier “Nucor”/)
    const dir = apply(s, A.addSupplier('Hilti'))
    expect(dir.suppliers.map((x) => x.id)).toContain('sup-hilti')
    expect(A.addSupplier('HILTI Inc')(dir, CTX).error).toMatch(/looks like the existing supplier/)
    expect(A.addSupplier('x')(dir, CTX).error).toMatch(/2 to 80/)
  })

  it('preferred suppliers are configuration: they change suggestions, never existing materials', () => {
    let s = apply(base(), A.addMaterials([item({ supplierId: NUCOR.id })]))
    const before = JSON.stringify(s.manual)
    s = apply(s, A.setPreferredSupplier('bolt', ACME.id))
    expect(s.preferredSuppliers).toEqual({ bolt: ACME.id })
    expect(JSON.stringify(s.manual)).toBe(before)
    s = apply(s, A.setPreferredSupplier('bolt', null))
    expect(s.preferredSuppliers).toEqual({})
    expect(A.setPreferredSupplier('bolt', 'sup-ghost')(s, CTX).error).toMatch(/directory/)
    expect(A.setPreferredSupplier('rocket' as never, null)(s, CTX).error).toMatch(/category/)
    expect(s.history.filter((h) => h.action === 'configured').length).toBe(2)
    expect(A.archiveSupplier(NUCOR.id, true)(apply(base(), A.setPreferredSupplier('bolt', NUCOR.id)), CTX).error).toMatch(/preferred supplier/)
    const renamed = apply(base(), A.renameSupplier(NUCOR.id, 'Nucor Steel'))
    expect(renamed.suppliers[0].name).toBe('Nucor Steel')
  })

  it('a supplier rename shows on materials without changing their records', () => {
    const s = apply(base(), A.addMaterials([item()]))
    const renamed = apply(s, A.renameSupplier(NUCOR.id, 'Nucor Steel'))
    const shown = resolveLines(renamed.manual, catalog(), renamed.suppliers)[0]
    expect(shown.supplier).toBe('Nucor Steel')
    expect(renamed.manual[0].supplierId).toBe(NUCOR.id)
  })
})

describe('legacy values', () => {
  it('keeps free-text values readable and flags them without changing them', () => {
    const legacy = { ...base(), manual: [{ ...apply(base(), A.addMaterials([item()])).manual[0], areaId: null, foundationId: null, anchorageTypeId: null, supplierId: null, area: AREA.name, footingType: FOUND[0].number, anchorageType: 'ZZ-9', supplier: 'nucor inc' }] }
    const before = JSON.stringify(legacy.manual)
    const cat = catalog()
    expect(displayOf(legacy.manual[0], cat, legacy.suppliers)).toMatchObject({ area: AREA.name, foundation: FOUND[0].number, anchorage: 'ZZ-9', supplier: 'nucor inc' })
    const issues = legacyIssues(legacy.manual[0], cat, legacy.suppliers)
    expect(issues.map((i) => [i.field, i.matchId])).toEqual([['area', AREA.id], ['foundation', FOUND[0].id], ['anchorage', null], ['supplier', NUCOR.id]])
    expect(JSON.stringify(legacy.manual)).toBe(before) // detection changes nothing
    // an unrelated edit leaves the legacy text exactly as it was
    const edited = apply(legacy, A.editMaterial(legacy.manual[0].id, { notes: 'x' }))
    expect(edited.manual[0]).toMatchObject({ area: AREA.name, footingType: FOUND[0].number, anchorageType: 'ZZ-9', supplier: 'nucor inc', areaId: null })
    // linking is explicit
    const linked = apply(legacy, A.editMaterial(legacy.manual[0].id, { areaId: AREA.id, foundationId: FOUND[0].id, supplierId: NUCOR.id }))
    expect(linked.manual[0]).toMatchObject({ areaId: AREA.id, foundationId: FOUND[0].id, supplierId: NUCOR.id, supplier: 'Nucor', anchorageType: 'ZZ-9' })
    expect(legacyIssues(linked.manual[0], cat, linked.suppliers).map((i) => i.field)).toEqual(['anchorage'])
  })

  it('does not guess when a value matches several records or none', () => {
    const dupArea = { ...C, areas: [...C.areas, { ...AREA, id: 'area-copy', sequence: 99 }] }
    const line = { ...apply(base(), A.addMaterials([item()])).manual[0], areaId: null, area: AREA.name, foundationId: null, footingType: '', anchorageTypeId: null, anchorageType: '', supplierId: null, supplier: 'Unknown Co' }
    const issues = legacyIssues(line, buildCatalog(dupArea, base()), base().suppliers)
    expect(issues.find((i) => i.field === 'area')!.matchId).toBeNull() // two areas share the name → ambiguous
    expect(issues.find((i) => i.field === 'supplier')!.matchId).toBeNull()
  })

  it('workbook lines stay readable as imported; only a Nexus-entered supplier can be unlinked', async () => {
    const w = await withWorkbook()
    expect(w.lines.every((l) => legacyIssues(l, catalog(), w.suppliers).length === 0)).toBe(true)
    const withText = { ...w, lines: [{ ...w.lines[0], supplier: 'Old Vendor' }, ...w.lines.slice(1)] }
    expect(legacyIssues(withText.lines[0], catalog(), w.suppliers).map((i) => i.field)).toEqual(['supplier'])
  })

  it('a re-import keeps supplier links and the directory', async () => {
    let s = await withWorkbook()
    s = apply(s, A.editMaterial(s.lines[0].id, { supplierId: ACME.id }))
    const again = apply(s, A.importTracker(await importWorkbookFile(sampleWorkbook()), { ...META, fileName: 'again.xlsx' }))
    expect(again.lines[0].supplierId).toBe(ACME.id)
    expect(again.suppliers).toEqual(s.suppliers)
    expect(again.preferredSuppliers).toEqual(s.preferredSuppliers)
  })
})
