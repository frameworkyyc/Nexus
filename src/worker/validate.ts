/** Structural checks for data arriving from a browser. The database adds its own CHECK and foreign-key constraints on top. */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => typeof v === 'string'
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

const MAX_ROWS = 5000

export function validateParsedTracker(p: unknown): string | null {
  if (!isObj(p)) return 'The import is not a valid tracker.'
  for (const k of ['lines', 'summary', 'anchorage', 'flags'] as const) {
    if (!Array.isArray(p[k])) return `The import is missing “${k}”.`
    if ((p[k] as unknown[]).length > MAX_ROWS) return `The import has too many ${k}.`
  }
  const source = (s: unknown) => isObj(s) && str(s.sheet) && num(s.row)
  for (const l of p.lines as unknown[]) {
    if (!isObj(l) || !str(l.id) || !source(l.source) || !str(l.area) || !str(l.component) || !str(l.footingType) || !str(l.anchorageType)) return 'A material line is malformed.'
    if (![l.requiredQty, l.footings, l.plinths, l.bolts].every(num) || (l.requiredQty as number) < 0) return `Material line “${String(l.component)}” has an invalid quantity.`
    if (!isObj(l.calc) || !str(l.sourceStatus) || !Array.isArray(l.sourceNotes) || !Array.isArray(l.receipts)) return `Material line “${String(l.component)}” is malformed.`
  }
  for (const r of p.summary as unknown[]) if (!isObj(r) || !str(r.id) || !source(r.source) || !str(r.area) || !str(r.item) || !num(r.totalQty)) return 'A summary row is malformed.'
  for (const r of p.anchorage as unknown[]) if (!isObj(r) || !str(r.id) || !source(r.source) || !str(r.component) || !isObj(r.calc)) return 'An anchorage row is malformed.'
  for (const f of p.flags as unknown[]) if (!isObj(f) || !str(f.id) || !source(f.source) || !str(f.message) || !['review', 'info'].includes(String(f.severity))) return 'A review flag is malformed.'
  const ids = new Set((p.lines as { id: string }[]).map((l) => l.id))
  if (ids.size !== (p.lines as unknown[]).length) return 'The import contains duplicate material line ids.'
  return null
}

export function validateImportMeta(m: unknown): string | null {
  return isObj(m) && str(m.fileName) && num(m.fileSize) && (m.sha256 === null || str(m.sha256)) ? null : 'The import details are malformed.'
}

export const isRequestId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v)
