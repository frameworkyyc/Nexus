import { BarChart3, Boxes, ClipboardCheck, FileText, FolderKanban, HardHat, LayoutGrid, Settings2, ShoppingCart, Truck, type LucideIcon } from 'lucide-react'

export interface NexusModule {
  id: string
  label: string
  icon: LucideIcon
  /** Present only for modules that are built. Others render as planned/disabled. */
  path?: string
}

/** Single source of truth for navigation; enable a module by giving it a path and a route. */
export const MODULES: NexusModule[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, path: '/' },
  { id: 'projects', label: 'Projects', icon: FolderKanban, path: '/projects' },
  { id: 'fleet', label: 'Fleet', icon: Truck },
  { id: 'assets', label: 'Assets', icon: Boxes },
  { id: 'workforce', label: 'Workforce', icon: HardHat },
  { id: 'procurement', label: 'Procurement', icon: ShoppingCart },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'operations', label: 'Operations', icon: Settings2 },
  { id: 'quality', label: 'Quality', icon: ClipboardCheck },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
]
