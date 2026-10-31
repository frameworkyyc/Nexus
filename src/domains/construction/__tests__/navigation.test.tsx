import { matchRoutes, type RouteObject } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { moreItems } from '@/app/moreItems'
import { PRIMARY_NAV } from '@/app/primaryNav'
import { LEGACY_PROJECT_PATHS, redirectFor, resolveProject, sectionOf, swapProject } from '../navigation'
import { paths } from '../paths'
import { constructionRoutes } from '../routes'
import { fleetRoutes } from '../../fleet/routes'
import { crewRoutes } from '../../crew/routes'
import { safetyRoutes } from '../../safety/routes'
import { dataRoutes } from '../../data/routes'

const routes: RouteObject[] = [{ path: '/', children: [...constructionRoutes, ...fleetRoutes, ...crewRoutes, ...safetyRoutes, ...dataRoutes] }]
const isLegacy = (r: { route: RouteObject }) => (r.route.handle as { legacy?: boolean } | undefined)?.legacy === true
const leaf = (path: string) => matchRoutes(routes, path)?.at(-1)

/** Every path an old bookmark or link could have used, with the page it should now open. */
const OLD_URLS: [string, string][] = [
  ['/projects/reef/register', '/projects/reef/setup/foundations'],
  ['/projects/reef/materials', '/projects/reef/progress/materials'],
  ['/projects/reef/materials/records', '/projects/reef/manage/materials/records'],
  ['/projects/reef/procurement', '/projects/reef/manage/materials'],
  ['/projects/reef/pours', '/projects/reef/setup/pours'],
  ['/projects/reef/pours/p1', '/projects/reef/setup/pours/p1'],
  ['/projects/reef/anchorage', '/projects/reef/setup/anchorage'],
  ['/projects/reef/areas', '/projects/reef/setup/areas'],
  ['/projects/reef/areas/a1', '/projects/reef/progress/a1'],
  ['/projects/reef/areas/a1/foundations/f1', '/projects/reef/foundation/f1'],
]

describe('legacy paths', () => {
  it('redirect to the page that now holds them', () => {
    for (const [from, to] of OLD_URLS) expect(redirectFor(from), from).toBe(to)
  })

  it('keep their ?tab= and ?plinth= search strings', () => {
    expect(redirectFor('/projects/reef/areas/a1', '?tab=materials')).toBe('/projects/reef/progress/a1?tab=materials')
    expect(redirectFor('/projects/reef/areas/a1/foundations/f1', '?plinth=p2')).toBe('/projects/reef/foundation/f1?plinth=p2')
  })

  it('are all declared in the route table, and each target is a real page rather than another redirect or Not found', () => {
    expect(LEGACY_PROJECT_PATHS.length).toBe(OLD_URLS.length)
    for (const [from, to] of OLD_URLS) {
      const old = leaf(from)
      expect(old, from).toBeTruthy()
      expect(isLegacy(old!), `${from} should be a redirect`).toBe(true)
      const now = leaf(to)
      expect(now, to).toBeTruthy()
      expect(isLegacy(now!), `${to} must not redirect again`).toBe(false)
    }
  })

  it('leaves unknown and current paths alone', () => {
    expect(redirectFor('/projects/reef/progress')).toBeNull()
    expect(redirectFor('/fleet')).toBeNull()
  })
})

describe('route table', () => {
  const URLS = [
    '/', '/overview', '/projects', '/projects/reef', '/projects/reef/progress', '/projects/reef/progress/materials', '/projects/reef/progress/a1',
    '/projects/reef/manage', '/projects/reef/manage/materials', '/projects/reef/manage/materials/records', '/projects/reef/manage/construction',
    '/projects/reef/manage/survey', '/projects/reef/manage/qaqc', '/projects/reef/manage/civil',
    '/projects/reef/foundation', '/projects/reef/foundation/f1',
    '/projects/reef/setup', '/projects/reef/setup/foundations', '/projects/reef/setup/areas', '/projects/reef/setup/anchorage', '/projects/reef/setup/pours', '/projects/reef/setup/pours/p1',
    '/projects/reef/issues', '/projects/reef/fabrication', '/projects/reef/handover', '/projects/reef/fleet', '/projects/reef/fleet/v1',
    '/fleet', '/fleet/v1', '/crew', '/safety', '/data',
  ]
  it('opens every page of the new structure and every page that stays where it was', () => {
    for (const u of URLS) expect(leaf(u), u).toBeTruthy()
  })
  it('keeps Fleet, Crew, Safety and Data in their own modules', () => {
    expect(sectionOf('/fleet')).toBe('fleet')
    expect(sectionOf('/crew')).toBeNull()
  })
})

describe('navigation helpers', () => {
  it('builds every primary link from the project in context, and Fleet without one', () => {
    expect(PRIMARY_NAV.map((s) => s.to(null))).toEqual(['/projects', '/projects', '/projects', '/fleet'])
    expect(PRIMARY_NAV.find((s) => s.id === 'fleet')!.needsProject).toBe(false)
  })

  it('picks the project: the URL first, then the last used, then the first; never an unknown id', () => {
    const projects = [{ id: 'a' }, { id: 'b' }]
    expect(resolveProject(projects, 'b', 'a')).toBe('b')
    expect(resolveProject(projects, undefined, 'b')).toBe('b')
    expect(resolveProject(projects, undefined, 'gone')).toBe('a')
    expect(resolveProject(projects, 'nope', null)).toBe('a')
    expect(resolveProject([], 'a', 'a')).toBeNull()
  })

  it('keeps the section when the project changes, and opens Progress from anywhere else', () => {
    expect(swapProject('/projects/a/manage/construction', 'b')).toBe('/projects/b/manage/materials')
    expect(swapProject('/projects/a/foundation/f1', 'b')).toBe('/projects/b/foundation')
    expect(swapProject('/projects/a/progress/area1', 'b')).toBe('/projects/b/progress')
    expect(swapProject('/fleet', 'b')).toBe('/projects/b/progress')
    expect(swapProject('/projects/a/setup/areas', 'b')).toBe('/projects/b/progress')
  })

  it('More holds every page that left the sidebar, project tabs and phone menu, and none of the old placeholders', () => {
    const ids = moreItems('reef', false).map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['setup', 'issues', 'project-fleet', 'fabrication', 'handover', 'projects', 'overview', 'crew', 'safety']))
    expect(moreItems('reef', true).map((i) => i.id)).not.toContain('fabrication') // no saved records yet
    expect(moreItems(null, true).map((i) => i.id)).not.toContain('setup') // project items need a project
    const labels = moreItems('reef', false).map((i) => i.label.toLowerCase())
    for (const planned of ['assets', 'workforce', 'documents', 'operations', 'quality', 'analytics']) expect(labels).not.toContain(planned)
  })

  it('builds links that stay inside the new structure', () => {
    expect(paths.area('p', 'a', 'materials')).toBe('/projects/p/progress/a?tab=materials')
    expect(paths.foundation('p', { id: 'f' }, 'pl')).toBe('/projects/p/foundation/f?plinth=pl')
    expect(paths.manageSection('p', 'records')).toBe('/projects/p/manage/materials/records')
    expect(paths.manageSection('p', 'construction', 'a')).toBe('/projects/p/manage/construction?area=a')
  })
})
