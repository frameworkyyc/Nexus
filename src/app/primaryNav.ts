import { BarChart3, Building2, ClipboardList, Truck, type LucideIcon } from 'lucide-react'
import { paths } from '@/domains/construction/paths'
import { sectionOf, type SectionId } from '@/domains/construction/navigation'

export interface PrimaryDestination {
  id: SectionId
  label: string
  /** Short label for phones and narrow tablets. */
  short: string
  icon: LucideIcon
  /** Whether the section needs a project. Fleet does not. */
  needsProject: boolean
  to: (projectId: string | null) => string
}

/** The four primary sections: the desktop and iPad header and the phone's bottom bar show exactly these. */
export const PRIMARY_NAV: PrimaryDestination[] = [
  { id: 'progress', label: 'Project Progress', short: 'Progress', icon: BarChart3, needsProject: true, to: (p) => (p ? paths.progress(p) : '/projects') },
  { id: 'manage', label: 'Project Management', short: 'Manage', icon: ClipboardList, needsProject: true, to: (p) => (p ? paths.manage(p) : '/projects') },
  { id: 'foundation', label: 'Foundation Overview', short: 'Foundation', icon: Building2, needsProject: true, to: (p) => (p ? paths.foundations(p) : '/projects') },
  { id: 'fleet', label: 'Fleet', short: 'Fleet', icon: Truck, needsProject: false, to: () => '/fleet' },
]

export const activePrimary = (pathname: string): SectionId | null => sectionOf(pathname)
