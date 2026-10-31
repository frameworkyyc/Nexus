import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { DemoBadge } from './DemoBadge'
import { clearSyncError, updatedLabel, useBackend, useSyncStatus } from '@/lib/dataSource'

/** What the user needs to know about where their data lives and whether the last change is safely saved. */
export function SyncIndicator() {
  const { mode, environment, readOnly, asOf } = useBackend()
  const sync = useSyncStatus()
  if (mode === 'demo' && IS_PUBLIC_DEMO) return <DemoBadge />
  if (mode === 'demo') return <span className="hidden rounded-nx border border-line px-2 py-0.5 text-xs text-muted sm:inline" title="Fictional data kept in this browser only. Nothing here is saved to the server.">Demonstration data</span>
  if (mode !== 'server') return null
  if (readOnly) return <span className="rounded-nx border border-line px-2 py-0.5 text-xs font-medium text-ink" role="status" title={`This is the public, view-only version of Nexus. It shows project data${updatedLabel(asOf)} and cannot be changed here.`}>View only</span>
  const env = environment && environment !== 'unknown' ? ` · ${environment}` : ''
  if (sync.error) {
    return <button onClick={clearSyncError} className="max-w-[16rem] truncate text-xs text-bad" role="alert" title={sync.error}>Not saved — {sync.error.replace(/^Not saved:\s*/, '')}</button>
  }
  if (sync.pending > 0) return <span className="text-xs text-muted" role="status">Saving…</span>
  return <span className="text-xs text-muted" role="status" title={sync.lastSavedAt ? `Last saved ${new Date(sync.lastSavedAt).toLocaleTimeString('en-CA')}` : 'Connected to the server'}>{sync.lastSavedAt ? 'All changes saved' : 'Saved data'}{env}</span>
}
