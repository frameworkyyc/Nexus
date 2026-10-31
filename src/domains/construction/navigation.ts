import { matchPath } from 'react-router-dom'
import { paths } from './paths'

/**
 * Where each path that existed before the navigation redesign lives now. Old bookmarks and links keep working: the route table sends every
 * one of these to `redirectFor`, and a test checks that each target is a real page. Search parameters (such as ?tab=) are carried over.
 */
const LEGACY: { from: string; to: (p: Record<string, string>) => string }[] = [
  { from: '/projects/:projectId/register', to: (p) => paths.register(p.projectId) },
  { from: '/projects/:projectId/materials', to: (p) => paths.materials(p.projectId) },
  { from: '/projects/:projectId/materials/records', to: (p) => paths.materialRecords(p.projectId) },
  { from: '/projects/:projectId/procurement', to: (p) => paths.procurement(p.projectId) },
  { from: '/projects/:projectId/pours', to: (p) => paths.pours(p.projectId) },
  { from: '/projects/:projectId/pours/:pourId', to: (p) => paths.pour(p.projectId, p.pourId) },
  { from: '/projects/:projectId/anchorage', to: (p) => paths.anchorage(p.projectId) },
  { from: '/projects/:projectId/areas', to: (p) => paths.areas(p.projectId) },
  { from: '/projects/:projectId/areas/:areaId', to: (p) => paths.area(p.projectId, p.areaId) },
  { from: '/projects/:projectId/areas/:areaId/foundations/:foundationId', to: (p) => paths.foundation(p.projectId, { id: p.foundationId }) },
]

/** The current location of a legacy path, with its search string, or null when the path is not a legacy one. */
export function redirectFor(pathname: string, search = ''): string | null {
  for (const { from, to } of LEGACY) {
    const m = matchPath({ path: from, end: true }, pathname)
    if (m) return `${to(m.params as Record<string, string>)}${search}`
  }
  return null
}

/** The legacy route patterns, relative to a project, for the route table. */
export const LEGACY_PROJECT_PATHS = ['register', 'materials', 'materials/records', 'procurement', 'pours', 'pours/:pourId', 'anchorage', 'areas', 'areas/:areaId', 'areas/:areaId/foundations/:foundationId']

export type SectionId = 'progress' | 'foundation' | 'fleet'

/** Which part of the app a URL belongs to (used to open the right sidebar group). Setup, Issues, Crew, Safety, Data and the other tools belong to none. */
export function sectionOf(pathname: string): SectionId | null {
  if (/^\/fleet(\/|$)/.test(pathname) || /^\/projects\/[^/]+\/fleet(\/|$)/.test(pathname)) return 'fleet'
  const m = /^\/projects\/[^/]+\/(progress|foundation)(\/|$)/.exec(pathname)
  return (m?.[1] as SectionId | undefined) ?? null
}

/** Switching project keeps you on the same kind of page (the deeper ids belong to the old project); anywhere else it opens Project Status. */
export function swapProject(pathname: string, projectId: string): string {
  const m = /^\/projects\/[^/]+\/(progress|foundation|manage\/(materials|construction|survey|qaqc|civil))(\/|$)/.exec(pathname)
  if (!m) return paths.progress(projectId)
  if (m[1] === 'progress') return paths.progress(projectId)
  if (m[1] === 'foundation') return paths.foundations(projectId)
  return m[2] === 'materials' ? paths.manage(projectId) : paths.manageSection(projectId, m[2] as 'construction' | 'survey' | 'qaqc' | 'civil')
}

/** The project to show: the one in the URL, else the last one used, else the only/first one. */
export function resolveProject(projects: { id: string }[], routeId: string | undefined, lastId: string | null | undefined): string | null {
  const has = (id: string | null | undefined) => !!id && projects.some((p) => p.id === id)
  if (has(routeId)) return routeId!
  if (has(lastId)) return lastId!
  return projects[0]?.id ?? null
}
