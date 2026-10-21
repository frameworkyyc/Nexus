import { constructionLocalStore } from '@/domains/construction/store'
import { trackerLocalStore } from '@/domains/construction/tracker/store'
import { fleetLocalStore } from '@/domains/fleet/store'
import type { MigrationBundle } from '@/worker/migrate'

/**
 * What this browser holds from before records were saved on the server (localStorage keys beginning "nexus."), exported so it can
 * be kept as a backup and, if it is real, moved to the server. The construction records in this browser are demonstration data:
 * they are included in the backup file for completeness but are never part of a migration.
 */
export const LOCAL_KEYS = ['nexus.demo.fleet', 'nexus.reef.materialTracker', 'nexus.demo.construction'] as const

export interface LocalSummary { fleet: { vehicles: number; odometer: number; inspections: number; tireSets: number; accessories: number; maintenance: number }; tracker: { lines: number; receipts: number; fileName: string | null }; hasData: boolean }

export function summarizeLocal(): LocalSummary {
  const f = fleetLocalStore.get()
  const t = trackerLocalStore.get()
  const stored = (key: string) => { try { return localStorage.getItem(key) !== null } catch { return false } }
  return {
    fleet: { vehicles: f.vehicles.length, odometer: f.odometer.length, inspections: f.inspections.length, tireSets: f.tireSets.length, accessories: f.accessories.length, maintenance: f.maintenance.length },
    tracker: { lines: t.lines.length, receipts: t.lines.reduce((s, l) => s + l.receipts.length, 0), fileName: t.meta?.fileName ?? null },
    hasData: stored('nexus.demo.fleet') || stored('nexus.reef.materialTracker'),
  }
}

/** The records that can be migrated. Tracker data is included only if a workbook was imported in this browser. */
export function migrationBundle(include: { fleet: boolean; materials: boolean }): MigrationBundle {
  const t = trackerLocalStore.get()
  return {
    format: 'nexus-browser-export', exportedAt: new Date().toISOString(),
    ...(include.fleet ? { fleet: fleetLocalStore.get() } : {}),
    ...(include.materials && t.meta ? { materials: t } : {}),
  }
}

/** A complete copy of everything this browser holds, including demonstration data, for safekeeping. */
export function fullBrowserBackup() {
  const raw: Record<string, unknown> = {}
  for (const k of LOCAL_KEYS) { try { const v = localStorage.getItem(k); if (v) raw[k] = JSON.parse(v) } catch { /* unreadable; skipped */ } }
  return { format: 'nexus-browser-export' as const, exportedAt: new Date().toISOString(), note: 'Complete browser copy. The construction records are fictional demonstration data and are never migrated.', fleet: fleetLocalStore.get(), materials: trackerLocalStore.get().meta ? trackerLocalStore.get() : undefined, demoConstruction: constructionLocalStore.get(), rawStorage: raw }
}

export function clearBrowserCopy(modules: { fleet: boolean; materials: boolean }) {
  if (modules.fleet) localStorage.removeItem('nexus.demo.fleet')
  if (modules.materials) localStorage.removeItem('nexus.reef.materialTracker')
}

export function download(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
