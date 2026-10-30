import type { ReactNode } from 'react'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { OrganizationSetup } from '@/domains/construction/pages/Setup'
import { useConstruction } from '@/domains/construction/store'
import { useIsServer } from '@/lib/dataSource'

/** A new installation has no organization. Until one is created the only screen is the welcome / organization setup. */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { state } = useConstruction()
  const server = useIsServer()
  if (!IS_PUBLIC_DEMO && server && !state.company.id) return <OrganizationSetup />
  return <>{children}</>
}
