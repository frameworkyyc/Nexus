import { Building2, LayoutGrid, ShieldCheck, Truck, Users, type LucideIcon } from 'lucide-react'

export interface PrimaryDestination {
  id: 'overview' | 'construction' | 'crew' | 'fleet' | 'safety'
  label: string
  icon: LucideIcon
  to: string
  /** Which URLs highlight this tab. A project's Fleet page belongs to Fleet, not Construction. */
  matches: (pathname: string) => boolean
}

const projectFleet = /^\/projects\/[^/]+\/fleet(\/|$)/

/** The five destinations of the phone's bottom navigation. Desktop navigation (Sidebar / MODULES) is unchanged. */
export const PRIMARY_NAV: PrimaryDestination[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, to: '/', matches: (p) => p === '/' },
  { id: 'construction', label: 'Construction', icon: Building2, to: '/projects', matches: (p) => p.startsWith('/projects') && !projectFleet.test(p) },
  { id: 'crew', label: 'Crew', icon: Users, to: '/crew', matches: (p) => p.startsWith('/crew') },
  { id: 'fleet', label: 'Fleet', icon: Truck, to: '/fleet', matches: (p) => p.startsWith('/fleet') || projectFleet.test(p) },
  { id: 'safety', label: 'Safety', icon: ShieldCheck, to: '/safety', matches: (p) => p.startsWith('/safety') },
]

export const activePrimary = (pathname: string) => PRIMARY_NAV.find((d) => d.matches(pathname))?.id ?? null
