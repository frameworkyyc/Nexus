import { Activity, BarChart3, Briefcase, Building2, ClipboardList, Database, FileText, FolderKanban, HardHat, LayoutGrid, Settings2, ShieldCheck, Truck, type LucideIcon } from 'lucide-react'
import { IS_PUBLIC_DEMO } from './bundle'
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
  children?: NavNode[]
}
export interface NavSection extends NavNode { section: SectionId }

interface AreaRef { id: string; name: string }

/** The four primary sections. Each expands to the pages inside it, so any page is one click away. Without a project the project sections open the project list. */
export function primarySections(projectId: string | null, areas: AreaRef[]): NavSection[] {
  const p = projectId
  const to = (f: (id: string) => string, fallback = '/projects') => (p ? f(p) : fallback)
  return [
    {
      section: 'progress', id: 'progress', label: 'Project Progress', icon: BarChart3, to: to(paths.progress),
      children: p ? [
        { id: 'progress-overview', label: 'Project overview', to: paths.progress(p) },
        { id: 'progress-materials', label: 'Materials', to: paths.materials(p) },
        ...areas.map((a) => ({ id: `progress-${a.id}`, label: a.name, to: paths.area(p, a.id), prefix: true })),
      ] : undefined,
    },
    {
      section: 'manage', id: 'manage', label: 'Project Management', icon: ClipboardList, to: to(paths.manage),
      children: p ? [
        { id: 'manage-materials', label: 'Materials & Procurement', to: paths.manage(p) },
        { id: 'manage-records', label: 'Material records', to: paths.materialRecords(p) },
        { id: 'manage-construction', label: 'Construction / Installation', to: paths.manageSection(p, 'construction'), prefix: true },
        { id: 'manage-survey', label: 'Survey', to: paths.manageSection(p, 'survey'), prefix: true },
        { id: 'manage-qaqc', label: 'QA/QC', to: paths.manageSection(p, 'qaqc'), prefix: true },
        { id: 'manage-civil', label: 'Civil / Earthworks', to: paths.manageSection(p, 'civil'), future: true },
      ] : undefined,
    },
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
    {
      id: 'setup', label: 'Setup', to: paths.setup(projectId), icon: Settings2,
      children: [
        { id: 'setup-foundations', label: 'Foundations', to: paths.register(projectId) },
        { id: 'setup-areas', label: 'Areas', to: paths.areas(projectId) },
        { id: 'setup-anchorage', label: 'Anchorage types', to: paths.anchorage(projectId) },
        { id: 'setup-pours', label: 'Concrete pours', to: paths.pours(projectId), prefix: true },
      ],
    },
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
