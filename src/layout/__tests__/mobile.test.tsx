import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { activePrimary, PRIMARY_NAV } from '@/app/primaryNav'
import { PHONE_QUERY } from '@/lib/useMedia'
import { BottomNav } from '../BottomNav'

vi.mock('@/app/projectContext', () => ({ useProjectContext: () => ({ projectId: 'reef', project: null, projects: [] }) }))

const css = readFileSync('src/index.css', 'utf8')
const html = readFileSync('index.html', 'utf8')

describe('phone navigation', () => {
  it('has the four primary sections, in order, with short labels', () => {
    expect(PRIMARY_NAV.map((d) => d.short)).toEqual(['Status', 'Procurement', 'Foundation', 'Fleet'])
    expect(PRIMARY_NAV.map((d) => d.label)).toEqual(['Project Status', 'Procurement', 'Foundation Overview', 'Fleet'])
    expect(PRIMARY_NAV.map((d) => d.to('reef'))).toEqual(['/projects/reef/progress', '/projects/reef/manage/materials', '/projects/reef/foundation', '/fleet'])
  })

  it('highlights the section a URL belongs to', () => {
    const at = (p: string) => activePrimary(p)
    expect(at('/projects/reef/progress')).toBe('status')
    expect(at('/projects/reef/progress/mole-sieve')).toBe('status')
    expect(at('/projects/reef/manage/materials')).toBe('materials')
    expect(at('/projects/reef/manage/materials/records')).toBe('materials')
    expect(at('/projects/reef/manage/construction')).toBeNull() // the other operational pages are in the menu
    expect(at('/projects/reef/foundation/f-21-01')).toBe('foundation')
    expect(at('/fleet')).toBe('fleet')
    expect(at('/fleet/veh-T6010')).toBe('fleet')
    expect(at('/projects/reef/fleet')).toBe('fleet') // a project's fleet belongs to Fleet
    expect(at('/projects/reef/fleet/veh-T6010')).toBe('fleet')
    expect(at('/crew')).toBeNull() // secondary pages live in More
    expect(at('/projects/reef/setup/foundations')).toBeNull()
    expect(at('/data')).toBeNull()
  })

  it('renders as a real navigation landmark with the active page marked and the safe area respected', () => {
    const out = renderToStaticMarkup(<MemoryRouter initialEntries={['/fleet/veh-D101']}><BottomNav /></MemoryRouter>)
    expect(out).toContain('aria-label="Primary"')
    expect((out.match(/<a /g) ?? []).length).toBe(4)
    expect(out).toMatch(/href="\/fleet"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/fleet"/)
    expect((out.match(/aria-current="page"/g) ?? []).length).toBe(1)
    expect(out).toContain('href="/projects/reef/progress"')
    expect(out).toContain('href="/projects/reef/manage/materials"') // links use the project in context
    expect(out).toContain('pb-safe') // clears the iPhone home indicator
    expect(out).toContain('fixed inset-x-0 bottom-0')
  })
})

describe('phone design-system contract', () => {
  it('keeps the CSS variant and the JS hook on the same media query', () => {
    const variant = /@custom-variant phone \{\s*@media ([^{]+) \{/.exec(css)![1].trim()
    expect(variant).toBe(PHONE_QUERY)
    // every hand-written phone block uses the same query
    const blocks = [...css.matchAll(/@media \(max-width: 767\.98px\)[^{]*\{/g)].map((m) => m[0].replace(/\s*\{$/, '').replace('@media ', ''))
    expect(blocks.length).toBeGreaterThan(3)
    for (const b of blocks) expect(b).toBe(PHONE_QUERY)
  })

  it('declares the mobile type scale, 44px touch targets and 16px form fields', () => {
    expect(css).toContain('--nx-tap: 44px')
    expect(css).toMatch(/\.text-\\\[13px\\\] \{ font-size: 15px/)
    expect(css).toMatch(/\.t-display \{ font-size: 28px/)
    expect(css).toMatch(/input:not\(\[type='checkbox'\]\)[^{]*\{ font-size: 16px !important; min-height: var\(--nx-tap\)/)
    expect(css).toMatch(/button, summary, \[role='tab'\], \[role='menuitem'\] \{ min-height: var\(--nx-tap\)/)
  })

  it('handles safe areas and scales the page for iPhone', () => {
    expect(html).toContain('viewport-fit=cover')
    for (const side of ['top', 'bottom', 'left', 'right']) expect(css).toContain(`env(safe-area-inset-${side})`)
    expect(css).toContain('overscroll-behavior-y: none')
  })

  it('turns tables into stacked cards on phones without hiding any column', () => {
    expect(css).toContain('table.card-table > thead { display: none; }') // headers become per-cell labels
    expect(css).toContain('td[data-label]::before')
    expect(css).not.toMatch(/card-table[^{]*td\.hidden\s*\{[^}]*display:\s*none/) // columns hidden on a narrow screen stay visible in a card
  })
})
