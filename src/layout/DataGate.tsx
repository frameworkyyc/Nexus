import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { getBackend, reloadAll, startBackend, useBackend } from '@/lib/dataSource'

/** Holds the screens back until the app knows whether it is showing saved or demonstration data, and has loaded it. */
export function DataGate({ children }: { children: ReactNode }) {
  const backend = useBackend()
  useEffect(() => {
    void startBackend()
    // Another device may have saved changes while this tab was in the background.
    const onVisible = () => { if (document.visibilityState === 'visible' && getBackend().mode === 'server') void reloadAll().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)
    // The public view-only site has no way to be told about a change made elsewhere, so it asks again every minute while the tab is open.
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible' && getBackend().readOnly) void reloadAll().catch(() => {}) }, 60_000)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(poll) }
  }, [])
  if (backend.mode === 'checking') return <p className="py-24 text-center text-[13px] text-muted" role="status">Loading your data…</p>
  if (backend.mode === 'blocked') {
    return (
      <EmptyState
        title="Sign-in needed"
        description={backend.reason ?? 'This browser is not signed in, so saved data cannot be shown.'}
        action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={() => window.location.reload()}>Reload and sign in</Button></div>}
      />
    )
  }
  if (backend.mode === 'unavailable') {
    return (
      <EmptyState
        title="Saved data isn’t set up yet"
        description={`${backend.reason ?? 'The database is not available.'} Nexus keeps every record in its database and never in this browser, so there is nothing to show until that is configured. See docs/OPERATIONS.md for the steps.`}
        action={<Button variant="primary" onClick={() => void startBackend()}>Check again</Button>}
      />
    )
  }
  return <>{children}</>
}

