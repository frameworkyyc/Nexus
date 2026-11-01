import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as K from '../actions'
import { areaTracks, foundationTrack, projectTracks, matchesFilter, trackLabel, trackedActivities } from '../constructionProgress'
import { computeStats, getIndex } from '../selectors'
import type { ConstructionState } from '../types'
import { build, TODAY, world } from './materialsFixtures'

const w = world()
const set = (c: ConstructionState, id: string, patch: Parameters<typeof K.updateActivity>[1]) => build(c, K.updateActivity(id, patch, TODAY))
const idxOf = (c: ConstructionState) => getIndex(c)
const f1 = (c: ConstructionState) => c.foundations.find((f) => f.id === w.f1)!
const finish = (c: ConstructionState, fid: string) => trackedActivities(idxOf(c), c.foundations.find((f) => f.id === fid)!).reduce((s, a) => set(s, a.id, { status: 'complete' }), c)

describe('construction progress (existing records and calculations)', () => {
  it('a new foundation is Not started, and the area counts follow', () => {
    const t = areaTracks(idxOf(w.c), w.eh, TODAY)
    expect(t.tracks.map((x) => x.foundation.number)).toEqual(['F-1', 'F-2'])
    expect(t.counts).toEqual({ 'not-started': 2, 'in-progress': 0, completed: 0, overdue: 0 })
    expect(t.scheduled).toBe(false) // no planned dates recorded: Overdue is unavailable, not invented
    expect(foundationTrack(idxOf(w.c), f1(w.c), TODAY)).toMatchObject({ state: 'not-started', percent: 0, done: 0 })
  })

  it('marking activities complete or incomplete moves the foundation through In progress to Completed, and back', () => {
    let c = set(w.c, `${w.f1}:formed`, { status: 'complete' })
    let t = foundationTrack(idxOf(c), f1(c), TODAY)
    expect(t).toMatchObject({ state: 'in-progress', done: 1 })
    expect(t.percent).toBeGreaterThan(0)
    c = set(c, `${w.f1}:rebarBuilt`, { status: 'in-progress' })
    expect(foundationTrack(idxOf(c), f1(c), TODAY).state).toBe('in-progress')
    c = finish(c, w.f1)
    t = foundationTrack(idxOf(c), f1(c), TODAY)
    expect(t).toMatchObject({ state: 'completed', percent: 100 })
    expect(t.done).toBe(t.total)
    expect(areaTracks(idxOf(c), w.eh, TODAY).counts).toMatchObject({ completed: 1, 'not-started': 1 })
    c = set(c, `${w.f1}:formed`, { status: 'not-started' }) // marked incomplete again
    expect(foundationTrack(idxOf(c), f1(c), TODAY).state).toBe('in-progress')
  })

  it('progress is the existing figure, so Project Status and Foundation Overview agree, and other areas are untouched', () => {
    const c = set(w.c, `${w.f1}:formed`, { status: 'complete' })
    const idx = idxOf(c)
    expect(foundationTrack(idx, f1(c), TODAY).percent).toBe(computeStats(idx, [f1(c)]).progress)
    expect(areaTracks(idx, w.pr, TODAY).counts['in-progress']).toBe(0)
  })

  it('tracks the construction activities only (formwork, pours, rebar; footing and each plinth), not survey, QA/QC or materials', () => {
    const acts = trackedActivities(idxOf(w.c), f1(w.c))
    expect(acts.length).toBeGreaterThan(4)
    expect(acts.every((a) => ['formed', 'poured', 'rebarBuilt', 'rebarInstalled'].includes(a.key))).toBe(true)
    expect(acts.some((a) => a.scope === 'footing' && a.key === 'poured')).toBe(true)
    expect(acts.some((a) => a.scope === 'plinth' && a.key === 'formed')).toBe(true)
    expect(acts.filter((a) => a.key === 'poured').map(trackLabel).sort()).toEqual(['Footing concrete poured', 'Plinth concrete poured'])
  })

  it('Overdue uses recorded planned dates only: late and unfinished is overdue; finished or future is not', () => {
    let c = set(w.c, `${w.f1}:formed`, { plannedDate: '2026-10-01' })
    let t = areaTracks(idxOf(c), w.eh, TODAY)
    expect(t.scheduled).toBe(true)
    expect(t.counts.overdue).toBe(1)
    c = set(c, `${w.f1}:formed`, { status: 'complete' })
    expect(areaTracks(idxOf(c), w.eh, TODAY).counts.overdue).toBe(0)
    c = set(w.c, `${w.f1}:formed`, { plannedDate: '2026-12-31' })
    t = areaTracks(idxOf(c), w.eh, TODAY)
    expect(t.counts.overdue).toBe(0)
    expect(t.scheduled).toBe(true)
  })

  it('a designation with several footings is one record, not one per footing', () => {
    expect(f1(w.c).quantity).toBe(5)
    expect(areaTracks(idxOf(w.c), w.eh, TODAY).tracks.filter((x) => x.foundation.id === w.f1)).toHaveLength(1)
  })

  it('filters by gauge', () => {
    const c = set(set(w.c, `${w.f1}:formed`, { status: 'complete' }), `${w.f2}:formed`, { plannedDate: '2026-10-01' })
    const { tracks } = areaTracks(idxOf(c), w.eh, TODAY)
    const names = (f: Parameters<typeof matchesFilter>[1]) => tracks.filter((t) => matchesFilter(t, f)).map((t) => t.foundation.number)
    expect(names('in-progress')).toEqual(['F-1'])
    expect(names('not-started')).toEqual(['F-2'])
    expect(names('overdue')).toEqual(['F-2'])
    expect(names('completed')).toEqual([])
    expect(names('')).toEqual(['F-1', 'F-2'])
  })
})

