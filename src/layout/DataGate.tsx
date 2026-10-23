import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { getBackend, reloadAll, setViewDemo, startBackend, useBackend } from '@/lib/dataSource'

/** Holds the screens back until the app knows whether it is showing saved or demonstration data, and has loaded it. */
export function DataGate({ children }: { children: ReactNode }) {
  const backend = useBackend()
  useEffect(() => {
    void startBackend()
    // Another device may have saved changes while this tab was in the background.
    const onVisible = () => { if (document.visibilityState === 'visible' && getBackend().mode === 'server') void reloadAll().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  if (backend.mode === 'checking') return <p className="py-24 text-center text-[13px] text-muted" role="status">Loading your data…</p>
  if (backend.mode === 'blocked') {
    return (
      <EmptyState
        title="Sign-in needed"
        description={backend.reason ?? 'This browser is not signed in, so saved data cannot be shown.'}
        action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={() => window.location.reload()}>Reload and sign in</Button><Button variant="ghost" onClick={() => { setViewDemo(true); void startBackend() }}>View demonstration data instead</Button></div>}
      />
    )
  }
  return <>{children}</>
}

