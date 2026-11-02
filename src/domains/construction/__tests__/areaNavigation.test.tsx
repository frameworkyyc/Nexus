import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { packageProgress } from '../packageProgress'
import { getIndex } from '../selectors'
import { emptyTracker } from '../tracker/types'
import { world } from './materialsFixtures'

const w = world()
const idx = getIndex(w.c)
vi.mock('../store', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useConstruction: () => ({ idx, state: w.c, today: '2026-10-30' }) }))

const { AREA_TABS, Quality, resolveAreaTab } = await import('../pages/AreaPage')
const { PACKAGE_TAB } = await import('../pages/PackageDashboard')

describe('area tabs', () => {
  it('are the same five, in this order, for every area', () => {
    expect(AREA_TABS.map((t) => t.label)).toEqual(['Overview', 'Materials', 'Construction', 'Survey', 'QA/QC'])
    expect(AREA_TABS.map((t) => t.id)).toEqual(['overview', 'materials', 'construction', 'survey', 'qaqc'])
    expect(AREA_TABS.some((t) => /foundations|handover|installation/i.test(t.label))).toBe(false)
  })

  it('keeps old ?tab= bookmarks working: Foundations and Handover now live in Overview, Survey & QA/QC became two tabs', () => {
    expect(resolveAreaTab('register')).toEqual({ tab: 'overview', legacy: true })
    expect(resolveAreaTab('handover')).toEqual({ tab: 'overview', legacy: true })
    expect(resolveAreaTab('quality')).toEqual({ tab: 'survey', legacy: true })
    expect(resolveAreaTab('nonsense')).toEqual({ tab: 'overview', legacy: true })
    for (const t of AREA_TABS) expect(resolveAreaTab(t.id)).toEqual({ tab: t.id, legacy: false })
    expect(resolveAreaTab(null)).toEqual({ tab: 'overview', legacy: false })
  })
})

describe('area progress graphs', () => {
  const items = packageProgress(idx, w.eh, emptyTracker())
  it('are Materials, Construction, Survey, QA/QC, in that order, with no "Installation"', () => {
    expect(items.map((i) => i.title)).toEqual(['Materials', 'Construction', 'Survey', 'QA/QC'])
  })
  it('each opens its own tab', () => {
    expect(items.map((i) => PACKAGE_TAB[i.key])).toEqual(['materials', 'construction', 'survey', 'qaqc'])
    for (const i of items) expect(AREA_TABS.map((t) => t.id)).toContain(PACKAGE_TAB[i.key])
  })
})

describe('Survey and QA/QC views', () => {
  const at = (kind: 'survey' | 'qaqc' | 'both') => renderToStaticMarkup(<MemoryRouter><Quality projectId={w.c.projects[0].id} areaId={w.eh} kind={kind} /></MemoryRouter>)
  it('Survey shows only survey checks', () => {
    const out = at('survey')
    for (const c of ['Layout', 'Pre-pour survey', 'As-built survey']) expect(out).toContain(`>${c}<`)
    expect(out).not.toContain('(CM03)')
    expect(out).not.toContain('(CM04)')
  })
  it('QA/QC shows only inspections', () => {
    const out = at('qaqc')
    expect(out).toContain('Pre-pour inspection (CM03)')
    expect(out).toContain('Post-pour inspection (CM04)')
    for (const c of ['>Layout<', '>Pre-pour survey<', '>As-built survey<']) expect(out).not.toContain(c)
  })
  it('both views list the same foundations, and the combined table (used by Project Management) keeps all five columns', () => {
    const rows = (h: string) => (h.match(/<tr class="border-b border-line">/g) ?? []).length
    expect(rows(at('survey'))).toBe(rows(at('qaqc')))
    expect(rows(at('survey'))).toBeGreaterThan(0)
    const both = at('both')
    for (const c of ['Layout', 'Pre-pour survey', 'As-built survey', 'Pre-pour inspection (CM03)', 'Post-pour inspection (CM04)']) expect(both).toContain(c)
  })
})
