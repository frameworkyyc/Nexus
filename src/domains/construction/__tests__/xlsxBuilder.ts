/** Builds a tiny .xlsx (stored zip) for tests, so import logic is exercised without any real project data. */
const enc = new TextEncoder()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface TestCell { v?: string | number; f?: string; t?: 'text' }
export interface TestSheet { name: string; rows: Record<string, TestCell>; comments?: Record<string, string> }

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function zip(files: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30)); local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameB.length, true)
    parts.push(new Uint8Array(local.buffer), nameB, data)
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nameB.length, true); cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), nameB)
    offset += 30 + nameB.length + data.length
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let o = 0
  for (const p of all) { out.set(p, o); o += p.length }
  return out
}

export function buildWorkbook(sheets: TestSheet[]): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<workbook xmlns:r="r"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  }
  sheets.forEach((s, i) => {
    const byRow = new Map<number, [string, TestCell][]>()
    for (const [ref, c] of Object.entries(s.rows)) { const r = Number(/\d+/.exec(ref)![0]); byRow.set(r, [...(byRow.get(r) ?? []), [ref, c]]) }
    const rows = [...byRow].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.map(([ref, c]) => {
      const f = c.f ? `<f>${esc(c.f)}</f>` : ''
      if (typeof c.v === 'string') return `<c r="${ref}" t="inlineStr">${f}<is><t>${esc(c.v)}</t></is></c>`
      return `<c r="${ref}">${f}${c.v === undefined ? '' : `<v>${c.v}</v>`}</c>`
    }).join('')}</row>`).join('')
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`
    if (s.comments) {
      files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = `<Relationships><Relationship Id="rId1" Type="x/comments" Target="../comments${i + 1}.xml"/></Relationships>`
      files[`xl/comments${i + 1}.xml`] = `<comments><commentList>${Object.entries(s.comments).map(([ref, t]) => `<comment ref="${ref}"><text><r><t>${esc(t)}</t></r></text></comment>`).join('')}</commentList></comments>`
    }
  })
  return zip(files)
}

const ML_HEAD = ['Area', 'Footing Type', 'Anchorage Type', '# of Ftngs', '# of Plinths', '# of Bolts', 'Component', "Req'd Quantity", 'Status']
const SUM_HEAD = ['Area', 'Item', 'Total Qty', 'Status']
const AT_HEAD = ['Footing Type', 'Anchorage Type', '# of Ftngs', '# of Plinths', '# of Bolts', 'Component', "Req'd Quantity", 'Grade', 'Status']
const put = (cells: Record<string, TestCell>, cols: string, row: number, values: (TestCell | string | number | undefined)[]) =>
  values.forEach((v, i) => { if (v !== undefined) cells[`${cols[i]}${row}`] = typeof v === 'object' ? v : { v } })

/** A small invented tracker: two areas, a bolt group with hardware, an embed plate, one comment, one odd multiplier. */
export function sampleWorkbook(): Uint8Array {
  const ml: Record<string, TestCell> = {}
  put(ml, 'ABCDEFGHI', 1, ML_HEAD); put(ml, 'KLMN', 1, SUM_HEAD)
  const grp = (r: number, area: string, ft: string, at: string, nf: number, np: number, nb: number, status = 'Delivered') => {
    put(ml, 'ABCDEFGHI', r, [area, ft, at, nf, np, nb, `${at} Plywood Template`, { v: nf * np, f: `D${r}*E${r}` }, status])
    put(ml, 'ABCDEFGHI', r + 1, [area, ft, at, nf, np, nb, `${at} Sole Plate 6x300x300`, { v: nf * np, f: `D${r + 1}*E${r + 1}` }, status])
    put(ml, 'ABCDEFGHI', r + 2, [area, ft, at, nf, np, nb, '3/4" x 460mm Bolt', { v: nf * np * nb, f: `D${r + 2}*E${r + 2}*F${r + 2}` }, status])
    put(ml, 'ABCDEFGHI', r + 3, [area, ft, at, nf, np, nb, '3/4" Washer', { v: nf * np * nb * 2, f: `H${r + 2}*2` }, status])
    put(ml, 'ABCDEFGHI', r + 4, [area, ft, at, nf, np, nb, '3/4" Nut', { v: nf * np * nb * 6, f: `H${r + 2}*6` }, status])
  }
  grp(2, 'North Area', 'F-01', 'T1', 2, 3, 4)            // rows 2-6
  grp(7, 'North Area', 'F-02', 'T1', 1, 1, 4, 'Pending') // rows 7-11
  put(ml, 'ABCDEFGHI', 12, ['South Area', 'F-10', 'N/A', 1, 1, 0, 'Embed Plate 10x254x254', 1, 'Pending']) // typed-in quantity
  put(ml, 'ABCDEFGHI', 13, ['South Area', 'F-11', 'T9', 1, 1, 4, '1" x 300mm Bolt', { v: 4, f: 'D13*E13*F13' }, 'Delivered'])
  put(ml, 'ABCDEFGHI', 14, ['South Area', 'F-11', 'T9', 1, 1, 4, '1" Washer', { v: 24, f: 'H13*6' }, 'Delivered']) // washer ×6 (unusual)
  put(ml, 'ABCDEFGHI', 15, ['South Area', 'F-11', 'T9', 1, 1, 4, '1" Nut', { v: 8, f: 'H13*2' }, 'Delivered'])
  // Rows 16+: blank rows that still carry a formula, as in the real workbook's table.
  ml.H16 = { v: 0, f: 'D16*E16' }
  // Area summary (K:N), as the workbook computes it.
  const sums: [string, string, number, string][] = [
    ['North Area', 'T1 Plywood Template', 7, 'Pending'], ['North Area', 'T1 Sole Plate 6x300x300', 7, 'Pending'], ['North Area', '3/4" x 460mm Bolt', 28, 'Pending'],
    ['North Area', '3/4" Washer', 56, 'Pending'], ['North Area', '3/4" Nut', 168, 'Pending'], ['South Area', 'Embed Plate 10x254x254', 1, 'Pending'],
    ['South Area', '1" x 300mm Bolt', 4, 'Delivered'], ['South Area', '1" Washer', 24, 'Delivered'], ['South Area', '1" Nut', 8, 'Delivered'],
  ]
  sums.forEach((s, i) => put(ml, 'KLMN', i + 2, s))
  const at: Record<string, TestCell> = {}
  put(at, 'ABCDEFGHI', 1, AT_HEAD)
  put(at, 'ABCDEFGHI', 2, [undefined, 'A', undefined, undefined, '4', 'Anchorage Type A Template', 4, undefined, 'Pending'])
  put(at, 'ABCDEFGHI', 3, ['1C', 'A', '2', '1', '4', '1" Bolt', { v: 8, f: 'C3*D3*E3' }, 36, 'Pending'])
  return buildWorkbook([
    { name: 'Anchorage Type', rows: at },
    { name: 'Material List', rows: ml, comments: { G4: 'Pat Example:\nOrdered as:\n3/4" x 470mm Bolt' } },
  ])
}
