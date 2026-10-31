import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { materialsIndicator } from '../packageProgress'
import { buildSeed } from '../seed'
import { getIndex } from '../selectors'
import * as A from '../tracker/actions'
import { importWorkbookFile } from '../tracker/import'
import { areaIdFor, areaSummary, deliveryState, filterLines, receivedOf, reconcileSummary, remainingOf } from '../tracker/selectors'
import { emptyTracker, type TrackerState } from '../tracker/types'
import { readWorkbook } from '@/lib/xlsx'
import { buildWorkbook, sampleWorkbook } from './xlsxBuilder'

const TODAY = '2026-10-21'
const META = { fileName: 'sample.xlsx', fileSize: 1, sha256: null, importedAt: '2026-10-21T00:00:00Z' }
async function loaded(): Promise<TrackerState> {
  const parsed = await importWorkbookFile(sampleWorkbook())
  const out = A.importTracker(parsed, META)(emptyTracker())
  if (out.error !== undefined) throw new Error(out.error)
  return out.state
}
const apply = (s: TrackerState, r: A.Reducer) => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: TrackerState, r: A.Reducer) => r(s).error
const line = (s: TrackerState, row: number) => s.lines.find((l) => l.source.row === row)!

describe('workbook import', () => {
  it('reads values, formulas and comments from a real .xlsx container', async () => {
    const wb = await readWorkbook(sampleWorkbook())
    expect(wb.sheets.map((s) => s.name)).toEqual(['Anchorage Type', 'Material List'])
    const ml = wb.sheets[1]
    expect(ml.cells.get('H4')).toMatchObject({ value: 24, formula: 'D4*E4*F4' })
    expect(ml.comments.get('G4')).toContain('Ordered as:')
  })

  it('imports every detailed row with its sheet and row, and skips blank formula rows', async () => {
    const s = await loaded()
    expect(s.lines).toHaveLength(14)
    expect(s.meta!.counts).toMatchObject({ materialRows: 14, summaryRows: 9, anchorageRows: 2, blankRowsSkipped: 1, commentsRead: 1 })
    expect(line(s, 4)).toMatchObject({ source: { sheet: 'Material List', row: 4 }, area: 'North Area', component: '3/4" x 460mm Bolt', requiredQty: 24, sourceStatus: 'Delivered', category: 'bolt' })
  })

  it('keeps component descriptions verbatim and classifies every component type', async () => {
    const s = await loaded()
    expect(s.lines.map((l) => l.category)).toEqual(expect.arrayContaining(['template', 'sole-plate', 'bolt', 'washer', 'nut', 'embed-plate']))
    expect(line(s, 3).component).toBe('T1 Sole Plate 6x300x300')
    expect(line(s, 12).category).toBe('embed-plate')
  })

  it('preserves the quantity calculation logic', async () => {
    const s = await loaded()
    expect(line(s, 4).calc).toMatchObject({ kind: 'inputs', formula: 'D4*E4*F4', expression: '# of Ftngs × # of Plinths × # of Bolts', recomputed: 24 })
    expect(line(s, 5).calc).toMatchObject({ kind: 'derived', expression: 'required qty of row 4 × 2', recomputed: 48 })
    expect(line(s, 12).calc).toMatchObject({ kind: 'entered', formula: null })
  })

  it('does not count the area summary as additional requirements, and reconciles it with the detail', async () => {
    const s = await loaded()
    expect(s.summary).toHaveLength(9)
    const total = s.lines.reduce((a, l) => a + l.requiredQty, 0)
    expect(total).not.toBe(total + s.summary.reduce((a, r) => a + r.totalQty, 0))
    expect(reconcileSummary(s)).toMatchObject({ total: 9, matched: 9 })
    expect(areaSummary(s.lines).find((g) => g.component === '3/4" Nut')!.required).toBe(168)
  })

  it('flags ambiguous records instead of correcting them', async () => {
    const s = await loaded()
    const codes = (row: number) => s.flags.filter((f) => f.source.row === row && f.source.sheet === 'Material List').map((f) => f.code)
    expect(codes(4)).toContain('workbook-comment')
    expect(codes(14)).toContain('hardware-ratio-swapped')
    expect(codes(15)).toContain('hardware-ratio-swapped')
    expect(line(s, 14).requiredQty).toBe(24) // untouched
    expect(codes(12)).toContain('entered-quantity')
    expect(s.flags.some((f) => f.code === 'anchorage-sheet-unlinked')).toBe(true)
    expect(s.flags.some((f) => f.code === 'anchorage-no-footing-type' && f.source.row === 2)).toBe(true)
  })

  it('keeps the Anchorage Type sheet as reference rows, outside requirements', async () => {
    const s = await loaded()
    expect(s.anchorage).toHaveLength(2)
    expect(s.anchorage[1]).toMatchObject({ footingType: '1C', anchorageType: 'A', footings: 2, requiredQty: 8, grade: 36 })
    expect(s.lines.some((l) => l.source.sheet === 'Anchorage Type')).toBe(false)
  })

  it('refuses a workbook without the expected sheets or columns', async () => {
    const bad = buildWorkbook([{ name: 'Material List', rows: { A1: { v: 'Area' } } }])
    await expect(importWorkbookFile(bad)).rejects.toThrow(/Anchorage Type/)
    const wrongHead = buildWorkbook([{ name: 'Material List', rows: { A1: { v: 'Zone' } } }, { name: 'Anchorage Type', rows: {} }])
    await expect(importWorkbookFile(wrongHead)).rejects.toThrow(/expected column “Area”/)
    await expect(importWorkbookFile(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  it('maps workbook areas to REEF areas by name only', () => {
    const areas = buildSeed(TODAY).areas
    expect(areaIdFor(areas, ' mole  sieve ')).toBe('mole-sieve')
    expect(areaIdFor(areas, 'North Area')).toBeNull()
  })
})

describe('deliveries: workbook status is not a receipt', () => {
  it('never sets received quantity from a Delivered status', async () => {
    const s = await loaded()
    const bolt = line(s, 4)
    expect(bolt.sourceStatus).toBe('Delivered')
    expect(receivedOf(bolt)).toBe(0)
    expect(remainingOf(bolt)).toBe(bolt.requiredQty) // nothing confirmed yet, whatever the workbook says
    expect(deliveryState(bolt)).toBe('none-received')
    expect(deliveryState(line(s, 7))).toBe('none-received')
  })

  it('supports partial deliveries and calculates remaining only once verified', async () => {
    let s = await loaded()
    const id = line(s, 4).id
    s = apply(s, A.legacyAddReceipt(id, { date: '2026-10-10', qty: 10, reference: 'PS-1', note: '' }, TODAY))
    expect(deliveryState(line(s, 4))).toBe('partial')
    expect(remainingOf(line(s, 4))).toBe(14)
    s = apply(s, A.legacyAddReceipt(id, { date: '2026-10-15', qty: 14, reference: 'PS-2', note: '' }, TODAY))
    expect(receivedOf(line(s, 4))).toBe(24)
    expect(deliveryState(line(s, 4))).toBe('received')
    expect(remainingOf(line(s, 4))).toBe(0)
    s = apply(s, A.legacyAddReceipt(id, { date: '2026-10-16', qty: 2, reference: '', note: 'extra' }, TODAY))
    expect(deliveryState(line(s, 4))).toBe('over-received')
    expect(remainingOf(line(s, 4))).toBe(0)
  })

  it('rejects invalid receipts', async () => {
    const s = await loaded(); const id = line(s, 4).id
    expect(err(s, A.legacyAddReceipt(id, { date: '2026-10-10', qty: 0, reference: '', note: '' }, TODAY))).toMatch(/greater than zero/)
    expect(err(s, A.legacyAddReceipt(id, { date: '2026-10-10', qty: -3, reference: '', note: '' }, TODAY))).toMatch(/greater than zero/)
    expect(err(s, A.legacyAddReceipt(id, { date: '2026-10-10', qty: 1.5, reference: '', note: '' }, TODAY))).toMatch(/whole number/)
    expect(err(s, A.legacyAddReceipt(id, { date: '2026-11-01', qty: 1, reference: '', note: '' }, TODAY))).toMatch(/future/)
    expect(err(s, A.legacyAddReceipt(id, { date: 'nope', qty: 1, reference: '', note: '' }, TODAY))).toMatch(/valid date/)
    expect(err(s, A.legacySetOrdered(id, -1))).toMatch(/whole number/)
  })

  it('confirming "nothing received" makes remaining known; receipts cancel the confirmation', async () => {
    let s = await loaded(); const id = line(s, 4).id
    s = apply(s, A.confirmNoReceipts(id, true))
    expect(deliveryState(line(s, 4))).toBe('none-received')
    expect(remainingOf(line(s, 4))).toBe(24)
    s = apply(s, A.legacyAddReceipt(id, { date: '2026-10-10', qty: 5, reference: '', note: '' }, TODAY))
    expect(line(s, 4).confirmedNoReceipts).toBe(false)
    expect(err(s, A.confirmNoReceipts(id, true))).toMatch(/Remove the recorded receipts/)
    s = apply(s, A.removeReceipt(id, line(s, 4).receipts[0].id))
    expect(line(s, 4).receipts).toHaveLength(0) // a voided receipt leaves the line as it was
  })

  it('area summary shows what has been delivered and what remains', async () => {
    let s = await loaded()
    const bolts = () => areaSummary(s.lines).find((g) => g.area === 'North Area' && g.component === '3/4" x 460mm Bolt')!
    const total = bolts().required
    expect(bolts()).toMatchObject({ received: 0, remaining: total })
    s = apply(s, A.legacyAddReceipt(line(s, 4).id, { date: '2026-10-10', qty: 24, reference: '', note: '' }, TODAY))
    expect(bolts()).toMatchObject({ received: 24, remaining: total - 24, lines: 2 })
  })
})

describe('materials progress indicator', () => {
  const idx = getIndex(buildSeed(TODAY))
  it('says so when there are no material requirements for the area', () => {
    const ind = materialsIndicator(idx, 'mole-sieve', emptyTracker())
    expect(ind.percent).toBeNull()
    expect(ind.rows[0].value).toBe('None yet')
  })
})

describe('filters', () => {
  it('filters by area, component type, footing type, anchorage type, delivery status and text', async () => {
    let s = await loaded()
    s = apply(s, A.legacyAddReceipt(line(s, 4).id, { date: '2026-10-10', qty: 10, reference: '', note: '' }, TODAY))
    expect(filterLines(s.lines, { area: 'South Area' })).toHaveLength(4)
    expect(filterLines(s.lines, { category: 'bolt' }).map((l) => l.source.row)).toEqual([4, 9, 13])
    expect(filterLines(s.lines, { footingType: 'F-11' })).toHaveLength(3)
    expect(filterLines(s.lines, { anchorageType: 'T9' })).toHaveLength(3)
    expect(filterLines(s.lines, { delivery: 'partial' }).map((l) => l.source.row)).toEqual([4])
    expect(filterLines(s.lines, { delivery: 'none-received' })).toHaveLength(s.lines.length - 1)
    expect(filterLines(s.lines, { search: 'ordered as' }).map((l) => l.source.row)).toEqual([4]) // finds workbook comments
    expect(filterLines(s.lines, { search: 'embed', area: 'North Area' })).toHaveLength(0)
  })
})

describe('re-import', () => {
  it('carries Nexus entries over by line identity and keeps removed rows that hold entries', async () => {
    let s = await loaded()
    s = apply(s, A.legacyAddReceipt(line(s, 4).id, { date: '2026-10-10', qty: 10, reference: 'PS-1', note: '' }, TODAY))
    s = apply(s, A.setNotes(line(s, 13).id, 'check thread'))
    const flagId = s.flags.find((f) => f.code === 'entered-quantity')!.id
    s = apply(s, A.acknowledgeFlag(flagId, '', TODAY, true))
    // A newer file in which North Area's second footing group has gone and the South bolt row has moved.
    const again = await importWorkbookFile(sampleWorkbook())
    again.lines = again.lines.filter((l) => l.footingType !== 'F-02').map((l) => ({ ...l, source: { ...l.source, row: l.source.row + 100 } }))
    again.flags = again.flags.filter((f) => f.id === flagId)
    s = apply(s, A.importTracker(again, META))
    expect(s.lines.find((l) => l.component === '3/4" x 460mm Bolt' && l.footingType === 'F-01')!.receipts).toHaveLength(1)
    expect(s.lines.find((l) => l.component === '1" x 300mm Bolt')!.notes).toBe('check thread')
    expect(s.acknowledged[flagId]).toBeTruthy()
    expect(s.lines.filter((l) => l.sourceRemoved)).toHaveLength(0) // removed F-02 rows had no entries → dropped
  })

  it('never drops a removed row that holds receipts', async () => {
    let s = await loaded()
    s = apply(s, A.legacyAddReceipt(line(s, 9).id, { date: '2026-10-10', qty: 1, reference: '', note: '' }, TODAY))
    const again = await importWorkbookFile(sampleWorkbook())
    again.lines = again.lines.filter((l) => l.footingType !== 'F-02')
    s = apply(s, A.importTracker(again, META))
    expect(s.lines.filter((l) => l.sourceRemoved).map((l) => l.source.row)).toEqual([9])
  })

  it('removing the import clears it', async () => {
    const s = apply(await loaded(), A.clearTracker())
    expect({ ...s, history: [] }).toEqual(emptyTracker()) // the import is gone; the history of what happened stays
  })
})

// Runs only when a real workbook path is supplied: NEXUS_WORKBOOK=/path/to/file.xlsx npm test
describe.skipIf(!process.env.NEXUS_WORKBOOK)('real REEF workbook', () => {
  it('imports completely, ties out to its own summary, and flags the known irregularities', async () => {
    const parsed = await importWorkbookFile(new Uint8Array(readFileSync(process.env.NEXUS_WORKBOOK!)))
    expect(parsed.counts).toMatchObject({ materialRows: 220, summaryRows: 78, anchorageRows: 131, commentsRead: 15, blankRowsSkipped: 36 })
    const s = apply(emptyTracker(), A.importTracker(parsed, META))
    expect(reconcileSummary(s)).toMatchObject({ total: 78, matched: 78 })
    expect(new Set(s.lines.map((l) => l.area))).toEqual(new Set(['Mole Sieve', 'Propane BOG', 'E-House', 'Piperack', 'Locomotive Shelter']))
    expect(s.lines.filter((l) => l.sourceStatus === 'Delivered')).toHaveLength(183)
    expect(s.lines.filter((l) => l.sourceStatus === 'Pending')).toHaveLength(37)
    expect(s.lines.every((l) => l.calc.kind === 'entered' || l.calc.recomputed === null || l.calc.recomputed === l.requiredQty)).toBe(true)
    expect(s.lines.filter((l) => receivedOf(l) > 0)).toHaveLength(0)
    expect(s.flags.filter((f) => f.code === 'hardware-ratio-swapped')).toHaveLength(8)
    expect(s.flags.filter((f) => f.code === 'embed-plate-bolt-multiplier')).toHaveLength(3)
  })
})
