import type { Foundation } from './types'

export const paths = {
  project: (p: string) => `/projects/${p}`,
  register: (p: string) => `/projects/${p}/register`,
  materials: (p: string) => `/projects/${p}/materials`,
  fabrication: (p: string) => `/projects/${p}/fabrication`,
  pours: (p: string) => `/projects/${p}/pours`,
  pour: (p: string, id: string) => `/projects/${p}/pours/${id}`,
  anchorage: (p: string) => `/projects/${p}/anchorage`,
  handover: (p: string) => `/projects/${p}/handover`,
  fleet: (p: string) => `/projects/${p}/fleet`,
  issues: (p: string) => `/projects/${p}/issues`,
  area: (p: string, areaId: string, tab?: string) => `/projects/${p}/areas/${areaId}${tab ? `?tab=${tab}` : ''}`,
  foundation: (p: string, f: Pick<Foundation, 'areaId' | 'id'>, plinthId?: string) => `/projects/${p}/areas/${f.areaId}/foundations/${f.id}${plinthId ? `?plinth=${plinthId}` : ''}`,
}
