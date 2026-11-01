import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Locked } from '@/layout/Locked'
import { moreItems } from '../moreItems'
import { applyLocks, primarySections, toolNodes } from '../navTree'

let environment: string | undefined = 'production'
vi.mock('@/lib/dataSource', async (orig) => ({ ...(await orig<typeof import('@/lib/dataSource')>()), useBackend: () => ({ mode: 'server', serverAvailable: true, environment }) }))

const all = (env?: string) => [...applyLocks(primarySections('p1', []), env), ...applyLocks(toolNodes('p1', true), env)]
const lockedIds = (env?: string) => all(env).filter((n) => n.locked).map((n) => n.id).sort()

describe('production module locks', () => {
  it('lock exactly the nine modules in production, and nothing on staging or without an environment', () => {
    expect(lockedIds('production')).toEqual(['crew', 'foundation', 'issues', 'op-civil', 'op-qaqc', 'overview', 'project-fleet', 'projects', 'safety'])
    expect(lockedIds('staging')).toEqual([])
    expect(lockedIds(undefined)).toEqual([])
  })

  it('keeps Procurement, Construction, Survey, Setup and the global Fleet open in production', () => {
    const open = all('production').filter((n) => !n.locked).map((n) => n.id)
    for (const id of ['op-materials', 'op-construction', 'op-survey', 'setup', 'fleet', 'status']) expect(open).toContain(id)
  })

  it('locks the same entries in the phone menu', () => {
    expect(moreItems('p1', true, 'production').filter((i) => i.locked).map((i) => i.id).sort()).toEqual(['crew', 'issues', 'overview', 'project-fleet', 'projects', 'safety'])
    expect(moreItems('p1', true, 'staging').some((i) => i.locked)).toBe(false)
  })

  it('a locked route shows Coming Soon in production and the page itself elsewhere', () => {
    const render = (env: string) => { environment = env; return renderToStaticMarkup(<MemoryRouter><Locked id="crew"><p>Crew page</p></Locked></MemoryRouter>) }
    expect(render('production')).toContain('Coming Soon')
    expect(render('production')).not.toContain('Crew page')
    expect(render('staging')).toContain('Crew page')
  })
})
