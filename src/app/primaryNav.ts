import { BarChart3, Building2, ShoppingCart, Truck, type LucideIcon } from 'lucide-react'
import { paths } from '@/domains/construction/paths'

export type PrimaryId = 'status' | 'materials' | 'foundation' | 'fleet'

export interface PrimaryDestination {
  id: PrimaryId
  label: string
  /** Short label for the phone's bottom bar. */
  short: string
  icon: LucideIcon
  /** Whether the destination needs a project. Fleet does not. */
  needsProject: boolean
  to: (projectId: string | null) => string
}

/**
 * The phone's bottom bar. It carries the four destinations used most; the other operational pages (Construction, Survey, QA/QC, Civil) and the
 * tools are in the menu. The desktop and iPad sidebar lists everything (see navTree.ts).
 */
export const PRIMARY_NAV: PrimaryDestination[] = [
  { id: 'status', label: 'Project Status', short: 'Status', icon: BarChart3, needsProject: true, to: (p) => (p ? paths.progress(p) : '/projects') },
  { id: 'materials', label: 'Materials & Procurement', short: 'Materials', icon: ShoppingCart, needsProject: true, to: (p) => (p ? paths.manage(p) : '/projects') },
  { id: 'foundation', label: 'Foundation Overview', short: 'Foundation', icon: Building2, needsProject: true, to: (p) => (p ? paths.foundations(p) : '/projects') },
  { id: 'fleet', label: 'Fleet', short: 'Fleet', icon: Truck, needsProject: false, to: () => '/fleet' },
]

/** Which bottom-bar destination a URL belongs to (none for the pages that live in the menu). */
export function activePrimary(pathname: string): PrimaryId | null {
  if (/^\/fleet(\/|$)/.test(pathname) || /^\/projects\/[^/]+\/fleet(\/|$)/.test(pathname)) return 'fleet'
  const m = /^\/projects\/[^/]+\/(progress|manage\/materials|foundation)(\/|$)/.exec(pathname)
  if (!m) return null
  return m[1] === 'progress' ? 'status' : m[1] === 'foundation' ? 'foundation' : 'materials'
}
