import * as construction from '@/domains/construction/actions'
import * as tracker from '@/domains/construction/tracker/actions'
import * as fleet from '@/domains/fleet/actions'

export type ModuleName = 'fleet' | 'materials' | 'construction'
export const MODULE_NAMES: ModuleName[] = ['fleet', 'materials', 'construction']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandCreator = (...args: any[]) => (state: any, ctx?: { actor?: string; now?: string; [k: string]: unknown }) => { state?: any; error?: string }

const onlyFunctions = (mod: Record<string, unknown>, allow?: string[], deny: string[] = []): Record<string, CommandCreator> =>
  Object.fromEntries(Object.entries(mod).filter(([k, v]) => typeof v === 'function' && (!allow || allow.includes(k)) && !deny.includes(k))) as Record<string, CommandCreator>

/**
 * The only changes the server will apply, by module. These are the very reducers the browser uses, so rules and calculations
 * cannot drift apart. Excluded on purpose: clearing the imported tracker (destructive; backups and restore are an operator
 * task) and the demonstration-only construction actions (procurement, fabrication, handover), which have no saved records.
 */
export const SERVER_COMMANDS: Record<ModuleName, Record<string, CommandCreator>> = {
  fleet: onlyFunctions(fleet),
  // An explicit list, so a helper added to the tracker module later can never become a server command by accident.
  materials: onlyFunctions(tracker, ['importTracker', 'addReceipt', 'removeReceipt', 'confirmNoReceipts', 'setOrdered', 'setNotes', 'acknowledgeFlag', 'addMaterials', 'editMaterial', 'bulkEditMaterials', 'archiveMaterials', 'addSupplier', 'renameSupplier', 'archiveSupplier', 'setPreferredSupplier']),
  construction: onlyFunctions(construction, ['updateActivity', 'setFoundationNotes', 'setPlinthNotes', 'createFoundation', 'setProjectStatus', 'renameFoundation', 'editFoundation', 'archiveFoundation', 'createArea']),
}
