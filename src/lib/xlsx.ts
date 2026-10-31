/**
 * Minimal read-only .xlsx reader (zip + SpreadsheetML), written so the app needs no spreadsheet dependency.
 * It reads cell values, formulas and cell comments only — enough to import a tracker with full traceability.
 * It runs entirely in the browser: the file is never uploaded anywhere.
 */
export interface XCell { ref: string; col: string; row: number; value: string | number | null; formula: string | null }
export interface XSheet { name: string; cells: Map<string, XCell>; comments: Map<string, string>; maxRow: number }
export interface XWorkbook { sheets: XSheet[] }

const td = new TextDecoder()

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Reads a zip's central directory and returns every entry's bytes (stored or deflated). */
async function unzip(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file (zip directory not found).')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory.')
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = td.decode(data.subarray(p + 46, p + 46 + nameLen))
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = data.subarray(start, start + size)
    if (!name.endsWith('/')) {
      if (method === 0) out.set(name, raw)
      else if (method === 8) out.set(name, await inflateRaw(raw))
      else throw new Error(`Unsupported zip compression (${method}).`)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const decodeEntities = (s: string) =>
  s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('')

const colToNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
export { colToNum }

function parseSheet(name: string, xml: string, shared: string[], comments: Map<string, string>): XSheet {
  const cells = new Map<string, XCell>()
  let maxRow = 0
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attr(m[1], 'r')
    if (!ref) continue
    const [, col, rowStr] = /^([A-Z]+)(\d+)$/.exec(ref) ?? []
    if (!col) continue
    const body = m[2] ?? ''
    const t = attr(m[1], 't')
    const fm = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(body)
    const vRaw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
    let value: string | number | null = null
    if (t === 's' && vRaw !== undefined) value = shared[Number(vRaw)] ?? null
    else if (t === 'inlineStr') value = textOf(body)
    else if (t === 'str' || t === 'e') value = vRaw === undefined ? null : decodeEntities(vRaw)
    else if (t === 'b') value = vRaw === '1' ? 1 : 0
    else if (vRaw !== undefined && vRaw !== '') value = Number(vRaw)
    const formula = fm ? (fm[1] !== undefined ? decodeEntities(fm[1]) : null) : null
    if (value === null && formula === null) continue
    const row = Number(rowStr)
    maxRow = Math.max(maxRow, row)
    cells.set(ref, { ref, col, row, value, formula })
  }
  return { name, cells, comments, maxRow }
}

export async function readWorkbook(input: ArrayBuffer | Uint8Array): Promise<XWorkbook> {
  const files = await unzip(input instanceof Uint8Array ? input : new Uint8Array(input))
  const text = (path: string) => { const f = files.get(path); return f ? td.decode(f) : null }
  const wbXml = text('xl/workbook.xml')
  const relsXml = text('xl/_rels/workbook.xml.rels')
  if (!wbXml || !relsXml) throw new Error('This is not a valid .xlsx workbook.')
  const rels = new Map([...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id')!, attr(m[0], 'Target')!]))
  const sstXml = text('xl/sharedStrings.xml')
  const shared = sstXml ? [...sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : []
  const sheets: XSheet[] = []
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const sheetName = decodeEntities(attr(m[0], 'name') ?? '')
    const target = rels.get(attr(m[0], 'r:id') ?? '')
    if (!target) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const xml = text(path)
    if (!xml) continue
    // Cell comments live in a separate part linked from the sheet's own relationships.
    const comments = new Map<string, string>()
    const sheetRels = text(path.replace('worksheets/', 'worksheets/_rels/') + '.rels')
    const cRel = sheetRels && [...sheetRels.matchAll(/<Relationship\b[^>]*>/g)].map((r) => r[0]).find((r) => /\/comments$/.test(attr(r, 'Type') ?? ''))
    const cXml = cRel ? text(`xl/${(attr(cRel, 'Target') ?? '').replace(/^\.\.\//, '')}`) : null
    if (cXml) for (const c of cXml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) { const r = attr(c[1], 'ref'); if (r) comments.set(r, textOf(c[2])) }
    sheets.push(parseSheet(sheetName, xml, shared, comments))
  }
  return { sheets }
}
