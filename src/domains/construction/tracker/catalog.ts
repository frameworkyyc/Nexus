import type { ConstructionState } from '../types'
import { supplierKey, type SupplierRecord } from './suppliers'
import type { TrackerLine, TrackerState } from './types'

/**
 * The project records a material can point at, gathered from where they already live: construction areas and foundations, and the
 * anchorage library. Nothing here is a separate list — it is a read-only view over those records, so materials, construction,
 * survey and QA/QC all agree. Anchorage codes that exist only in the imported workbook are offered too (id `wb:<code>`) unless
 * the project library already defines the same code.
 */
export interface CatalogArea { id: string; name: string; archived: boolean }
export interface CatalogFoundation { id: string; areaId: string; number: string; description: string; archived: boolean }
export interface CatalogAnchorage { id: string; code: string; description: string; foundationIds: string[]; source: 'project' | 'workbook'; archived: boolean }
export interface Catalog { areas: CatalogArea[]; foundations: CatalogFoundation[]; anchorage: CatalogAnchorage[] }

export type CatalogSource = Pick<ConstructionState, 'areas' | 'foundations' | 'plinths' | 'anchorageTypes'>
export const emptyCatalog = (): Catalog => ({ areas: [], foundations: [], anchorage: [] })

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
export const WORKBOOK_ANCHORAGE_PREFIX = 'wb:'

export function buildCatalog(c: CatalogSource, t: Pick<TrackerState, 'lines' | 'anchorage'>, projectId?: string): Catalog {
  const areas = c.areas.filter((a) => !projectId || a.projectId === projectId).sort((a, b) => a.sequence - b.sequence).map((a): CatalogArea => ({ id: a.id, name: a.name, archived: !!a.archived }))
  const areaIds = new Set(areas.map((a) => a.id))
  const foundations = c.foundations.filter((f) => areaIds.has(f.areaId)).map((f): CatalogFoundation => ({ id: f.id, areaId: f.areaId, number: f.number, description: f.description, archived: !!f.archived }))
  const byNumber = new Map<string, CatalogFoundation[]>()
  for (const f of foundations) byNumber.set(norm(f.number), [...(byNumber.get(norm(f.number)) ?? []), f])
  const anchorage = new Map<string, CatalogAnchorage>()
  for (const a of c.anchorageTypes.filter((x) => !projectId || !x.projectId || x.projectId === projectId)) anchorage.set(norm(a.code), { id: a.id, code: a.code, description: a.description, foundationIds: [], source: 'project', archived: !!a.archived })
  const link = (code: string, foundationText: string, projectOnly = false) => {
    const entry = anchorage.get(norm(code))
    if (!entry || projectOnly) return
    for (const f of byNumber.get(norm(foundationText)) ?? []) if (!entry.foundationIds.includes(f.id)) entry.foundationIds.push(f.id)
  }
  for (const p of c.plinths) {
    const type = p.anchorageTypeId ? c.anchorageTypes.find((a) => a.id === p.anchorageTypeId) : undefined
    const entry = type && anchorage.get(norm(type.code))
    if (entry && foundations.some((f) => f.id === p.foundationId) && !entry.foundationIds.includes(p.foundationId)) entry.foundationIds.push(p.foundationId)
  }
  for (const l of t.lines) {
    if (!l.anchorageType) continue
    if (!anchorage.has(norm(l.anchorageType))) anchorage.set(norm(l.anchorageType), { id: `${WORKBOOK_ANCHORAGE_PREFIX}${l.anchorageType}`, code: l.anchorageType, description: 'From the imported workbook', foundationIds: [], source: 'workbook', archived: false })
    link(l.anchorageType, l.footingType)
  }
  for (const r of t.anchorage) if (r.anchorageType && !anchorage.has(norm(r.anchorageType))) anchorage.set(norm(r.anchorageType), { id: `${WORKBOOK_ANCHORAGE_PREFIX}${r.anchorageType}`, code: r.anchorageType, description: 'From the imported workbook', foundationIds: [], source: 'workbook', archived: false })
  return { areas, foundations, anchorage: [...anchorage.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })) }
}

