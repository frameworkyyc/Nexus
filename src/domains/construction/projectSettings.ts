import { getDef, INSTALL_ACTIVITY_KEY } from './config'
import type { ActivityScope, Project, ProjectModule, ProjectTemplate, ScopeItem } from './types'

/**
 * What a project includes. Everything here is a setting of the project, not a property of the code: REEF and a grouting-only project are the same application with different
 * settings. Switching something off hides it (navigation, dashboards, progress) and never deletes a record, so it can be switched back on.
 */
export const MODULES: { id: ProjectModule; label: string; description: string }[] = [
  { id: 'progress', label: 'Construction Progress', description: 'Foundations, construction activities and progress.' },
  { id: 'survey', label: 'Survey', description: 'Layout, pre-pour, as-built and anchor bolt surveys.' },
  { id: 'procurement', label: 'Procurement', description: 'Materials, purchase orders and deliveries.' },
  { id: 'qaqc', label: 'QA/QC', description: 'Inspections and anchor bolt verification.' },
  { id: 'civil', label: 'Civil / Earthworks', description: 'Excavation, compaction, backfill and grading.' },
  { id: 'fleet', label: 'Fleet', description: 'Vehicles and equipment assigned to the project.' },
  { id: 'safety', label: 'Safety', description: 'Safety records for the project.' },
]

/** Construction scope: the activities a project's contract covers. Only these count toward construction completion. */
export const SCOPE_ITEMS: { id: ScopeItem; label: string; keys: string[]; defaultOn: boolean }[] = [
  { id: 'rebarBuilt', label: 'Rebar fabrication', keys: ['rebarBuilt'], defaultOn: true },
  { id: 'rebarInstalled', label: 'Rebar installation', keys: ['rebarInstalled'], defaultOn: true },
  { id: 'formed', label: 'Forming', keys: ['formed'], defaultOn: true },
  { id: 'poured', label: 'Concrete placement', keys: ['poured'], defaultOn: true },
  { id: 'anchorBolts', label: 'Anchor bolt installation', keys: [INSTALL_ACTIVITY_KEY.bolts], defaultOn: true },
  { id: 'embeds', label: 'Embed plate installation', keys: [INSTALL_ACTIVITY_KEY.embeds], defaultOn: true },
  // New scope items start switched off, so no existing project suddenly has work that was never part of it.
  { id: 'equipmentSet', label: 'Equipment setting', keys: ['equipmentSet'], defaultOn: false },
  { id: 'grouted', label: 'Grouting', keys: ['grouted'], defaultOn: false },
]
const ITEM_OF_KEY = new Map(SCOPE_ITEMS.flatMap((i) => i.keys.map((k) => [k, i.id] as const)))

export interface ProjectSettingsInput { useAreas: boolean; modules: Record<ProjectModule, boolean>; scopeItems: Record<ScopeItem, boolean> }

const allModules = (on: boolean): Record<ProjectModule, boolean> => Object.fromEntries(MODULES.map((m) => [m.id, on])) as Record<ProjectModule, boolean>
const scopeWith = (on: ScopeItem[]): Record<ScopeItem, boolean> => Object.fromEntries(SCOPE_ITEMS.map((i) => [i.id, on.includes(i.id)])) as Record<ScopeItem, boolean>

/** Starting points for a new project. Each is only a set of settings, editable afterwards. */
export const PROJECT_TEMPLATES: { id: ProjectTemplate; label: string; description: string; settings: ProjectSettingsInput }[] = [
  { id: 'full-concrete', label: 'Full concrete foundations', description: 'Areas, foundations, survey, procurement and the whole concrete scope: rebar, forming, concrete, anchor bolts and embed plates.', settings: { useAreas: true, modules: allModules(true), scopeItems: scopeWith(['rebarBuilt', 'rebarInstalled', 'formed', 'poured', 'anchorBolts', 'embeds']) } },
  { id: 'grouting-only', label: 'Grouting only', description: 'Equipment setting and grouting after the concrete is placed. No areas, survey or procurement.', settings: { useAreas: false, modules: { ...allModules(false), progress: true, safety: true }, scopeItems: scopeWith(['equipmentSet', 'grouted']) } },
  { id: 'custom', label: 'Custom project', description: 'Start from the full set and switch off what does not apply.', settings: { useAreas: true, modules: allModules(true), scopeItems: scopeWith(['rebarBuilt', 'rebarInstalled', 'formed', 'poured', 'anchorBolts', 'embeds']) } },
]
export const templateSettings = (id: ProjectTemplate): ProjectSettingsInput => PROJECT_TEMPLATES.find((t) => t.id === id)?.settings ?? PROJECT_TEMPLATES[0].settings

type Cfg = Pick<Project, 'modules' | 'scopeItems' | 'useAreas'> | null | undefined
export const moduleOn = (p: Cfg, m: ProjectModule) => p?.modules?.[m] ?? true
export const scopeOn = (p: Cfg, i: ScopeItem) => p?.scopeItems?.[i] ?? SCOPE_ITEMS.find((x) => x.id === i)!.defaultOn
export const usesAreas = (p: Cfg) => p?.useAreas !== false

/** The full effective settings of a project (defaults filled in), for forms. */
export const settingsOf = (p: Cfg): ProjectSettingsInput => ({
  useAreas: usesAreas(p),
  modules: Object.fromEntries(MODULES.map((m) => [m.id, moduleOn(p, m.id)])) as Record<ProjectModule, boolean>,
  scopeItems: Object.fromEntries(SCOPE_ITEMS.map((i) => [i.id, scopeOn(p, i.id)])) as Record<ScopeItem, boolean>,
})

/**
 * Whether an activity is part of the project: its module is on and, for construction work, its scope item is on. Not-applicable activities keep their records but are
 * hidden everywhere and never count toward progress.
 */
export function activityApplicable(p: Cfg, scope: ActivityScope, key: string): boolean {
  const category = getDef(scope, key).category
  if (category === 'construction' || category === 'rebar') {
    if (!moduleOn(p, 'progress')) return false
    const item = ITEM_OF_KEY.get(key)
    return item ? scopeOn(p, item) : true
  }
  if (category === 'survey') return moduleOn(p, 'survey')
  if (category === 'qaqc') return moduleOn(p, 'qaqc')
  if (category === 'civil') return moduleOn(p, 'civil')
  if (category === 'materials') return moduleOn(p, 'procurement')
  return true
}
