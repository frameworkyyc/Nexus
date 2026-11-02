import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { completionOf } from '../completionBasis'
import { emptyConstruction } from '../empty'
import { implicitAreaOf, visibleAreas } from '../projectActions'
import { activityApplicable, settingsOf, usesAreas } from '../projectSettings'
import { deriveExceptions } from '../exceptions'
import { foundationActivities, foundationState, foundationsOfProject, getIndex, progressOf } from '../selectors'
import type { ConstructionState, Foundation } from '../types'
import { emptyTracker } from '../tracker/types'

function apply(s: ConstructionState, r: K.Reducer, ctx?: K.Ctx): ConstructionState { const o = r(s, ctx); if (o.error !== undefined) throw new Error(o.error); return o.state }
const err = (s: ConstructionState, r: K.Reducer, ctx?: K.Ctx) => r(s, ctx).error
const TODAY = '2026-11-02'
const base = () => apply({ ...emptyConstruction(), company: { id: '', name: '' } }, K.createOrganization({ name: 'Northline' }))
const idxOf = (s: ConstructionState) => getIndex(s)
const acts = (s: ConstructionState, f: Foundation) => foundationActivities(idxOf(s), f)
const mark = (s: ConstructionState, f: Foundation, key: string) => apply(s, K.updateActivity(`${f.id}:${key}`, { status: 'complete' }, TODAY))
const find = (s: ConstructionState, number: string) => s.foundations.find((f) => f.number === number) as Foundation

/** REEF-like: created the way every project was before configuration existed (no settings at all). */
function reef() {
  let s = apply(base(), K.createProject({ name: 'REEF', template: undefined }))
  s = { ...s, projects: s.projects.map((p) => { const { template: _t, modules: _m, scopeItems: _s, useAreas: _u, ...rest } = p; void _t; void _m; void _s; void _u; return rest }) }
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'Area A', [{ number: 'F-1', description: '', plinthCount: 0 }, { number: 'F-2', description: '', plinthCount: 0 }]))
  s = apply(s, K.createArea(pid, 'Area B', [{ number: 'F-3', description: '', plinthCount: 0 }]))
  return { s, pid }
}
const grouting = (name = 'Grouting job') => {
  const s = apply(base(), K.createProject({ name, template: 'grouting-only' }))
  return { s, pid: s.projects[0].id }
}

describe('1. an existing project keeps its areas, modules, activities and progress', () => {
  it('a project with no settings reads as everything on, with the new scope items off', () => {
    const { s, pid } = reef()
    const p = s.projects[0]
    expect(usesAreas(p)).toBe(true)
    expect(settingsOf(p).modules).toEqual({ progress: true, survey: true, procurement: true, qaqc: true, civil: true, fleet: true, safety: true })
    expect(settingsOf(p).scopeItems).toMatchObject({ rebarBuilt: true, rebarInstalled: true, formed: true, poured: true, anchorBolts: true, embeds: true, equipmentSet: false, grouted: false })
    expect(visibleAreas(s, pid).map((a) => a.name)).toEqual(['Area A', 'Area B'])
    const f = find(s, 'F-1')
    const keys = acts(s, f).map((a) => a.key)
    expect(keys).toEqual(expect.arrayContaining(['layout', 'rebarBuilt', 'formed', 'poured', 'postSurvey', 'postInspection', 'excavation']))
    expect(keys).not.toContain('equipmentSet') // never artificial work on an existing project
    expect(keys).not.toContain('grouted')
  })

  it('progress is exactly what it was: four stages of the existing activities', () => {
    const { s: s0 } = reef()
    let s = s0
    const f = find(s, 'F-1')
    for (const k of ['rebarBuilt', 'rebarInstalled', 'formed']) s = mark(s, f, k)
    expect(progressOf(idxOf(s), acts(s, f))).toBe(67) // rebar, forming done; pouring not: 2 of 3 stages
    s = mark(s, f, 'poured')
    expect(progressOf(idxOf(s), acts(s, f))).toBe(100)
    expect(foundationState(idxOf(s), f).state).toBe('constructed')
  })
})

