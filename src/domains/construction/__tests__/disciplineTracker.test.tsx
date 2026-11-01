import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as K from '../actions'
import { areaTracks, DISCIPLINES, doneStatus, foundationTrack, projectTracks, matchesFilter, trackLabel, trackedActivities } from '../constructionProgress'
import { computeStats, foundationState, getIndex } from '../selectors'
import { packageProgress } from '../packageProgress'
import { emptyTracker } from '../tracker/types'
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
const { DisciplineList, DisciplineTracker } = await import('../pages/DisciplineTracker')

describe('the Construction page', () => {
  const html = renderToStaticMarkup(<DisciplineTracker discipline="construction" areaId={w.eh} />)
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
    const other = renderToStaticMarkup(<DisciplineTracker discipline="construction" areaId={w.pr} />)
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
    const html = renderToStaticMarkup(<DisciplineTracker discipline="construction" areaId="all" areaIds={ids} />)
    expect([...html.matchAll(/aria-label="(Not started|In progress|Completed|Overdue): (\d+) of (\d+) foundations/g)].map((m) => `${m[1]}:${m[2]}/${m[3]}`)).toEqual(['Not started:2/3', 'In progress:1/3', 'Completed:0/3', 'Overdue:1/3'])
    for (const f of ['F-1', 'F-2', 'F-3']) expect(html).toContain(f)
    expect(html).toContain('E-House')
    expect(html).toContain('Pipe Rack')
    expect(html).toContain('Foundations view') // the Grid / List toggle
    expect(html).toMatch(/aria-pressed="true"[^>]*>Grid/)
    expect(html).toContain('>List<')
  })

  it('a single area still shows only its own foundations and does not label them with an area', () => {
    const html = renderToStaticMarkup(<DisciplineTracker discipline="construction" areaId={w.pr} areaIds={ids} />)
    expect(html).toContain('F-3')
    expect(html).not.toContain('F-1')
    expect(html).not.toContain('Pipe Rack</span><span')
  })

  it('the list is a compact table of Foundation, Area, Footings, Progress and Status, one row per foundation', () => {
    const { tracks } = projectTracks(getIndex(withLate), ids, TODAY)
    const html = renderToStaticMarkup(<DisciplineList tracks={tracks} areaName={(id) => (id === w.eh ? 'E-House' : 'Pipe Rack')} onOpen={() => {}} />)
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
    const tracker = readFileSync('src/domains/construction/pages/DisciplineTracker.tsx', 'utf8')
    expect(tracker).toContain("usePersistentChoice<TrackerLayout>('nexus.construction.view'")
  })
})

const track = (c: ConstructionState, fid: string, d: Parameters<typeof foundationTrack>[3]) => foundationTrack(getIndex(c), c.foundations.find((f) => f.id === fid)!, TODAY, d)
const labels = (c: ConstructionState, d: Parameters<typeof foundationTrack>[3]) => track(c, w.f1, d).acts.map((a) => `${a.scope}:${a.key}`)

describe('Survey, QA/QC and Civil / Earthworks use the same tracker', () => {
  it('each discipline lists its own activities, reusing the existing definitions and adding only what was missing', () => {
    const survey = labels(w.c, 'survey')
    for (const k of ['footing:layout', 'plinth:layout', 'footing:preSurvey', 'footing:postSurvey', 'plinth:preSurvey', 'plinth:postSurvey', 'plinth:anchorBoltSurvey']) expect(survey, k).toContain(k)
    expect(survey).toHaveLength(7 + (survey.length - 7)) // one plinth here: exactly the seven asked for
    expect(survey).toHaveLength(7)
    const qaqc = labels(w.c, 'qaqc')
    for (const k of ['footing:preInspection', 'footing:postInspection', 'plinth:preInspection', 'plinth:postInspection', 'plinth:anchorBoltVerification']) expect(qaqc, k).toContain(k)
    expect(qaqc).toHaveLength(5)
    expect(labels(w.c, 'civil')).toEqual(['excavation', 'subgradePrep', 'compaction', 'elevationVerification', 'backfill', 'finalGrading'].map((k) => `footing:${k}`))
    expect(DISCIPLINES.civil.title).toBe('Civil / Earthworks')
  })

  it('the disciplines do not overlap, so one record is never counted in two trackers', () => {
    const all = (['construction', 'survey', 'qaqc', 'civil'] as const).flatMap((d) => track(w.c, w.f1, d).acts.map((a) => a.id))
    expect(new Set(all).size).toBe(all.length)
  })

  it('completing a QA/QC activity approves it; completing a survey or civil activity marks it complete; both count as done', () => {
    const t = track(w.c, w.f1, 'qaqc').acts[0]
    expect(doneStatus(t)).toBe('approved')
    expect(doneStatus(track(w.c, w.f1, 'survey').acts[0])).toBe('complete')
    let c = set(w.c, t.id, { status: doneStatus(t) })
    expect(track(c, w.f1, 'qaqc')).toMatchObject({ state: 'in-progress', done: 1 })
    c = track(c, w.f1, 'qaqc').acts.reduce((s, a) => set(s, a.id, { status: doneStatus(a) }), c)
    expect(track(c, w.f1, 'qaqc')).toMatchObject({ state: 'completed', percent: 100 })
    expect(track(c, w.f1, 'survey').state).toBe('not-started') // completing one discipline never completes another
    expect(track(c, w.f1, 'construction').state).toBe('not-started')
  })

  it('percent is completed over applicable activities, the same rule as the Project Status indicators', () => {
    let c = w.c
    for (const d of ['survey', 'qaqc'] as const) for (const a of track(c, w.f1, d).acts.slice(0, 2)) c = set(c, a.id, { status: doneStatus(a) })
    const idx = getIndex(c)
    for (const [d, key] of [['survey', 'survey'], ['qaqc', 'qaqc']] as const) {
      const { tracks } = areaTracks(idx, w.eh, TODAY, d)
      const done = tracks.reduce((a, t) => a + t.done, 0), total = tracks.reduce((a, t) => a + t.total, 0)
      expect(packageProgress(idx, w.eh, emptyTracker()).find((i) => i.key === key)!.percent).toBe(Math.round((done / total) * 100))
    }
  })

  it('civil work is its own record: it does not change construction state, progress or the current step, and shows on the foundation', () => {
    const before = foundationState(getIndex(w.c), w.c.foundations[0])
    const civil = track(w.c, w.f1, 'civil').acts[0]
    const c = set(w.c, civil.id, { status: 'complete' })
    expect(foundationState(getIndex(c), c.foundations[0])).toEqual(before)
    expect(track(c, w.f1, 'civil')).toMatchObject({ state: 'in-progress', done: 1 })
    expect(track(c, w.f1, 'construction')).toMatchObject({ state: 'not-started', percent: 0 })
  })

  it('Overdue needs a planned date in the discipline: none means Not tracked, a late one makes it overdue', () => {
    const none = areaTracks(getIndex(w.c), w.eh, TODAY, 'civil')
    expect(none.scheduled).toBe(false)
    const a = track(w.c, w.f1, 'civil').acts[1]
    const c = set(w.c, a.id, { plannedDate: '2026-10-01' })
    const late = areaTracks(getIndex(c), w.eh, TODAY, 'civil')
    expect(late.scheduled).toBe(true)
    expect(late.counts.overdue).toBe(1)
    expect(areaTracks(getIndex(c), w.eh, TODAY, 'survey').scheduled).toBe(false) // the date belongs to civil only
  })

  it('every discipline page has the gauges, All areas, the Grid / List toggle and cards', () => {
    for (const d of ['construction', 'survey', 'qaqc', 'civil'] as const) {
      const html = renderToStaticMarkup(<DisciplineTracker discipline={d} areaId="all" areaIds={[w.eh, w.pr]} />)
      expect([...html.matchAll(/aria-label="(Not started|In progress|Completed|Overdue): \d+ of 3 foundations/g)].map((m) => m[1]), d).toEqual(['Not started', 'In progress', 'Completed', 'Overdue'])
      expect(html, d).toContain('Foundations view')
      expect(html, d).toContain('aria-label="Foundations"')
      expect(html, d).toContain('E-House')
    }
    const page = readFileSync('src/domains/construction/pages/Sections.tsx', 'utf8')
    expect(page).toContain('<DisciplineTracker discipline={kind}')
    const routes = readFileSync('src/domains/construction/routes.tsx', 'utf8')
    for (const k of ['construction', 'survey', 'qaqc', 'civil']) expect(routes).toContain(`<ManageDiscipline kind="${k}" />`)
  })
})
