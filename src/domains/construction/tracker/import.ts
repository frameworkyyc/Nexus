import { readWorkbook, type XCell, type XSheet, type XWorkbook } from '@/lib/xlsx'
import type { AnchorageSheetRow, ComponentCategory, ImportFlag, ImportMeta, QuantityCalc, SourceRef, TrackerLine, WorkbookSummaryRow } from './types'

const MATERIAL_SHEET = 'Material List'
const ANCHORAGE_SHEET = 'Anchorage Type'

export interface ParsedTracker {
  lines: TrackerLine[]
  summary: WorkbookSummaryRow[]
  anchorage: AnchorageSheetRow[]
  flags: ImportFlag[]
  counts: ImportMeta['counts']
}

export function categoryOf(component: string): ComponentCategory {
  if (/\btemplate\b/i.test(component)) return 'template'
  if (/\bsole plate\b/i.test(component)) return 'sole-plate'
  if (/\bembed plate\b/i.test(component)) return 'embed-plate'
  if (/\bnut\b/i.test(component)) return 'nut'
  if (/\bwasher\b/i.test(component)) return 'washer'
  if (/\bbolt\b/i.test(component) || /^\s*[\d/ ]+"\s*x\s*\d+\s*mm/i.test(component)) return 'bolt'
  return 'other'
}

const str = (c: XCell | undefined) => (c?.value === null || c?.value === undefined ? '' : String(c.value).trim())
const num = (c: XCell | undefined): number | null => {
  if (!c || c.value === null || c.value === '') return null
  const n = typeof c.value === 'number' ? c.value : Number(String(c.value).trim())
  return Number.isFinite(n) ? n : null
}
const isTextNumber = (c: XCell | undefined) => !!c && typeof c.value === 'string' && c.value.trim() !== '' && Number.isFinite(Number(c.value))

interface Cols { f: string; p: string; b: string; q: string }
const MATERIAL_COLS: Cols = { f: 'D', p: 'E', b: 'F', q: 'H' }
const ANCHORAGE_COLS: Cols = { f: 'C', p: 'D', b: 'E', q: 'G' }

/**
 * Re-reads a quantity formula so the calculation logic travels with the data.
 * Understood: products of the row's own # of Ftngs, # of Plinths and # of Bolts, another row's quantity, and numbers.
 */
export function parseCalc(formula: string | null, row: number, inputs: { f: number | null; p: number | null; b: number | null }, refValue: (row: number) => number | null, cols: Cols = MATERIAL_COLS): QuantityCalc {
  if (formula === null) return { kind: 'entered', formula: null, expression: 'Entered value (no formula)', recomputed: null }
  const cleaned = formula
    .replace(/'Material List'!/g, '').replace(/\$/g, '').replace(/\s+/g, '')
    .replace(/MaterialList\[\[#ThisRow\],\['?#ofFtngs\]\]/gi, cols.f).replace(/MaterialList\[\[#ThisRow\],\['?#ofPlinths\]\]/gi, cols.p).replace(/MaterialList\[\[#ThisRow\],\['?#ofBolts\]\]/gi, cols.b)
    .replace(/^=/, '')
  const label: string[] = []
  let value = 1
  let derived = false
  for (const raw of cleaned.split('*')) {
    if (/^\d+(\.\d+)?$/.test(raw)) { label.push(raw); value *= Number(raw); continue }
    const ref = /^([A-Z]+)(\d+)?$/.exec(raw)
    const own = ref && (ref[2] === undefined || Number(ref[2]) === row)
    const pick = ref && own ? ([[cols.f, '# of Ftngs', inputs.f], [cols.p, '# of Plinths', inputs.p], [cols.b, '# of Bolts', inputs.b]] as const).find((c) => c[0] === ref[1]) : undefined
    if (pick) { label.push(pick[1]); value = pick[2] === null ? NaN : value * pick[2]; continue }
    if (ref && ref[1] === cols.q && ref[2]) {
      const v = refValue(Number(ref[2]))
      label.push(`required qty of row ${ref[2]}`); derived = true
      value = v === null ? NaN : value * v
      continue
    }
    return { kind: 'unparsed', formula, expression: formula, recomputed: null }
  }
  return { kind: derived ? 'derived' : 'inputs', formula, expression: label.join(' × '), recomputed: Number.isFinite(value) ? value : null }
}

function requireHeaders(sheet: XSheet, expected: string[], startCol = 1, what = sheet.name) {
  const got = expected.map((_, i) => str(sheet.cells.get(`${String.fromCharCode(64 + startCol + i)}1`)))
  const bad = expected.findIndex((h, i) => got[i].toLowerCase() !== h.toLowerCase())
  if (bad >= 0) throw new Error(`The “${what}” sheet does not have the expected column “${expected[bad]}” (found “${got[bad]}”). Nothing was imported.`)
}

export function parseTracker(wb: XWorkbook): ParsedTracker {
  const ml = wb.sheets.find((s) => s.name === MATERIAL_SHEET)
  const at = wb.sheets.find((s) => s.name === ANCHORAGE_SHEET)
  if (!ml) throw new Error('The workbook has no “Material List” sheet. Nothing was imported.')
  if (!at) throw new Error('The workbook has no “Anchorage Type” sheet. Nothing was imported.')
  requireHeaders(ml, ['Area', 'Footing Type', 'Anchorage Type', '# of Ftngs', '# of Plinths', '# of Bolts', 'Component', "Req'd Quantity", 'Status'])
  requireHeaders(ml, ['Area', 'Item', 'Total Qty', 'Status'], 11, 'Material List summary (K:N)')
  requireHeaders(at, ['Footing Type', 'Anchorage Type', '# of Ftngs', '# of Plinths', '# of Bolts', 'Component', "Req'd Quantity", 'Grade', 'Status'])

  const flags: ImportFlag[] = []
  const flag = (code: string, severity: ImportFlag['severity'], source: SourceRef, message: string, lineId?: string) =>
    flags.push({ id: `${code}:${source.sheet}:${source.row}`, code, severity, source, lineId, message })

  /* ── Material List: detailed requirements (A:I) ─────────────────────────── */
  const cell = (s: XSheet, col: string, r: number) => s.cells.get(`${col}${r}`)
  const lines: TrackerLine[] = []
  const seen = new Map<string, number>()
  let blankRowsSkipped = 0
  for (let r = 2; r <= ml.maxRow; r++) {
    const area = str(cell(ml, 'A', r)), component = str(cell(ml, 'G', r))
    if (!area && !component && !str(cell(ml, 'B', r)) && !str(cell(ml, 'C', r))) { if (cell(ml, 'H', r)) blankRowsSkipped++; continue }
    const source = { sheet: MATERIAL_SHEET, row: r }
    if (!area || !component) { flag('incomplete-row', 'review', source, `Row ${r} is missing ${!area ? 'an area' : 'a component'}; it was imported as written.`) }
    const f = num(cell(ml, 'D', r)), p = num(cell(ml, 'E', r)), b = num(cell(ml, 'F', r))
    const qCell = cell(ml, 'H', r)
    const required = num(qCell)
    const base = `${area}|${str(cell(ml, 'B', r))}|${str(cell(ml, 'C', r))}|${component}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const id = n === 1 ? base : `${base}#${n}`
    if (n > 1) flag('duplicate-row', 'review', source, `Same area, footing type, anchorage type and component as an earlier row; kept as a separate line.`, id)
    const calc = parseCalc(qCell?.formula ?? null, r, { f, p, b }, (row) => num(cell(ml, 'H', row)))
    lines.push({
      id, source, area, footingType: str(cell(ml, 'B', r)), anchorageType: str(cell(ml, 'C', r)),
      footings: f ?? 0, plinths: p ?? 0, bolts: b ?? 0, component, category: categoryOf(component),
      requiredQty: required ?? 0, calc, sourceStatus: str(cell(ml, 'I', r)), sourceNotes: [],
      orderedQty: null, receipts: [], confirmedNoReceipts: false, notes: '',
    })
    if (required === null) flag('missing-quantity', 'review', source, 'No required quantity in the workbook; treated as 0 until reviewed.', id)
    if (f === null || p === null || b === null) flag('missing-count', 'review', source, 'One of # of Ftngs, # of Plinths or # of Bolts is empty or not numeric; treated as 0.', id)
    if (calc.kind === 'unparsed') flag('unparsed-formula', 'review', source, `Quantity formula could not be re-evaluated (${calc.expression}); the workbook's value was kept.`, id)
    else if (calc.recomputed !== null && required !== null && calc.recomputed !== required) flag('quantity-mismatch', 'review', source, `Workbook value ${required} differs from its formula (${calc.expression}) which gives ${calc.recomputed}.`, id)
    if (calc.kind === 'entered' && !(required === 0)) flag('entered-quantity', 'info', source, `Quantity was typed in, not calculated${f !== null && p !== null && f * p === required ? ' (it equals # Ftngs × # Plinths)' : ''}.`, id)
    if (!/^(delivered|pending)$/i.test(str(cell(ml, 'I', r)))) flag('unknown-status', 'review', source, `Status “${str(cell(ml, 'I', r))}” is not Delivered or Pending; kept as written.`, id)
  }
  // Cell comments travel with their row (they record that something was ordered to a different description).
  let commentsRead = 0
  for (const [ref, text] of ml.comments) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref); const line = lines.find((l) => l.source.row === Number(m?.[2]))
    if (!line) continue
    line.sourceNotes.push(text.replace(/\r/g, '').trim()); commentsRead++
    flag('workbook-comment', 'review', line.source, `Workbook comment: ${text.replace(/\s+/g, ' ').trim()}`, line.id)
  }

  /* ── Consistency checks across the detailed rows ────────────────────────── */
  // Hardware multipliers: compare each nut/washer row's multiplier of its bolt row against the most common one.
  const ratio = (l: TrackerLine) => {
    const bolts = lines.filter((x) => x.category === 'bolt' && x.area === l.area && x.footingType === l.footingType && x.anchorageType === l.anchorageType)
    return bolts.length === 1 && bolts[0].requiredQty ? l.requiredQty / bolts[0].requiredQty : NaN
  }
  const mode = (xs: number[]) => { const c = new Map<number, number>(); xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] }
  const nutMode = mode(lines.filter((l) => l.category === 'nut').map(ratio).filter(Number.isFinite))
  const washerMode = mode(lines.filter((l) => l.category === 'washer').map(ratio).filter(Number.isFinite))
  for (const l of lines) {
    if (l.category !== 'nut' && l.category !== 'washer') continue
    const r = ratio(l); const common = l.category === 'nut' ? nutMode : washerMode; const other = l.category === 'nut' ? washerMode : nutMode
    if (!Number.isFinite(r) || r === common) continue
    const swapped = r === other
    flag(swapped ? 'hardware-ratio-swapped' : 'hardware-ratio-differs', 'review', l.source,
      `${l.category === 'nut' ? 'Nuts' : 'Washers'} = ${r} per bolt here, but most rows use ${common}${swapped ? ` (this matches the other hardware type, so nut and washer multipliers may be transposed)` : ''}. Quantity kept as in the workbook.`, l.id)
  }
  for (const l of lines.filter((x) => x.category === 'embed-plate')) {
    if (l.bolts > 1 && l.calc.kind === 'inputs' && l.calc.expression.includes('# of Bolts'))
      flag('embed-plate-bolt-multiplier', 'review', l.source, `Embed plate quantity is multiplied by # of Bolts (${l.bolts}); other embed plates use # Ftngs × # Plinths. Confirm whether one plate or ${l.bolts} are required.`, l.id)
  }
  // A bolt group should list matching nuts and washers.
  const groups = new Map<string, TrackerLine[]>()
  for (const l of lines) groups.set(`${l.area}|${l.footingType}|${l.anchorageType}`, [...(groups.get(`${l.area}|${l.footingType}|${l.anchorageType}`) ?? []), l])
  for (const g of groups.values()) {
    const bolt = g.find((l) => l.category === 'bolt')
    if (bolt && (!g.some((l) => l.category === 'nut') || !g.some((l) => l.category === 'washer'))) flag('hardware-missing', 'review', bolt.source, 'Bolts are listed without a matching nut or washer row for this footing and anchorage type.', bolt.id)
    if (g.some((l) => l.category === 'sole-plate') !== g.some((l) => l.category === 'template')) flag('plate-template-mismatch', 'info', g[0].source, 'Sole plate and plywood template rows are not both listed for this anchorage type.', g[0].id)
  }
  for (const l of lines) if (/^n\/a$/i.test(l.footingType)) flag('footing-type-na', 'review', l.source, 'Footing type is “N/A” in the workbook.', l.id)

  /* ── Material List: area-level summary (K:N) ────────────────────────────── */
  const summary: WorkbookSummaryRow[] = []
  for (let r = 2; r <= ml.maxRow; r++) {
    const area = str(cell(ml, 'K', r)), item = str(cell(ml, 'L', r))
    if (!area && !item) continue
    summary.push({ id: `sum:${area}|${item}`, source: { sheet: MATERIAL_SHEET, row: r }, area, item, totalQty: num(cell(ml, 'M', r)) ?? 0, status: str(cell(ml, 'N', r)) })
  }
  for (const s of summary) {
    const mine = lines.filter((l) => l.area === s.area && l.component === s.item)
    const total = mine.reduce((a, l) => a + l.requiredQty, 0)
    if (!mine.length) flag('summary-orphan', 'review', s.source, `Summary row “${s.item}” (${s.area}) has no matching detailed rows.`)
    else if (total !== s.totalQty) flag('summary-mismatch', 'review', s.source, `Summary total ${s.totalQty} differs from the detailed rows' total ${total}.`)
  }
  for (const key of new Set(lines.map((l) => `${l.area}|${l.component}`))) if (!summary.some((s) => `${s.area}|${s.item}` === key)) flag('summary-missing', 'info', lines.find((l) => `${l.area}|${l.component}` === key)!.source, `No workbook summary row for “${key.split('|')[1]}” in ${key.split('|')[0]}.`)

  /* ── Anchorage Type sheet ───────────────────────────────────────────────── */
  const anchorage: AnchorageSheetRow[] = []
  const codes = new Set(lines.map((l) => l.anchorageType))
  const textNumberRows: number[] = []
  for (let r = 2; r <= at.maxRow; r++) {
    if (!str(cell(at, 'F', r)) && !str(cell(at, 'B', r))) continue
    const source = { sheet: ANCHORAGE_SHEET, row: r }
    const f = num(cell(at, 'C', r)), p = num(cell(at, 'D', r)), b = num(cell(at, 'E', r)), q = cell(at, 'G', r)
    const required = num(q)
    const component = str(cell(at, 'F', r))
    const useCalc = parseCalc(q?.formula ?? null, r, { f, p, b }, (row) => num(cell(at, 'G', row)), ANCHORAGE_COLS)
    anchorage.push({ id: `anc:${r}`, source, footingType: str(cell(at, 'A', r)), anchorageType: str(cell(at, 'B', r)), footings: f, plinths: p, bolts: b, component, category: categoryOf(component), requiredQty: required, calc: useCalc, grade: num(cell(at, 'H', r)), sourceStatus: str(cell(at, 'I', r)) })
    if (!str(cell(at, 'A', r))) flag('anchorage-no-footing-type', 'review', source, 'No footing type on this row; imported as written.')
    if (['C', 'D', 'E', 'G'].some((c) => isTextNumber(cell(at, c, r)))) textNumberRows.push(r)
    if (useCalc.kind === 'entered' && required !== null) flag('entered-quantity', 'info', source, 'Quantity was typed in, not calculated.')
    if (useCalc.kind === 'inputs' || useCalc.kind === 'derived') { if (useCalc.recomputed !== null && required !== null && useCalc.recomputed !== required) flag('quantity-mismatch', 'review', source, `Workbook value ${required} differs from its formula (${useCalc.expression}) which gives ${useCalc.recomputed}.`) }
    if (f === 0) flag('zero-footings', 'review', source, 'This row has 0 footings but lists a quantity; imported as written.')
  }
  if (textNumberRows.length) flag('number-stored-as-text', 'info', { sheet: ANCHORAGE_SHEET, row: textNumberRows[0] }, `${textNumberRows.length} rows on the Anchorage Type sheet store counts or quantities as text (first: row ${textNumberRows[0]}); they were read as numbers.`)
  if (anchorage.length) flag('anchorage-sheet-unlinked', 'review', { sheet: ANCHORAGE_SHEET, row: 1 },
    `The Anchorage Type sheet has no Area column and its codes (${[...new Set(anchorage.map((a) => a.anchorageType))].slice(0, 6).join(', ')}…) do not appear on the Material List (${[...codes].slice(0, 3).join(', ')}…). ` +
    `Its ${anchorage.length} rows are kept as reference and are not counted in any requirement or total.`)

  return { lines, summary, anchorage, flags, counts: { materialRows: lines.length, summaryRows: summary.length, anchorageRows: anchorage.length, flags: flags.length, blankRowsSkipped, commentsRead } }
}

export async function importWorkbookFile(bytes: Uint8Array): Promise<ParsedTracker> {
  return parseTracker(await readWorkbook(bytes))
}

export async function fingerprint(bytes: Uint8Array): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}
