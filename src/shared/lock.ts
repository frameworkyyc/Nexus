/**
 * Modules switched off in production ("Coming Soon"). Staging and local development keep every module. The browser uses this to show the
 * lock; the Worker uses it (see src/worker/locks.ts) to refuse the matching changes whatever the browser sends.
 */
export const LOCKED_IN_PRODUCTION = {
  qaqc: 'QA/QC',
  civil: 'Civil / Earthworks',
  foundation: 'Foundation Overview',
  issues: 'Issues',
  'project-fleet': 'Fleet on this project',
  projects: 'All projects',
  overview: 'Company overview',
  crew: 'Crew',
  safety: 'Safety',
} as const
export type LockedId = keyof typeof LOCKED_IN_PRODUCTION

export const isProductionEnv = (environment: string | undefined) => environment === 'production'
export const isLocked = (id: string, environment: string | undefined): id is LockedId => isProductionEnv(environment) && id in LOCKED_IN_PRODUCTION

/** Sidebar node id → the module it opens. Entries not listed are never locked. */
export const NAV_LOCK: Record<string, LockedId> = {
  'op-qaqc': 'qaqc', 'op-civil': 'civil', foundation: 'foundation', issues: 'issues', 'project-fleet': 'project-fleet', projects: 'projects', overview: 'overview', crew: 'crew', safety: 'safety',
}
