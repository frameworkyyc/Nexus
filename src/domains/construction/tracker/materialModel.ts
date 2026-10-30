import { allLines } from './audit'
import { displayOf, foundationsOfArea, type Catalog } from './catalog'
import type { SupplierRecord } from './suppliers'
import type { ComponentCategory, TrackerLine, TrackerState } from './types'

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())
export const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
export const key = (area: string, location: string, name: string, spec: string, size: string) => [area, location, name, spec, size].map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).join('|')
const MAX_TEXT = 500

export const CATEGORIES: ComponentCategory[] = ['bolt', 'nut', 'washer', 'sole-plate', 'template', 'embed-plate', 'other']
export const CLAIMED_STATUSES = ['', 'Pending', 'Delivered'] as const

/**
 * What a person enters. Area, foundation, anchorage type and supplier are chosen from existing records and held by id ('' = none);
 * the names a record shows are looked up from those ids, so a rename never breaks the link.
 */
export interface MaterialInput {
  areaId: string
  foundationId: string
  anchorageTypeId: string
  category: ComponentCategory
  name: string
  description: string
  specification: string
  size: string
  requiredQty: number
  unit: string
  supplierId: string
  poRef: string
  expectedDate: string
  /** What someone says about delivery without a receipt: '' | 'Pending' | 'Delivered'. Never turned into a receipt. */
  claimedStatus: string
  notes: string
}

/** The project records a change is checked against. */
export interface Env { catalog: Catalog; suppliers: SupplierRecord[] }

const exists = <T extends { id: string }>(xs: T[], id: string) => xs.some((x) => x.id === id)

/**
 * Why a material (or a change to one) cannot be saved, or null. `current` is the record being edited: a value it already holds is
 * left alone even if that record has since been archived, so editing something else never fails because of history.
 */
export function validateMaterial(m: Partial<MaterialInput>, env: Env, current?: TrackerLine): string | null {
  const partial = !!current
  if (!partial || m.areaId !== undefined) {
    if (!m.areaId) return 'Select an area.'
    if (!exists(env.catalog.areas, m.areaId)) return 'Select an area from the project’s areas.'
  }
  if (!partial || m.name !== undefined) if (!clean(m.name)) return 'Material name is required.'
  for (const k of ['name', 'description', 'specification', 'size', 'unit', 'poRef', 'notes'] as const) if (typeof m[k] === 'string' && (m[k] as string).length > MAX_TEXT) return `${k} is too long (500 characters at most).`
  if (m.category !== undefined && !CATEGORIES.includes(m.category)) return 'Choose a category.'
  if (!partial || m.requiredQty !== undefined) {
    if (typeof m.requiredQty !== 'number' || !Number.isFinite(m.requiredQty)) return 'Quantity required is a number.'
    if (!Number.isInteger(m.requiredQty) || m.requiredQty < 1) return 'Quantity required must be a whole number, 1 or more.'
    if (m.requiredQty > 10_000_000) return 'Quantity required is too large.'
  }
  if (m.expectedDate && !validDate(m.expectedDate)) return 'Enter a valid expected delivery date.'
  if (m.claimedStatus !== undefined && !(CLAIMED_STATUSES as readonly string[]).includes(m.claimedStatus)) return 'Delivery status must be Pending, Delivered or not stated.'
  const areaId = m.areaId ?? current?.areaId ?? ''
  const foundationId = m.foundationId !== undefined ? m.foundationId : current?.foundationId ?? ''
  if (m.foundationId !== undefined || m.areaId !== undefined) {
    if (foundationId) {
      const f = env.catalog.foundations.find((x) => x.id === foundationId)
      if (!f) return 'Select a foundation from the area’s foundations.'
      if (areaId && f.areaId !== areaId) return 'That foundation belongs to a different area. Choose a foundation in the selected area.'
      if (f.archived && foundationId !== current?.foundationId) return 'That foundation is archived.'
      if (!areaId && !current) return 'Select an area first.'
    }
  }
  if (m.anchorageTypeId && !exists(env.catalog.anchorage, m.anchorageTypeId)) return 'Select an anchorage type from the project’s library.'
  if (m.supplierId) {
    const sup = env.suppliers.find((x) => x.id === m.supplierId)
    if (!sup) return 'Select a supplier from the supplier directory.'
    if (sup.archived && m.supplierId !== current?.supplierId) return 'That supplier is archived.'
  }
  return null
}

/** The record a new material would duplicate, if any: same area, foundation, name, specification and size (workbook lines included). */
export function findDuplicate(s: TrackerState, env: Env, m: Pick<MaterialInput, 'areaId' | 'foundationId' | 'name' | 'specification' | 'size'>, exceptId?: string): TrackerLine | undefined {
  const area = env.catalog.areas.find((a) => a.id === m.areaId)?.name ?? ''
  const foundation = env.catalog.foundations.find((f) => f.id === m.foundationId)?.number ?? ''
  const k = key(area, foundation, clean(m.name), clean(m.specification), clean(m.size))
  return allLines(s).find((l) => {
    if (l.archived || l.id === exceptId) return false
    const d = displayOf(l, env.catalog, env.suppliers)
    return key(d.area, d.foundation, l.component, l.specification ?? '', l.size ?? '') === k
  })
}

export const keyOf = (m: Pick<MaterialInput, 'areaId' | 'foundationId' | 'name' | 'specification' | 'size'>) => [m.areaId, m.foundationId, clean(m.name), clean(m.specification), clean(m.size)].map((x) => x.toLowerCase()).join('|')

export { foundationsOfArea }

/**
 * The supplier a new material gets. A row's own choice wins; otherwise a supplier the person picked (or deliberately cleared) for the
 * whole entry; otherwise the category's preferred supplier. So changing a category or a shared default never replaces a manual choice.
 */
export const effectiveSupplier = (shared: { id: string; manual: boolean }, rowOverride: string | null, preferred: string): string => rowOverride ?? (shared.manual ? shared.id : preferred)
