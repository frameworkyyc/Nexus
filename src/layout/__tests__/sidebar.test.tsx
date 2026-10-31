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

const PRIMARY = ['Project Status', 'Procurement', 'Construction / Installation', 'Survey', 'QA/QC', 'Civil / Earthworks', 'Foundation Overview', 'Fleet']

describe('sidebar contents', () => {
  it('lists Project Status, the operational pages, Foundation Overview and Fleet in order, then Tools; there is no Project Management parent', () => {
    const out = html('/projects/reef/progress')
    expect(out).toContain('aria-label="Primary"')
    expect(out).toContain('aria-label="Tools"')
    const at = PRIMARY.map((l) => out.indexOf(`>${l}<`))
    expect(at.every((i) => i > 0), PRIMARY.filter((_, i) => at[i] < 0).join(', ')).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(out).not.toContain('Project Management')
    expect(out).not.toContain('Project Progress')
    for (const tool of ['Setup', 'Issues', 'Crew', 'Safety', 'Data &amp; backups', 'All projects']) expect(out).toContain(`>${tool}<`)
    expect(out).toContain('NEXUS')
  })

  it('expands Project Status to the project overview and each Area, and nothing else', () => {
    const out = html('/projects/reef/progress')
    expect(out).toContain('>Project Overview<')
    expect(out).toContain('>E-House<')
    expect(out).toContain('>Mole Sieve<')
    expect(out).not.toContain('>Materials<') // no separate Materials page in Project Status
  })

  it('makes every discipline a direct link, with Civil marked as future development', () => {
    const out = html('/projects/reef/manage/materials')
    for (const [label, href] of [['Procurement', '/projects/reef/manage/materials'], ['Construction / Installation', '/projects/reef/manage/construction'], ['Survey', '/projects/reef/manage/survey'], ['QA/QC', '/projects/reef/manage/qaqc'], ['Civil / Earthworks', '/projects/reef/manage/civil']])
      expect(out, label).toContain(`href="${href}"`)
    expect(out).toContain('Future')
    expect(out).not.toContain('aria-label="Expand Procurement') // direct links have no chevron
  })

  it('opens Setup with its pages when you are in Setup', () => {
    const setup = html('/projects/reef/setup/areas')
    for (const page of ['Foundations', 'Areas', 'Anchorage types', 'Concrete pours']) expect(setup, page).toContain(`>${page}<`)
  })

  it('marks exactly one page as current, and highlights its entry', () => {
    const out = html('/projects/reef/manage/construction')
    expect((out.match(/aria-current="page"/g) ?? []).length).toBe(1)
    expect(out).toMatch(/aria-current="page"[^>]*>.{0,700}Construction \/ Installation/)
    const records = html('/projects/reef/manage/materials/records') // a page inside Procurement keeps that entry highlighted
    expect(records).toMatch(/bg-white\/10[^>]*>.{0,700}Procurement/)
    const area = html('/projects/reef/foundation?area=a2')
    expect(area).toMatch(/title="Mole Sieve"[^>]*aria-current="page"|aria-current="page"[^>]*title="Mole Sieve"/)
    expect(area).not.toMatch(/title="E-House"[^>]*aria-current="page"/)
  })

  it('shrinks to an icon rail that still reaches every entry, with accessible names', () => {
    const out = html('/projects/reef/progress', true)
    expect(out).toContain('aria-label="Expand navigation"')
    for (const name of ['Project Status', 'Procurement', 'Construction / Installation', 'Survey', 'QA/QC', 'Civil / Earthworks', 'Foundation Overview', 'Fleet', 'Setup', 'Issues', 'Crew', 'Safety']) expect(out, name).toContain(`aria-label="${name.replace('&', '&amp;')}"`)
    expect(out).not.toContain('NEXUS')
    expect(out).not.toContain('>E-House<')
  })

  it('offers a close button when it is a temporary overlay and a collapse button otherwise', () => {
    expect(html('/projects/reef/progress', false, true)).toContain('aria-label="Close navigation"')
    expect(html('/projects/reef/progress')).toContain('aria-label="Collapse navigation"')
  })

  it('keeps the original Nexus sidebar styling', () => {
    const out = html('/projects/reef/progress')
    expect(out).toContain('bg-sidebar')
    expect(out).toContain('border-sidebar-line')
    expect(out).toContain('bg-white/10')
    expect(out).toContain('tracking-[0.28em]')
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
    expect(s.map((x) => x.to)).toEqual(['/projects', '/projects', '/projects', '/projects', '/projects', '/projects', '/projects', '/fleet'])
    expect(s.every((x) => !x.children)).toBe(true)
    expect(toolNodes(null, true).map((t) => t.id)).toEqual(['projects', 'overview', 'crew', 'safety', 'data'])
  })

  it('matches pages exactly, beneath a prefix, and by area filter', () => {
    const tool = (id: string) => toolNodes('reef', false).find((t) => t.id === id)!
    expect(isCurrent(tool('crew'), '/crew', '')).toBe(true)
    expect(isCurrent(tool('crew'), '/crew/x', '')).toBe(true)
    expect(isCurrent(tool('issues'), '/projects/reef/issues/x', '')).toBe(false) // exact unless marked prefix
    const area = primarySections('reef', AREAS).find((x) => x.id === 'foundation')!.children![2]
    expect(isCurrent(area, '/projects/reef/foundation', '?area=a2')).toBe(true)
    expect(isCurrent(area, '/projects/reef/foundation', '?area=a1')).toBe(false)
    expect(containsCurrent(tool('setup'), '/projects/reef/setup/pours/p1', '')).toBe(true)
  })
})
