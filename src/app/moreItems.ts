import type { LucideIcon } from 'lucide-react'
import { toolNodes } from './navTree'

export interface MoreItem { id: string; label: string; to: string; icon: LucideIcon }

/** The phone and desktop "More" lists: the same tools as the sidebar's secondary section, flattened (Setup opens its hub page). */
export function moreItems(projectId: string | null, server: boolean): MoreItem[] {
  return toolNodes(projectId, server).map(({ id, label, to, icon }) => ({ id, label, to, icon: icon! }))
}
