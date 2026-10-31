import { renderToStaticMarkup } from 'react-dom/server'
import { matchRoutes, MemoryRouter, type RouteObject } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { containsCurrent, isCurrent, primarySections, toolNodes, type NavNode } from '@/app/navTree'
import { constructionRoutes } from '@/domains/construction/routes'
import { fleetRoutes } from '@/domains/fleet/routes'
import { crewRoutes } from '@/domains/crew/routes'
import { safetyRoutes } from '@/domains/safety/routes'
import { dataRoutes } from '@/domains/data/routes'
import { SidebarView } from '../Sidebar'

const AREAS = [{ id: 'a1', name: 'E-House' }, { id: 'a2', name: 'Mole Sieve' }]
const routes: RouteObject[] = [{ path: '/', children: [...constructionRoutes, ...fleetRoutes, ...crewRoutes, ...safetyRoutes, ...dataRoutes] }]
const flat = (nodes: NavNode[]): NavNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])])
const html = (path: string, rail = false, overlay = false) => {
  const [pathname, search = ''] = path.split('?')
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <SidebarView sections={primarySections('reef', AREAS)} tools={toolNodes('reef', false)} pathname={pathname} search={search ? `?${search}` : ''} rail={rail} overlay={overlay} onToggle={() => {}} onNavigate={() => {}} footer="Saved project data" />
    </MemoryRouter>,
  )
}

describe('sidebar contents', () => {
  it('has the four primary sections in order, then a secondary Tools group', () => {
    const out = html('/projects/reef/progress')
    expect(out).toContain('aria-label="Primary"')
    expect(out).toContain('aria-label="Tools"')
    const labels = ['Project Progress', 'Project Management', 'Foundation Overview', 'Fleet'].map((l) => out.indexOf(`>${l}<`))
    expect(labels.every((i) => i > 0)).toBe(true)
    expect([...labels].sort((a, b) => a - b)).toEqual(labels)
    for (const tool of ['Setup', 'Issues', 'Crew', 'Safety', 'Data &amp; backups', 'All projects']) expect(out).toContain(`>${tool}<`)
    expect(out).toContain('NEXUS')
  })

  it('opens the section you are in and lists its pages, so any page is one click away', () => {
    const progress = html('/projects/reef/progress')
    expect(progress).toContain('>Project overview<')
    expect(progress).toContain('>E-House<')
    expect(progress).toContain('>Mole Sieve<')
    expect(progress).not.toContain('>Survey<') // Management is closed while you are in Progress
    const manage = html('/projects/reef/manage/materials')
    for (const page of ['Materials &amp; Procurement', 'Material records', 'Construction / Installation', 'Survey', 'QA/QC', 'Civil / Earthworks']) expect(manage, page).toContain(`>${page}<`)
    expect(manage).toContain('Future') // Civil is marked as future development
    const setup = html('/projects/reef/setup/areas')
    for (const page of ['Foundations', 'Areas', 'Anchorage types', 'Concrete pours']) expect(setup, page).toContain(`>${page}<`)
  })

  it('marks exactly one page as the current page (its section is highlighted but is not "current")', () => {
    const out = html('/projects/reef/manage/construction')
    expect((out.match(/aria-current="page"/g) ?? []).length).toBe(1)
    expect(out).toContain('bg-white/10') // the section row is highlighted too
    expect(out).toMatch(/aria-current="page"[^>]*><span class="truncate">Construction \/ Installation/)
    const area = html('/projects/reef/foundation?area=a2')
    expect(area).toMatch(/title="Mole Sieve"[^>]*aria-current="page"|aria-current="page"[^>]*title="Mole Sieve"/)
    expect(area).not.toMatch(/title="E-House"[^>]*aria-current="page"/)
  })

  it('shrinks to an icon rail that still reaches every section and tool, with accessible names', () => {
    const out = html('/projects/reef/progress', true)
    expect(out).toContain('aria-label="Expand navigation"')
    for (const name of ['Project Progress', 'Project Management', 'Foundation Overview', 'Fleet', 'Setup', 'Issues', 'Crew', 'Safety']) expect(out, name).toContain(`aria-label="${name}"`)
    expect(out).not.toContain('NEXUS')
    expect(out).not.toContain('>E-House<') // the pages inside a section need the full sidebar
  })

  it('offers a close button when it is a temporary overlay and a collapse button otherwise', () => {
    expect(html('/projects/reef/progress', false, true)).toContain('aria-label="Close navigation"')
    expect(html('/projects/reef/progress')).toContain('aria-label="Collapse navigation"')
  })

  it('keeps the original Nexus sidebar styling', () => {
    const out = html('/projects/reef/progress')
    expect(out).toContain('bg-sidebar')
    expect(out).toContain('border-sidebar-line')
    expect(out).toContain('bg-white/10') // the current page
    expect(out).toContain('tracking-[0.28em]') // the NEXUS mark
  })
})

describe('sidebar links', () => {
  it('every link goes to a real page, never to a redirect or Not found', () => {
    const all = [...flat(primarySections('reef', AREAS)), ...flat(toolNodes('reef', false))]
    expect(all.length).toBeGreaterThan(25)
    for (const n of all) {
      const leaf = matchRoutes(routes, n.to.split('?')[0])?.at(-1)
      expect(leaf, n.to).toBeTruthy()
      expect((leaf!.route.handle as { legacy?: boolean } | undefined)?.legacy, `${n.to} is a legacy redirect`).not.toBe(true)
    }
  })

  it('without a project, the project sections open the project list and Fleet still works', () => {
    const s = primarySections(null, [])
    expect(s.map((x) => x.to)).toEqual(['/projects', '/projects', '/projects', '/fleet'])
    expect(s.every((x) => !x.children)).toBe(true)
    expect(toolNodes(null, true).map((t) => t.id)).toEqual(['projects', 'overview', 'crew', 'safety', 'data'])
  })

  it('matches pages exactly, beneath a prefix, and by area filter', () => {
    const tool = (id: string) => toolNodes('reef', false).find((t) => t.id === id)!
    expect(isCurrent(tool('crew'), '/crew', '')).toBe(true)
    expect(isCurrent(tool('crew'), '/crew/x', '')).toBe(true)
    expect(isCurrent(tool('issues'), '/projects/reef/issues/x', '')).toBe(false) // exact unless marked prefix
    const area = primarySections('reef', AREAS)[2].children![2]
    expect(isCurrent(area, '/projects/reef/foundation', '?area=a2')).toBe(true)
    expect(isCurrent(area, '/projects/reef/foundation', '?area=a1')).toBe(false)
    expect(containsCurrent(tool('setup'), '/projects/reef/setup/pours/p1', '')).toBe(true)
  })
})
