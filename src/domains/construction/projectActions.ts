import { blankActivitiesFor } from './blankActivities'
import { installOwners } from './anchorageMounts'
import { MODULES, SCOPE_ITEMS, templateSettings, type ProjectSettingsInput } from './projectSettings'
import { createArea, type Reducer, type Result } from './actions'
import type { ConstructionState, Project, ProjectModule, ProjectTemplate, ScopeItem } from './types'

const ok = (state: ConstructionState): Result => ({ state })
const fail = (error: string): Result => ({ error })

const MODULE_IDS = MODULES.map((m) => m.id)
const ITEM_IDS = SCOPE_ITEMS.map((i) => i.id)
const TEMPLATE_IDS: ProjectTemplate[] = ['full-concrete', 'grouting-only', 'custom']

/** The settings a create or update request may carry; anything else is refused rather than ignored. */
export interface ProjectSettingsPatch { useAreas?: boolean; modules?: Partial<Record<ProjectModule, boolean>>; scopeItems?: Partial<Record<ScopeItem, boolean>> }

export function settingsProblem(p: unknown): string | null {
  if (p === undefined) return null
  if (!p || typeof p !== 'object') return 'Project settings are not valid.'
  const o = p as Record<string, unknown>
  if (o.useAreas !== undefined && typeof o.useAreas !== 'boolean') return 'Choose whether the project uses areas.'
  for (const [field, ids] of [['modules', MODULE_IDS], ['scopeItems', ITEM_IDS]] as const) {
    const v = o[field]
    if (v === undefined) continue
    if (!v || typeof v !== 'object') return 'Project settings are not valid.'
    for (const [k, on] of Object.entries(v)) if (!(ids as string[]).includes(k) || typeof on !== 'boolean') return `Unknown ${field === 'modules' ? 'module' : 'construction scope item'}: ${k}.`
  }
  return null
}

/** The area a project's foundations belong to while it does not use areas: one hidden area, never listed. */
export const implicitAreaOf = (s: ConstructionState, projectId: string) => s.areas.find((a) => a.projectId === projectId && a.implicit)
/** Areas users see and choose from: none while the project does not use areas. */
export const visibleAreas = (s: ConstructionState, projectId: string) => (s.projects.find((p) => p.id === projectId)?.useAreas === false ? [] : s.areas.filter((a) => a.projectId === projectId && !a.implicit))

function withImplicitArea(s: ConstructionState, projectId: string): ConstructionState {
  if (implicitAreaOf(s, projectId)) return s
  const before = new Set(s.areas.map((a) => a.id))
  const r = createArea(projectId, 'Project', [])(s)
  if (r.error !== undefined) return s
  return { ...r.state, areas: r.state.areas.map((a) => (!before.has(a.id) ? { ...a, implicit: true } : a)) }
}

/**
 * Makes sure every foundation of the project has a (not started) record for every activity the project's scope can include, so switching a scope item on shows it at once
 * and an item switched off and on again finds the record that was kept. Records already there are never touched.
 */
export function ensureProjectActivities(s: ConstructionState, projectId: string): ConstructionState {
  const areas = new Set(s.areas.filter((a) => a.projectId === projectId).map((a) => a.id))
  const have = new Set(s.activities.map((a) => a.id))
  const add = s.foundations.filter((f) => areas.has(f.areaId)).flatMap((f) =>
    blankActivitiesFor(f, s.plinths.filter((p) => p.foundationId === f.id), installOwners(s)).filter((a) => !have.has(a.id)))
  return add.length ? { ...s, activities: [...s.activities, ...add] } : s
}

const withSettings = (p: Project, patch: ProjectSettingsPatch): Project => ({
  ...p,
  ...(patch.useAreas !== undefined ? { useAreas: patch.useAreas } : {}),
  modules: { ...(p.modules ?? {}), ...(patch.modules ?? {}) },
  scopeItems: { ...(p.scopeItems ?? {}), ...(patch.scopeItems ?? {}) },
})

/**
 * Applies the project's areas setting. Turning areas off needs all of its foundations in at most one area, which then becomes the project's hidden area (nothing
 * moves, so no record is touched); with foundations spread over several areas it is refused, since which area they should merge into is the user's decision.
 */
function applyAreaSetting(s: ConstructionState, projectId: string, useAreas: boolean): ConstructionState | string {
  const areas = s.areas.filter((a) => a.projectId === projectId)
  if (useAreas) return { ...s, areas: s.areas.map((a) => (a.projectId === projectId && a.implicit ? { ...a, implicit: false, name: a.name === 'Project' ? 'General' : a.name } : a)) }
  const used = areas.filter((a) => s.foundations.some((f) => f.areaId === a.id))
  if (used.length > 1) return `Foundations are in ${used.length} areas (${used.map((a) => a.name).join(', ')}). Move them into one area first, or keep Use Project Areas on.`
  if (used.length === 1) return { ...s, areas: s.areas.map((a) => (a.projectId === projectId ? { ...a, implicit: a.id === used[0].id } : a)) }
  return withImplicitArea(s, projectId)
}

export interface ProjectCreateOptions extends ProjectSettingsPatch { template?: ProjectTemplate; /** Area names to create (only when the project uses areas). */ areas?: string[] }