describe('2–3. a grouting-only project, areas off, foundations without choosing an area', () => {
  it('has no visible areas and one hidden area; the template sets modules and scope', () => {
    const { s, pid } = grouting()
    const p = s.projects[0]
    expect(usesAreas(p)).toBe(false)
    expect(visibleAreas(s, pid)).toEqual([])
    expect(implicitAreaOf(s, pid)).toMatchObject({ implicit: true, projectId: pid })
    expect(settingsOf(p).modules).toMatchObject({ progress: true, survey: false, procurement: false, qaqc: false, civil: false, fleet: false })
    expect(settingsOf(p).scopeItems).toMatchObject({ rebarBuilt: false, rebarInstalled: false, formed: false, poured: false, anchorBolts: false, embeds: false, equipmentSet: true, grouted: true })
  })

  it('a foundation is created for the project itself, and lands in the hidden area', () => {
    const { s: s0, pid } = grouting()
    const s = apply(s0, K.createFoundation(pid, 'P-101', 'Pump base', null, 1))
    expect(find(s, 'P-101').areaId).toBe(implicitAreaOf(s, pid)!.id)
    expect(foundationsOfProject(idxOf(s), pid).map((f) => f.number)).toEqual(['P-101'])
    // The hidden area's id works too, and a name is still unique within the project.
    const again = apply(s, K.createFoundation(implicitAreaOf(s, pid)!.id, 'P-102', '', null, 1))
    expect(again.foundations).toHaveLength(2)
    expect(err(s, K.createFoundation(pid, 'P-101', '', null, 1))).toMatch(/already/i)
  })

  it('only the project\'s scope exists on its foundations', () => {
    const { s: s0, pid } = grouting()
    const s = apply(s0, K.createFoundation(pid, 'P-101', '', null, 1))
    const f = find(s, 'P-101')
    expect(acts(s, f).map((a) => a.key).sort()).toEqual(['equipmentSet', 'grouted'])
    expect(err(s, K.updateActivity(`${f.id}:poured`, { status: 'complete' }, TODAY))).toMatch(/not part of the project/)
    expect(err(s, K.updateActivity(`${f.id}:layout`, { status: 'complete' }, TODAY))).toMatch(/not part of the project/)
  })
})

describe('a new grouting project does not report problems it cannot have', () => {
  it('raises no issue for work outside its scope', () => {
    const { s: s0, pid } = grouting()
    const s = apply(s0, K.createFoundation(pid, 'P-101', '', null, 1))
    expect(deriveExceptions(idxOf(s), TODAY, pid).map((e) => e.title)).toEqual([])
  })
})

describe('4–5. equipment setting and grouting are tracked independently, and complete the project', () => {
  it('each moves the progress by its own share, and 100% needs only the contracted scope', () => {
    const { s: s0, pid } = grouting()
    let s = apply(s0, K.createFoundation(pid, 'P-101', '', null, 2, { footing: { length: 2, width: 2, height: 0.5, unit: 'm' } }))
    const f = find(s, 'P-101')
    const pct = () => progressOf(idxOf(s), acts(s, f))
    expect(pct()).toBe(0)
    s = mark(s, f, 'grouted') // grouting can be recorded without the equipment-setting record: they are independent
    expect(pct()).toBe(50)
    expect(foundationState(idxOf(s), f).state).not.toBe('constructed')
    s = mark(s, f, 'equipmentSet')
    expect(pct()).toBe(100)
    expect(['constructed', 'closed-out']).toContain(foundationState(idxOf(s), f).state) // with no survey or QA/QC in the scope there is nothing else to close out
    const i = idxOf(s)
    for (const b of ['type', 'count', 'volume'] as const) expect(completionOf(i, foundationsOfProject(i, pid), b).percent, b).toBe(100)
  })

  it('equipment alone is 50%, and the two are never confused', () => {
    const { s: s0, pid } = grouting()
    let s = apply(s0, K.createFoundation(pid, 'P-101', '', null, 1))
    const f = find(s, 'P-101')
    s = mark(s, f, 'equipmentSet')
    expect(progressOf(idxOf(s), acts(s, f))).toBe(50)
    expect(acts(s, f).find((a) => a.key === 'grouted')!.status).toBe('not-started')
  })
})

