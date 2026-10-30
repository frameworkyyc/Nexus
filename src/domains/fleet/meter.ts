import { accessoryTypeKey, cleanTypeName } from './accessoryTypes'
import type { FleetCategory, FleetState, MeterUnit, Vehicle } from './types'

/** Names of categories are compared ignoring capitalization and spacing, like accessory types. */
export const categoryKey = accessoryTypeKey
export const cleanCategoryName = cleanTypeName

export const categoriesOf = (s: FleetState): FleetCategory[] => s.categories ?? []
export const meterUnitOfVehicle = (v: Pick<Vehicle, 'meterUnit'> | undefined): MeterUnit => v?.meterUnit ?? 'km'
export const meterUnitOf = (s: FleetState, vehicleId: string): MeterUnit => meterUnitOfVehicle(s.vehicles.find((v) => v.id === vehicleId))

export const UNIT_NAME: Record<MeterUnit, string> = { km: 'kilometres', h: 'operating hours' }
export const UNIT_SHORT: Record<MeterUnit, string> = { km: 'km', h: 'h' }
/** 12,345 km · 1,234.5 h */
export const fmtMeter = (n: number, unit: MeterUnit = 'km') => `${n.toLocaleString('en-CA', { maximumFractionDigits: unit === 'h' ? 1 : 0 })} ${UNIT_SHORT[unit]}`
/** Kilometres are whole numbers; operating hours may carry one decimal. */
export const validMeter = (n: number, unit: MeterUnit) => Number.isFinite(n) && (unit === 'h' ? Math.round(n * 10) === n * 10 : Number.isInteger(n))

export type LifespanSource = 'asset' | 'category' | 'none'
export interface Lifespan { value: number | null; unit: MeterUnit; source: LifespanSource; category: FleetCategory | null }

/**
 * The lifespan estimate that applies to an asset, and where it came from: the asset's own estimate wins; otherwise its category's default
 * (only when the category counts in the same unit as the asset's meter); otherwise none. Nothing is ever assumed.
 */
export function lifespanOf(s: FleetState, v: Vehicle): Lifespan {
  const unit = meterUnitOfVehicle(v)
  const category = categoriesOf(s).find((c) => c.id === v.categoryId) ?? null
  if (v.expectedLifeKm !== null) return { value: v.expectedLifeKm, unit, source: 'asset', category }
  if (category && category.defaultLife !== null && category.meterUnit === unit) return { value: category.defaultLife, unit, source: 'category', category }
  return { value: null, unit, source: 'none', category }
}