/** Called by `createProject` after the project exists: applies the template, the overrides and the areas. */
export function configureNewProject(s: ConstructionState, projectId: string, opts: ProjectCreateOptions): Result {
  const bad = settingsProblem(opts)
  if (bad) return fail(bad)
  if (opts.template !== undefined && !TEMPLATE_IDS.includes(opts.template)) return fail('Choose a project template.')
  const template = opts.template ?? 'full-concrete'
  const base = templateSettings(template)
  const settings: ProjectSettingsInput = { useAreas: opts.useAreas ?? base.useAreas, modules: { ...base.modules, ...(opts.modules ?? {}) }, scopeItems: { ...base.scopeItems, ...(opts.scopeItems ?? {}) } }
  let next: ConstructionState = { ...s, projects: s.projects.map((p) => (p.id === projectId ? { ...p, template, ...settings } : p)) }
  if (!settings.useAreas) return ok(withImplicitArea(next, projectId))
  for (const name of opts.areas ?? []) {
    if (!String(name).trim()) continue
    const r = createArea(projectId, name, [])(next)
    if (r.error !== undefined) return r
    next = r.state
  }
  return ok(next)
}

/** Changes a project's areas, modules and construction scope. Records are never deleted: what is switched off is hidden and left out of progress, and returns when switched on. */
export const updateProjectSettings = (id: string, patch: ProjectSettingsPatch): Reducer => (s) => {
  const p = s.projects.find((x) => x.id === id)
  if (!p) return fail('Project not found.')
  const bad = settingsProblem(patch)
  if (bad) return fail(bad)
  let next: ConstructionState = { ...s, projects: s.projects.map((x) => (x.id === id ? withSettings(x, patch) : x)) }
  if (patch.useAreas !== undefined && patch.useAreas !== (p.useAreas !== false)) {
    const r = applyAreaSetting(next, id, patch.useAreas)
    if (typeof r === 'string') return fail(r)
    next = r
  }
  return ok(ensureProjectActivities(next, id))
}

/** Archiving hides a project from the lists and the project switcher; restoring brings it back. Nothing is deleted either way. */
export const archiveProject = (id: string, archived: boolean): Reducer => (s) => {
  const p = s.projects.find((x) => x.id === id)
  if (!p) return fail('Project not found.')
  if (!!p.archived === !!archived) return ok(s)
  return ok({ ...s, projects: s.projects.map((x) => (x.id === id ? { ...x, archived: !!archived } : x)) })
}

/**
 * Permanently deletes an archived project and its construction records (areas, foundations, plinths, activities, anchorage library, pours). Safeguards: only an
 * archived project; the name must be typed exactly; refused while any procurement record belongs to one of its areas, and when procurement cannot be checked. The
 * database also refuses it while fleet assignments or other records still point at the project.
 */
export const deleteProject = (id: string, confirmName: string): Reducer => (s, ctx) => {
  const p = s.projects.find((x) => x.id === id)
  if (!p) return fail('Project not found.')
  if (!p.archived) return fail('Archive the project first. Only an archived project can be deleted.')
  if (String(confirmName ?? '').trim() !== p.name) return fail('Type the project name exactly to confirm the deletion.')
  if (!ctx?.materials) return fail('Procurement records could not be checked, so the project was not deleted.')
  const areas = new Set(s.areas.filter((a) => a.projectId === id).map((a) => a.id))
  const m = ctx.materials
  const used = [...m.lines, ...m.manual].filter((l) => l.areaId && areas.has(l.areaId)).length
    + (m.orderLines ?? []).filter((l) => l.areaId && areas.has(l.areaId)).length + (m.installations ?? []).filter((l) => l.areaId && areas.has(l.areaId)).length
  if (used > 0) return fail(`${used} procurement record${used === 1 ? ' belongs' : 's belong'} to this project. Delete or move them first; the project can stay archived.`)
  const foundations = new Set(s.foundations.filter((f) => areas.has(f.areaId)).map((f) => f.id))
  const plinths = new Set(s.plinths.filter((x) => foundations.has(x.foundationId)).map((x) => x.id))
  const types = new Set(s.anchorageTypes.filter((t) => t.projectId === id).map((t) => t.id))
  const pours = new Set((s.pours ?? []).filter((x) => x.projectId === id).map((x) => x.id))
  return ok({
    ...s,
    projects: s.projects.filter((x) => x.id !== id),
    projectIssues: s.projectIssues.filter((i) => i.projectId !== id),
    areas: s.areas.filter((a) => !areas.has(a.id)),
    handover: s.handover.filter((h) => !areas.has(h.areaId)),
    foundations: s.foundations.filter((f) => !foundations.has(f.id)),
    plinths: s.plinths.filter((x) => !plinths.has(x.id)),
    activities: s.activities.filter((a) => !foundations.has(a.foundationId)),
    anchorageGroups: (s.anchorageGroups ?? []).filter((g) => !foundations.has(g.foundationId)),
    foundationAnchorages: s.foundationAnchorages === undefined ? undefined : s.foundationAnchorages.filter((a) => !foundations.has(a.foundationId)),
    foundationBolts: s.foundationBolts === undefined ? undefined : s.foundationBolts.filter((b) => !foundations.has(b.foundationId)),
    foundationEmbeds: s.foundationEmbeds === undefined ? undefined : s.foundationEmbeds.filter((e) => !foundations.has(e.foundationId)),
    foundationUnits: s.foundationUnits === undefined ? undefined : s.foundationUnits.filter((u) => !foundations.has(u.foundationId)),
    libraryEmbedPlates: s.libraryEmbedPlates === undefined ? undefined : s.libraryEmbedPlates.filter((x) => x.projectId !== id),
    anchorageTypes: s.anchorageTypes.filter((t) => !types.has(t.id)),
    anchorageComponents: s.anchorageComponents === undefined ? undefined : s.anchorageComponents.filter((c) => !types.has(c.anchorageTypeId)),
    pours: s.pours === undefined ? undefined : s.pours.filter((x) => !pours.has(x.id)),
    pourItems: s.pourItems === undefined ? undefined : s.pourItems.filter((x) => !pours.has(x.pourId)),
  })
}

