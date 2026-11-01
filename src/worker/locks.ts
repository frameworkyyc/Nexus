import { getDef } from '@/domains/construction/config'
import { isProductionEnv, LOCKED_IN_PRODUCTION } from '@/shared/lock'
import type { Activity } from '@/domains/construction/types'

/**
 * Why a command is refused because its module is "Coming Soon" in production, or null. Only production locks anything; QA/QC and Civil /
 * Earthworks are activity categories, so the activity being updated decides.
 */
export function lockedCommandProblem(environment: string | undefined, module: string, name: string, args: unknown[], state: unknown): string | null {
  if (!isProductionEnv(environment)) return null
  const soon = (label: string) => `${label} is coming soon and is not available yet.`
  if (module === 'fleet' && name === 'reassignVehicle') return soon(LOCKED_IN_PRODUCTION['project-fleet'])
  if (module === 'construction' && name === 'updateActivity') {
    const a = ((state as { activities?: Activity[] }).activities ?? []).find((x) => x.id === args[0])
    if (a) {
      const category = getDef(a.scope, a.key).category
      if (category === 'qaqc') return soon(LOCKED_IN_PRODUCTION.qaqc)
      if (category === 'civil') return soon(LOCKED_IN_PRODUCTION.civil)
    }
  }
  return null
}