describe('6. modules and scope switch off and on without losing data', () => {
  it('survey: hidden and excluded while off, the record is kept and returns when on', () => {
    const { s: s0, pid } = reef()
    const f = find(s0, 'F-1')
    let s = mark(s0, f, 'layout')
    const before = s.activities.find((a) => a.id === `${f.id}:layout`)!
    s = apply(s, K.updateProjectSettings(pid, { modules: { survey: false } }))
    expect(acts(s, f).some((a) => a.key === 'layout')).toBe(false)
    expect(s.activities.find((a) => a.id === before.id)).toEqual(before) // the record is still there
    expect(err(s, K.updateActivity(before.id, { status: 'not-started' }, TODAY))).toMatch(/not part of the project/)
    s = apply(s, K.updateProjectSettings(pid, { modules: { survey: true } }))
    expect(acts(s, f).find((a) => a.key === 'layout')).toMatchObject({ status: 'complete', actualDate: before.actualDate })
  })

  it('a construction scope item: progress follows the scope, and the record survives', () => {
    const { s: s0, pid } = reef()
    const f = find(s0, 'F-1')
    let s = mark(mark(s0, f, 'formed'), f, 'poured')
    const pct = (x: ConstructionState) => progressOf(idxOf(x), acts(x, f))
    expect(pct(s)).toBe(67) // rebar stage 0; forming and pouring done
    s = apply(s, K.updateProjectSettings(pid, { scopeItems: { rebarBuilt: false, rebarInstalled: false } }))
    expect(pct(s)).toBe(100) // rebar is no longer part of the scope
    s = apply(s, K.updateProjectSettings(pid, { scopeItems: { rebarBuilt: true, rebarInstalled: true } }))
    expect(pct(s)).toBe(67)
  })

  it('switching on a scope item adds a not-started record on existing foundations, and a progress share', () => {
    const { s: s0, pid } = reef()
    const f = find(s0, 'F-1')
    let s = ['rebarBuilt', 'rebarInstalled', 'formed', 'poured'].reduce((acc, k) => mark(acc, f, k), s0)
    expect(progressOf(idxOf(s), acts(s, f))).toBe(100)
    s = apply(s, K.updateProjectSettings(pid, { scopeItems: { grouted: true } }))
    expect(acts(s, f).find((a) => a.key === 'grouted')).toMatchObject({ status: 'not-started' })
    expect(progressOf(idxOf(s), acts(s, f))).toBe(75) // scope grew: nothing is marked complete on its behalf
  })

  it('rejects settings it does not know', () => {
    const { s, pid } = reef()
    expect(err(s, K.updateProjectSettings(pid, { modules: { bogus: true } as never }))).toMatch(/Unknown module/)
    expect(err(s, K.updateProjectSettings(pid, { scopeItems: { poured: 'yes' } as never }))).toMatch(/Unknown construction scope/)
    expect(err(s, K.updateProjectSettings('nope', {}))).toMatch(/not found/)
  })
})

describe('areas can be switched off only when nothing is ambiguous', () => {
  it('foundations in several areas: refused. In one area: that area becomes the hidden one. Back on: visible again', () => {
    const { s, pid } = reef()
    expect(err(s, K.updateProjectSettings(pid, { useAreas: false }))).toMatch(/Move them into one area/)
    // Move F-3 into Area A, then areas can go.
    const areaA = s.areas.find((a) => a.name === 'Area A')!.id
    const one = apply(s, K.editFoundation(find(s, 'F-3').id, { areaId: areaA }), { materials: emptyTracker() })
    const off = apply(one, K.updateProjectSettings(pid, { useAreas: false }))
    expect(visibleAreas(off, pid)).toEqual([])
    expect(implicitAreaOf(off, pid)!.id).toBe(areaA)
    expect(off.foundations.map((f) => f.areaId)).toEqual(one.foundations.map((f) => f.areaId)) // nothing moved
    const on = apply(off, K.updateProjectSettings(pid, { useAreas: true }))
    expect(visibleAreas(on, pid).map((a) => a.id)).toContain(areaA)
  })
})

