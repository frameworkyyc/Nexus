import type { ComponentCategory, TrackerLine, TrackerState } from './types'
import { allLines } from './audit'

const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime())
export const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
export const key = (area: string, location: string, name: string, spec: string, size: string) => [area, location, name, spec, size].map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).join('|')
const MAX_TEXT = 500

export const CATEGORIES: ComponentCategory[] = ['bolt', 'nut', 'washer', 'sole-plate', 'template', 'embed-plate', 'other']
export const CLAIMED_STATUSES = ['', 'Pending', 'Delivered'] as const

export interface MaterialInput {
  area: string
  location: string // foundation / installation location
  anchorageRef: string
  category: ComponentCategory
  name: string
  description: string
  specification: string
  size: string
  requiredQty: number
  unit: string
  supplier: string
  poRef: string
  expectedDate: string
  /** What someone says about delivery without a receipt: '' | 'Pending' | 'Delivered'. Never turned into a receipt. */
  claimedStatus: string
  notes: string
}


/** Why a material cannot be saved, or null. Shared by add and edit. */
export function validateMaterial(m: Partial<MaterialInput>, partial = false): string | null {
  const need = (k: keyof MaterialInput, label: string) => (partial && m[k] === undefined ? null : !clean(m[k]) ? `${label} is required.` : null)
  const e = need('area', 'Area') ?? need('name', 'Material name')
  if (e) return e
  for (const k of ['area', 'location', 'anchorageRef', 'name', 'description', 'specification', 'size', 'unit', 'supplier', 'poRef', 'notes'] as const) if (typeof m[k] === 'string' && (m[k] as string).length > MAX_TEXT) return `${k} is too long (500 characters at most).`
  if (m.category !== undefined && !CATEGORIES.includes(m.category)) return 'Choose a category.'
  if (!partial || m.requiredQty !== undefined) {
    if (typeof m.requiredQty !== 'number' || !Number.isFinite(m.requiredQty)) return 'Quantity required is a number.'
    if (!Number.isInteger(m.requiredQty) || m.requiredQty < 1) return 'Quantity required must be a whole number, 1 or more.'
    if (m.requiredQty > 10_000_000) return 'Quantity required is too large.'
  }
  if (m.expectedDate && !validDate(m.expectedDate)) return 'Enter a valid expected delivery date.'
  if (m.claimedStatus !== undefined && !(CLAIMED_STATUSES as readonly string[]).includes(m.claimedStatus)) return 'Delivery status must be Pending, Delivered or not stated.'
  return null
}

/** The record a new material would duplicate, if any: same area, location, name, specification and size (workbook lines included). */
export function findDuplicate(s: TrackerState, m: Pick<MaterialInput, 'area' | 'location' | 'name' | 'specification' | 'size'>): TrackerLine | undefined {
  const k = key(clean(m.area), clean(m.location), clean(m.name), clean(m.specification), clean(m.size))
  return allLines(s).find((l) => !l.archived && key(l.area, l.footingType, l.component, l.specification ?? '', l.size ?? '') === k)
}

