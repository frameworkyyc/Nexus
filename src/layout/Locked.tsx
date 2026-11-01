import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { useBackend } from '@/lib/dataSource'
import { isLocked, LOCKED_IN_PRODUCTION, type LockedId } from '@/shared/lock'

/** Wraps a route that is "Coming Soon" in production. Staging and the demo render the page as usual; the server refuses the matching changes too. */
export function Locked({ id, children }: { id: LockedId; children: ReactNode }) {
  const { environment } = useBackend()
  if (!isLocked(id, environment)) return <>{children}</>
  return (
    <>
      <PageHeader title={LOCKED_IN_PRODUCTION[id]} />
      <EmptyState title="Coming Soon" description={`${LOCKED_IN_PRODUCTION[id]} isn’t available in this release yet. Procurement, Construction and Survey are ready to use.`} action={<Lock size={20} strokeWidth={1.5} className="mx-auto text-muted" aria-hidden="true" />} />
    </>
  )
}