const withLate = set(set(w.c, `${w.f1}:formed`, { status: 'in-progress' }), `${w.f2}:formed`, { plannedDate: '2026-10-01' })
vi.mock('../store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useConstruction: () => ({ idx: getIndex(withLate), state: withLate, today: TODAY }), useConstructionCommand: () => ({ run: () => {}, saving: false }) }))
vi.mock('@/lib/access', () => ({ useAccess: () => ({ can: () => true, role: 'editor', ready: true }) }))
const { ConstructionList, ConstructionTracker } = await import('../pages/ConstructionTracker')

describe('the Construction page', () => {
  const html = renderToStaticMarkup(<ConstructionTracker areaId={w.eh} />)
  it('shows the four gauges in order, with counts, and one card per foundation', () => {
    const titles = [...html.matchAll(/aria-label="(Not started|In progress|Completed|Overdue): (\d+) of (\d+) foundations/g)].map((m) => `${m[1]}:${m[2]}/${m[3]}`)
    expect(titles).toEqual(['Not started:1/2', 'In progress:1/2', 'Completed:0/2', 'Overdue:1/2'])
    expect((html.match(/role="img"/g) ?? []).length).toBeGreaterThanOrEqual(4) // the same ring component as Procurement
    expect(html).toContain('aria-label="Foundations"')
    expect(html).toMatch(/F-1: In progress/)
    expect(html).toMatch(/F-2: Not started, 0%, overdue/)
    expect(html).toContain('×5') // F-1 is five footings, one designation
  })
  it('shows Overdue as unavailable for an area where no activity has a planned date, and switching area switches the figures', () => {
    const other = renderToStaticMarkup(<ConstructionTracker areaId={w.pr} />)
    expect(other).toContain('No planned dates yet')
    expect(other).toContain('Not tracked')
    expect(other).toContain('aria-label="Not started: 1 of 1 foundations')
    expect(other).toContain('F-3')
    expect(other).not.toContain('F-1')
    expect(html).not.toContain('No planned dates yet')
  })
})

describe('All areas and the list view', () => {
  const ids = [w.eh, w.pr]
  it('project-wide counts add up across the areas', () => {
    const idx = getIndex(withLate)
    const all = projectTracks(idx, ids, TODAY), a = areaTracks(idx, w.eh, TODAY), b = areaTracks(idx, w.pr, TODAY)
    expect(all.tracks).toHaveLength(a.tracks.length + b.tracks.length)
    for (const k of ['not-started', 'in-progress', 'completed', 'overdue'] as const) expect(all.counts[k]).toBe(a.counts[k] + b.counts[k])
    expect(all.counts).toMatchObject({ 'not-started': 2, 'in-progress': 1, overdue: 1 })
    expect(all.scheduled).toBe(true) // one planned date anywhere in the project makes Overdue available
  })

  it('the All areas page shows every area\'s foundations with their area, and gauges across the project', () => {
    const html = renderToStaticMarkup(<ConstructionTracker areaId="all" areaIds={ids} />)
    expect([...html.matchAll(/aria-label="(Not started|In progress|Completed|Overdue): (\d+) of (\d+) foundations/g)].map((m) => `${m[1]}:${m[2]}/${m[3]}`)).toEqual(['Not started:2/3', 'In progress:1/3', 'Completed:0/3', 'Overdue:1/3'])
    for (const f of ['F-1', 'F-2', 'F-3']) expect(html).toContain(f)
    expect(html).toContain('E-House')
    expect(html).toContain('Pipe Rack')
    expect(html).toContain('Foundations view') // the Grid / List toggle
    expect(html).toMatch(/aria-pressed="true"[^>]*>Grid/)
    expect(html).toContain('>List<')
  })

  it('a single area still shows only its own foundations and does not label them with an area', () => {
    const html = renderToStaticMarkup(<ConstructionTracker areaId={w.pr} areaIds={ids} />)
    expect(html).toContain('F-3')
    expect(html).not.toContain('F-1')
    expect(html).not.toContain('Pipe Rack</span><span')
  })

  it('the list is a compact table of Foundation, Area, Footings, Progress and Status, one row per foundation', () => {
    const { tracks } = projectTracks(getIndex(withLate), ids, TODAY)
    const html = renderToStaticMarkup(<ConstructionList tracks={tracks} areaName={(id) => (id === w.eh ? 'E-House' : 'Pipe Rack')} onOpen={() => {}} />)
    for (const h of ['Foundation', 'Area', 'Footings', 'Progress', 'Status']) expect(html).toContain(`>${h}<`)
    expect((html.match(/<tr class="cursor-pointer/g) ?? []).length).toBe(3)
    expect(html).toMatch(/F-1: In progress, \d+%\. Open/)
    expect(html).toMatch(/F-2: Not started, 0%, overdue\. Open/)
    expect(html).toContain('>5<') // F-1's five footings
    expect(html).toContain('card-table') // becomes cards on a phone
  })

  it('the Construction selector offers All areas first, and the layout choice is remembered across areas', () => {
    const page = readFileSync('src/domains/construction/pages/Sections.tsx', 'utf8')
    expect(page.indexOf('>All areas</button>')).toBeLessThan(page.indexOf('{a.name}</button>'))
    const tracker = readFileSync('src/domains/construction/pages/ConstructionTracker.tsx', 'utf8')
    expect(tracker).toContain("usePersistentChoice<TrackerLayout>('nexus.construction.view'")
  })
})
