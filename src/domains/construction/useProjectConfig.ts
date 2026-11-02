import { moduleOn, scopeOn, usesAreas } from './projectSettings'
import { useConstruction } from './store'
import type { ProjectModule, ScopeItem } from './types'

/** What the project in view includes: its areas setting, modules and construction scope. Without a project (or one that is not found) everything is on. */
export function useProjectConfig(projectId: string | null | undefined) {
  const { state } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId) ?? null
  return {
    project,
    usesAreas: usesAreas(project),
    moduleOn: (m: ProjectModule) => moduleOn(project, m),
    scopeOn: (i: ScopeItem) => scopeOn(project, i),
  }
}
