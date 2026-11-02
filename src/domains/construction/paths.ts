import type { Foundation } from './types'

/**
 * Every in-app link is built here. Pages live under four sections of a project: Progress, Management, Foundation and Setup (plus Fleet,
 * which is independent). Paths that existed before the navigation redesign are still recognised and redirected: see navigation.ts.
 */
export const paths = {
  project: (p: string) => `/projects/${p}`,
  progress: (p: string) => `/projects/${p}/progress`,
  /** Project Management opens on Procurement. */
  manage: (p: string) => `/projects/${p}/manage/materials`,
  manageSection: (p: string, section: 'materials' | 'records' | 'construction' | 'survey' | 'qaqc' | 'civil', areaId?: string) =>
    `/projects/${p}/manage/${section === 'records' ? 'materials/records' : section}${areaId ? `?area=${areaId}` : ''}`,
  foundations: (p: string) => `/projects/${p}/foundation`,
  setup: (p: string) => `/projects/${p}/setup`,
  team: (p: string) => `/projects/${p}/setup/team`,
  settings: (p: string) => `/projects/${p}/setup/settings`,
  register: (p: string) => `/projects/${p}/setup/foundations`,
  materials: (p: string) => `/projects/${p}/progress/materials`,
  materialRecords: (p: string) => `/projects/${p}/manage/materials/records`,
  procurement: (p: string) => `/projects/${p}/manage/materials`,
  fabrication: (p: string) => `/projects/${p}/fabrication`,
  pours: (p: string) => `/projects/${p}/setup/pours`,
  pour: (p: string, id: string) => `/projects/${p}/setup/pours/${id}`,
  anchorage: (p: string) => `/projects/${p}/setup/anchorage`,
  handover: (p: string) => `/projects/${p}/handover`,
  /** Fleet is independent of any project. A project's own fleet view is still available at projectFleet. */
  fleet: () => '/fleet',
  projectFleet: (p: string) => `/projects/${p}/fleet`,
  issues: (p: string) => `/projects/${p}/issues`,
  areas: (p: string) => `/projects/${p}/setup/areas`,
  area: (p: string, areaId: string, tab?: string) => `/projects/${p}/progress/${areaId}${tab ? `?tab=${tab}` : ''}`,
  foundation: (p: string, f: Pick<Foundation, 'id'> & Partial<Pick<Foundation, 'areaId'>>, plinthId?: string) => `/projects/${p}/foundation/${f.id}${plinthId ? `?plinth=${plinthId}` : ''}`,
}