describe('7. projects are isolated', () => {
  it('each project sees only its own foundations and progress', () => {
    const { s: s0 } = reef()
    const g = apply(s0, K.createProject({ name: 'Grouting job', template: 'grouting-only' }))
    const gid = g.projects[1].id
    const s = apply(g, K.createFoundation(gid, 'P-1', '', null, 1))
    const i = idxOf(s)
    expect(foundationsOfProject(i, s.projects[0].id).map((f) => f.number).sort()).toEqual(['F-1', 'F-2', 'F-3'])
    expect(foundationsOfProject(i, gid).map((f) => f.number)).toEqual(['P-1'])
    const fg = find(s, 'P-1')
    expect(activityApplicable(s.projects[1], 'footing', 'poured')).toBe(false)
    expect(activityApplicable(s.projects[0], 'footing', 'poured')).toBe(true)
    expect(acts(s, fg).every((a) => a.foundationId === fg.id)).toBe(true)
  })
})

describe('8. archive, restore, edit and delete', () => {
  const ctx = { materials: emptyTracker() }
  it('archive and restore keep every record', () => {
    const { s, pid } = reef()
    const archived = apply(s, K.archiveProject(pid, true))
    expect(archived.projects[0].archived).toBe(true)
    expect(archived.foundations).toHaveLength(3)
    const back = apply(archived, K.archiveProject(pid, false))
    expect(back.projects[0].archived).toBe(false)
    expect(back.foundations).toHaveLength(3)
  })

  it('delete: only archived, only with the exact name, and only without procurement records', () => {
    const { s, pid } = grouting()
    const withFound = apply(s, K.createFoundation(pid, 'P-1', '', null, 1))
    expect(err(withFound, K.deleteProject(pid, 'Grouting job'), ctx)).toMatch(/Archive the project first/)
    const archived = apply(withFound, K.archiveProject(pid, true))
    expect(err(archived, K.deleteProject(pid, 'grouting job'), ctx)).toMatch(/Type the project name exactly/)
    expect(err(archived, K.deleteProject(pid, 'Grouting job'))).toMatch(/could not be checked/)
    const area = implicitAreaOf(archived, pid)!.id
    const busy = { materials: { ...emptyTracker(), manual: [{ areaId: area } as never] } }
    expect(err(archived, K.deleteProject(pid, 'Grouting job'), busy)).toMatch(/procurement record/)
    const gone = apply(archived, K.deleteProject(pid, 'Grouting job'), ctx)
    expect(gone.projects).toEqual([])
    for (const k of ['areas', 'foundations', 'plinths', 'activities', 'handover'] as const) expect(gone[k], k).toEqual([])
  })

  it('deleting one project leaves the others untouched', () => {
    const { s: s0 } = reef()
    const g = apply(s0, K.createProject({ name: 'Grouting job', template: 'grouting-only' }))
    const gid = g.projects[1].id
    const archived = apply(g, K.archiveProject(gid, true))
    const gone = apply(archived, K.deleteProject(gid, 'Grouting job'), ctx)
    expect(gone.projects.map((p) => p.name)).toEqual(['REEF'])
    expect(gone.foundations).toHaveLength(3)
    expect(gone.areas).toHaveLength(2)
  })

  it('editing a project keeps its configuration', () => {
    const { s, pid } = grouting()
    const edited = apply(s, K.updateProject(pid, { description: 'Pump bases', scope: 'Grouting', status: 'active' }))
    expect(edited.projects[0]).toMatchObject({ description: 'Pump bases', useAreas: false, template: 'grouting-only' })
    expect(settingsOf(edited.projects[0]).scopeItems.grouted).toBe(true)
  })
})
