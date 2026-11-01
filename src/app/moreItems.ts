import type { LucideIcon } from 'lucide-react'
import { applyLocks, toolNodes } from './navTree'

export interface MoreItem { id: string; label: string; to: string; icon: LucideIcon; locked?: boolean }

/** The phone and desktop "More" lists: the same tools as the sidebar's secondary section, flattened (Setup opens its hub page). */
export function moreItems(projectId: string | null, server: boolean, environment?: string): MoreItem[] {
  return applyLocks(toolNodes(projectId, server), environment).map(({ id, label, to, icon, locked }) => ({ id, label, to, icon: icon!, locked }))
}
