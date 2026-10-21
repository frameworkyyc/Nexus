import type { ReactNode } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useIsServer } from '@/lib/dataSource'

/** Screens built on demonstration records. With saved data there is nothing real behind them yet, so they say so. */
export function DemoOnly({ children }: { children: ReactNode }) {
  if (useIsServer()) return <EmptyState title="Not available with saved data yet" description="Procurement, fabrication and handover tracking have not been connected to saved project records." />
  return <>{children}</>
}
