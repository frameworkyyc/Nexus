import { Activity, Briefcase, Database, FileText, FolderKanban, HardHat, LayoutGrid, Settings2, ShieldCheck, Truck, type LucideIcon } from 'lucide-react'
import { IS_PUBLIC_DEMO } from './bundle'
import { paths } from '@/domains/construction/paths'

export interface MoreItem { id: string; label: string; to: string; icon: LucideIcon }

/**
 * Everything that is not one of the four primary sections. Nothing was removed: pages that used to be in the sidebar, the project tab row
 * or the phone menu are reachable from here. The seven "coming soon" placeholders are no longer listed.
 */
export function moreItems(projectId: string | null, server: boolean): MoreItem[] {
  const project: MoreItem[] = projectId
    ? [
        { id: 'setup', label: 'Setup', to: paths.setup(projectId), icon: Settings2 },
        { id: 'issues', label: 'Issues', to: paths.issues(projectId), icon: Activity },
        { id: 'project-fleet', label: 'Fleet on this project', to: paths.projectFleet(projectId), icon: Truck },
        ...(server ? [] : [
          { id: 'fabrication', label: 'Fabrication', to: paths.fabrication(projectId), icon: Briefcase },
          { id: 'handover', label: 'Handover', to: paths.handover(projectId), icon: FileText },
        ]),
      ]
    : []
  return [
    ...project,
    { id: 'projects', label: 'All projects', to: '/projects', icon: FolderKanban },
    { id: 'overview', label: 'Company overview', to: '/overview', icon: LayoutGrid },
    { id: 'crew', label: 'Crew', to: '/crew', icon: HardHat },
    { id: 'safety', label: 'Safety', to: '/safety', icon: ShieldCheck },
    ...(IS_PUBLIC_DEMO ? [] : [{ id: 'data', label: 'Data & backups', to: '/data', icon: Database }]),
  ].filter(Boolean) as MoreItem[]
}