export const foundationsOfArea = (cat: Catalog, areaId: string | null | undefined, includeArchived = false) =>
  cat.foundations.filter((f) => f.areaId === areaId && (includeArchived || !f.archived)).sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }))

/** Anchorage options with the types used on the selected foundation first. */
export function anchorageFor(cat: Catalog, foundationId: string | null | undefined) {
  const here = (a: CatalogAnchorage) => !!foundationId && a.foundationIds.includes(foundationId)
  return cat.anchorage.filter((a) => !a.archived).sort((a, b) => Number(here(b)) - Number(here(a)) || a.code.localeCompare(b.code, 'en', { numeric: true })).map((a) => ({ ...a, onFoundation: here(a) }))
}

export interface Display { area: string; foundation: string; anchorage: string; supplier: string }
const byId = <T extends { id: string }>(xs: T[], id?: string | null) => (id ? xs.find((x) => x.id === id) : undefined)

/** Names for a material today: from the linked record when it has one (so renames show everywhere), else the value as entered. */
export function displayOf(l: TrackerLine, cat: Catalog, suppliers: SupplierRecord[]): Display {
  return {
    area: byId(cat.areas, l.areaId)?.name ?? l.area,
    foundation: byId(cat.foundations, l.foundationId)?.number ?? l.footingType,
    anchorage: byId(cat.anchorage, l.anchorageTypeId)?.code ?? l.anchorageType,
    supplier: byId(suppliers, l.supplierId)?.name ?? l.supplier ?? '',
  }
}

/** Lines with names refreshed from their linked records, for lists, filters and export. Records themselves are not changed. */
export function resolveLines(lines: TrackerLine[], cat: Catalog, suppliers: SupplierRecord[]): TrackerLine[] {
  return lines.map((l) => {
    if (!l.areaId && !l.foundationId && !l.anchorageTypeId && !l.supplierId) return l
    const d = displayOf(l, cat, suppliers)
    return d.area === l.area && d.foundation === l.footingType && d.anchorage === l.anchorageType && d.supplier === (l.supplier ?? '') ? l : { ...l, area: d.area, footingType: d.foundation, anchorageType: d.anchorage, supplier: d.supplier }
  })
}

/* ── Legacy values ─────────────────────────────────────────────────────── */

export interface LegacyIssue { lineId: string; field: 'area' | 'foundation' | 'anchorage' | 'supplier'; value: string; /** An exact, unambiguous match in the project records, if there is one. */ matchId: string | null; matchLabel: string | null }

/**
 * Text values on a material that are not linked to a project record. Workbook lines keep their source area, footing and anchorage as
 * written (they are source facts, not entries), so only a Nexus-entered supplier can be unlinked there.
 */
export function legacyIssues(l: TrackerLine, cat: Catalog, suppliers: SupplierRecord[]): LegacyIssue[] {
  const out: LegacyIssue[] = []
  const issue = (field: LegacyIssue['field'], value: string, matches: { id: string; label: string }[]) =>
    out.push({ lineId: l.id, field, value, matchId: matches.length === 1 ? matches[0].id : null, matchLabel: matches.length === 1 ? matches[0].label : null })
  if (l.origin === 'manual') {
    let areaId = l.areaId ?? null
    if (!areaId && l.area) { const m = cat.areas.filter((a) => norm(a.name) === norm(l.area)); issue('area', l.area, m.map((a) => ({ id: a.id, label: a.name }))); if (m.length === 1) areaId = m[0].id }
    if (!l.foundationId && l.footingType) {
      const m = cat.foundations.filter((f) => norm(f.number) === norm(l.footingType) && (!areaId || f.areaId === areaId))
      issue('foundation', l.footingType, m.map((f) => ({ id: f.id, label: f.number })))
    }
    if (!l.anchorageTypeId && l.anchorageType) issue('anchorage', l.anchorageType, cat.anchorage.filter((a) => norm(a.code) === norm(l.anchorageType)).map((a) => ({ id: a.id, label: a.code })))
  }
  if (!l.supplierId && l.supplier) issue('supplier', l.supplier, suppliers.filter((s) => !s.archived && supplierKey(s.name) === supplierKey(l.supplier ?? '')).map((s) => ({ id: s.id, label: s.name })))
  return out
}
