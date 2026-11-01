import { Activity, BarChart3, Briefcase, Building2, ClipboardCheck, Database, FileText, FolderKanban, Hammer, HardHat, LayoutGrid, Ruler, Settings2, ShieldCheck, Shovel, ShoppingCart, Truck, type LucideIcon } from 'lucide-react'
import { IS_PUBLIC_DEMO } from './bundle'
import { isLocked, NAV_LOCK } from '@/shared/lock'
import { paths } from '@/domains/construction/paths'
import type { SectionId } from '@/domains/construction/navigation'

/**
 * The sidebar's contents: one tree shared by the desktop/tablet sidebar and (for the secondary tools) the phone menu. A node's `to` may carry a
 * query string (an area filter). `prefix` nodes stay highlighted on the pages beneath them; others only on their own page.
 */
export interface NavNode {
  id: string
  label: string
  to: string
  icon?: LucideIcon
  prefix?: boolean
  /** Planned, not built: shown with a "Future" tag. */
  future?: boolean
  /** Switched off in this environment (production): shown with a lock and "Coming Soon", not a link. */
  locked?: boolean
  children?: NavNode[]
}
/** A primary entry. `section` is set for the groups that own a whole part of the app (Status, Foundation, Fleet); the operational pages are plain links. */
export interface NavSection extends NavNode { section?: SectionId }

interface AreaRef { id: string; name: string }

/** The operational pages: each discipline is one click from the sidebar, with no parent menu. Without a project they open the project list. */
export function operationalNodes(projectId: string | null): NavSection[] {
  const p = projectId
  const to = (section: 'materials' | 'construction' | 'survey' | 'qaqc' | 'civil') => (p ? (section === 'materials' ? paths.manage(p) : paths.manageSection(p, section)) : '/projects')
  return [
    { id: 'op-materials', label: 'Procurement', icon: ShoppingCart, to: to('materials'), prefix: true },
    { id: 'op-construction', label: 'Construction', icon: Hammer, to: to('construction'), prefix: true },
    { id: 'op-survey', label: 'Survey', icon: Ruler, to: to('survey'), prefix: true },
    { id: 'op-qaqc', label: 'QA/QC', icon: ClipboardCheck, to: to('qaqc'), prefix: true },
    { id: 'op-civil', label: 'Civil / Earthworks', icon: Shovel, to: to('civil'), prefix: true },
  ]
}

/**
 * The primary entries, top to bottom: Project Status (one link to its overview; the areas are reached from that page), the operational pages, Foundation Overview
 * and Fleet. Without a project the project entries open the project list.
 */
export function primarySections(projectId: string | null, areas: AreaRef[]): NavSection[] {
  const p = projectId
  const to = (f: (id: string) => string, fallback = '/projects') => (p ? f(p) : fallback)
  return [
    {
      section: 'progress', id: 'status', label: 'Project Status', icon: BarChart3, to: to(paths.progress),
    },
    ...operationalNodes(projectId),
    {
      section: 'foundation', id: 'foundation', label: 'Foundation Overview', icon: Building2, to: to(paths.foundations),
      children: p ? [
        { id: 'foundation-all', label: 'All foundations', to: paths.foundations(p) },
        ...areas.map((a) => ({ id: `foundation-${a.id}`, label: a.name, to: `${paths.foundations(p)}?area=${a.id}` })),
      ] : undefined,
    },
    { section: 'fleet', id: 'fleet', label: 'Fleet', icon: Truck, to: paths.fleet() },
  ]
}

/** Everything that is not a primary section: the secondary "Tools" group in the sidebar and the phone menu. Nothing was removed. */
export function toolNodes(projectId: string | null, server: boolean): NavNode[] {
  const project: NavNode[] = projectId ? [
    { id: 'setup', label: 'Setup', to: paths.setup(projectId), icon: Settings2, prefix: true },
    { id: 'issues', label: 'Issues', to: paths.issues(projectId), icon: Activity },
    { id: 'project-fleet', label: 'Fleet on this project', to: paths.projectFleet(projectId), icon: Truck, prefix: true },
    ...(server ? [] : [
      { id: 'fabrication', label: 'Fabrication', to: paths.fabrication(projectId), icon: Briefcase },
      { id: 'handover', label: 'Handover', to: paths.handover(projectId), icon: FileText },
    ]),
  ] : []
  return [
    ...project,
    { id: 'projects', label: 'All projects', to: '/projects', icon: FolderKanban },
    { id: 'overview', label: 'Company overview', to: '/overview', icon: LayoutGrid },
    { id: 'crew', label: 'Crew', to: '/crew', icon: HardHat, prefix: true },
    { id: 'safety', label: 'Safety', to: '/safety', icon: ShieldCheck, prefix: true },
    ...(IS_PUBLIC_DEMO ? [] : [{ id: 'data', label: 'Data & backups', to: '/data', icon: Database, prefix: true }]),
  ]
}

/** Whether a node is the current page (`search` is the location's query string, for area-filtered nodes). */
export function isCurrent(node: NavNode, pathname: string, search: string): boolean {
  const [path, query] = node.to.split('?')
  if (pathname !== path && !(node.prefix && pathname.startsWith(`${path}/`))) return false
  if (!query) return true
  const want = new URLSearchParams(query), have = new URLSearchParams(search)
  return [...want].every(([k, v]) => have.get(k) === v)
}

/** Whether a node or anything inside it is the current page (so its group opens by itself). */
export const containsCurrent = (node: NavNode, pathname: string, search: string): boolean =>
  isCurrent(node, pathname, search) || !!node.children?.some((c) => containsCurrent(c, pathname, search))

/** Marks the entries that are "Coming Soon" in this environment. Only production locks anything; staging and the demo are returned unchanged. */
export function applyLocks<T extends NavNode>(nodes: T[], environment: string | undefined): T[] {
  return nodes.map((n) => (NAV_LOCK[n.id] && isLocked(NAV_LOCK[n.id], environment) ? { ...n, locked: true, children: undefined } : n))
}
