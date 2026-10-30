import type { Accessory, AccessoryType, FleetState } from './types'

/** Two names are the same type when they differ only by capitalization or spacing. Similar spellings stay distinct types. */
export const cleanTypeName = (n: string) => n.trim().replace(/\s+/g, ' ')
export const accessoryTypeKey = (n: string) => cleanTypeName(n).toLowerCase()

export const typesOf = (s: FleetState): AccessoryType[] => s.accessoryTypes ?? []
export const findAccessoryType = (s: FleetState, name: string) => typesOf(s).find((t) => accessoryTypeKey(t.name) === accessoryTypeKey(name))

/** What an accessory is called everywhere: its type's current name, or the custom name an older record was given. */
export const accessoryLabel = (s: FleetState, a: Pick<Accessory, 'typeId' | 'name'>): string =>
  a.name.trim() || typesOf(s).find((t) => t.id === a.typeId)?.name || 'Accessory'

/** How many accessory records (installed or not, on any asset) use each type. */
export function accessoryTypeUsage(s: FleetState): Map<string, number> {
  const m = new Map<string, number>()
  for (const a of s.accessories) if (a.typeId) m.set(a.typeId, (m.get(a.typeId) ?? 0) + 1)
  return m
}
