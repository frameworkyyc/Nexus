import type { Tone } from '@/components/ui/StatusBadge'
import type { ProjectStatus, ActivityScope, ActivityStatus, Acceptance, AutoMetric, ApprovalStatus, AuthStatus, FabStatus, PickupStatus, SiteReceiptStatus, TemplateReuse } from './types'

export type ActivityCategory = 'materials' | 'construction' | 'rebar' | 'survey' | 'qaqc' | 'civil'
export type StatusSet = 'work' | 'qaqc'
export type Derivation = 'bolts' | 'nuts' | 'washers' | 'templates'

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  materials: 'Materials & Procurement',
  construction: 'Construction',
  rebar: 'Rebar',
  survey: 'Survey',
  qaqc: 'QA/QC',
  civil: 'Civil / Earthworks',
}

export const CATEGORY_ORDER: ActivityCategory[] = ['materials', 'construction', 'rebar', 'survey', 'qaqc', 'civil']

export interface ActivityDef {
  key: string
  scope: ActivityScope
  category: ActivityCategory
  label: string
  statusSet: StatusSet
  /** Status is computed from procurement / fabrication records rather than entered by hand. */
  derived?: Derivation
  /** Same-scope activities that must be complete before this one is "ready" (soft sequencing). */
  after?: string[]
  /** Footing activities that must be complete first (plinth scope only). */
  afterFooting?: string[]
  /** Only exists where it applies (post-install tracking: where post-installed components exist), so it is not part of the standard list. */
  optional?: boolean
}

const work = 'work' as const
const qaqc = 'qaqc' as const

export const FOOTING_ACTIVITIES: ActivityDef[] = [
  { key: 'layout', scope: 'footing', category: 'survey', label: 'Layout completed', statusSet: work },
  { key: 'rebarBuilt', scope: 'footing', category: 'rebar', label: 'Rebar built', statusSet: work },
  { key: 'rebarInstalled', scope: 'footing', category: 'rebar', label: 'Rebar installed', statusSet: work, after: ['rebarBuilt', 'layout'] },
  { key: 'formed', scope: 'footing', category: 'construction', label: 'Footing formed', statusSet: work, after: ['layout'] },
  { key: 'preSurvey', scope: 'footing', category: 'survey', label: 'Pre-pour survey checks', statusSet: work, after: ['formed', 'rebarInstalled'] },
  { key: 'preInspection', scope: 'footing', category: 'qaqc', label: 'Pre-pour inspection', statusSet: qaqc, after: ['formed', 'rebarInstalled'] },
  { key: 'poured', scope: 'footing', category: 'construction', label: 'Footing poured', statusSet: work, after: ['preInspection'] },
  { key: 'postSurvey', scope: 'footing', category: 'survey', label: 'As-built survey', statusSet: work, after: ['poured'] },
  { key: 'postInspection', scope: 'footing', category: 'qaqc', label: 'Post-pour inspection', statusSet: qaqc, after: ['poured'] },
  // Civil / earthworks, recorded per foundation like the rest. Added after the existing activities so the construction sequence is unchanged.
  { key: 'excavation', scope: 'footing', category: 'civil', label: 'Excavation', statusSet: work },
  { key: 'subgradePrep', scope: 'footing', category: 'civil', label: 'Subgrade preparation', statusSet: work },
  { key: 'compaction', scope: 'footing', category: 'civil', label: 'Compaction', statusSet: work },
  { key: 'elevationVerification', scope: 'footing', category: 'civil', label: 'Elevation verification', statusSet: work },
  { key: 'backfill', scope: 'footing', category: 'civil', label: 'Backfill', statusSet: work },
  { key: 'finalGrading', scope: 'footing', category: 'civil', label: 'Final grading', statusSet: work },
]

export const PLINTH_ACTIVITIES: ActivityDef[] = [
  { key: 'anchorBolts', scope: 'plinth', category: 'materials', label: 'Anchor bolts', statusSet: work, derived: 'bolts' },
  { key: 'nuts', scope: 'plinth', category: 'materials', label: 'Nuts', statusSet: work, derived: 'nuts' },
  { key: 'washers', scope: 'plinth', category: 'materials', label: 'Washers', statusSet: work, derived: 'washers' },
  { key: 'solePlates', scope: 'plinth', category: 'materials', label: 'Sole plates', statusSet: work },
  { key: 'templates', scope: 'plinth', category: 'materials', label: 'Plywood templates', statusSet: work, derived: 'templates' },
  { key: 'rebarBuilt', scope: 'plinth', category: 'rebar', label: 'Rebar built', statusSet: work },
  { key: 'rebarInstalled', scope: 'plinth', category: 'rebar', label: 'Rebar installed', statusSet: work, after: ['rebarBuilt'] },
  { key: 'formed', scope: 'plinth', category: 'construction', label: 'Plinth formed', statusSet: work, afterFooting: ['poured'] },
  { key: 'preSurvey', scope: 'plinth', category: 'survey', label: 'Pre-pour survey checks', statusSet: work, after: ['formed', 'rebarInstalled', 'anchorBolts'] },
  { key: 'preInspection', scope: 'plinth', category: 'qaqc', label: 'Pre-pour inspection', statusSet: qaqc, after: ['formed', 'rebarInstalled'] },
  { key: 'poured', scope: 'plinth', category: 'construction', label: 'Plinth poured', statusSet: work, after: ['preInspection'] },
  { key: 'postSurvey', scope: 'plinth', category: 'survey', label: 'As-built survey', statusSet: work, after: ['poured'] },
  { key: 'postInspection', scope: 'plinth', category: 'qaqc', label: 'Post-pour inspection', statusSet: qaqc, after: ['poured'] },
  // Added after the existing activities so the plinth sequence is unchanged: plinth layout, and the anchor bolt survey and verification.
  { key: 'layout', scope: 'plinth', category: 'survey', label: 'Layout completed', statusSet: work },
  { key: 'anchorBoltSurvey', scope: 'plinth', category: 'survey', label: 'Anchor bolt survey', statusSet: work },
  { key: 'anchorBoltVerification', scope: 'plinth', category: 'qaqc', label: 'Anchor bolt verification', statusSet: qaqc },
]

/**
 * Post-installed components, tracked on their own (not as forming, rebar or pouring): anchor bolts and embed plates ticked "Post-Install" in Foundation Setup.
 * They go into hardened concrete, so they never hold up the pour. Components installed as part of the pour have no installation activity.
 */
export type InstallItem = 'bolts' | 'embeds'
export const INSTALL_ACTIVITY_KEY: Record<InstallItem, string> = { bolts: 'anchorBoltsPostInstalled', embeds: 'embedsPostInstalled' }
export const INSTALL_KEYS = Object.values(INSTALL_ACTIVITY_KEY)
export const INSTALL_LABEL: Record<InstallItem, string> = { bolts: 'Anchor bolts installed (post-installed)', embeds: 'Embed plates installed (post-installed)' }
const installActivities = (scope: ActivityScope): ActivityDef[] =>
  (Object.keys(INSTALL_ACTIVITY_KEY) as InstallItem[]).map((i) => ({ key: INSTALL_ACTIVITY_KEY[i], scope, category: 'construction', label: INSTALL_LABEL[i], statusSet: work, after: ['poured'], optional: true }))
export const INSTALL_ACTIVITIES: Record<ActivityScope, ActivityDef[]> = { footing: installActivities('footing'), plinth: installActivities('plinth') }

export const ACTIVITY_DEFS: Record<ActivityScope, ActivityDef[]> = {
  footing: [...FOOTING_ACTIVITIES, ...INSTALL_ACTIVITIES.footing],
  plinth: [...PLINTH_ACTIVITIES, ...INSTALL_ACTIVITIES.plinth],
}

export function getDef(scope: ActivityScope, key: string): ActivityDef {
  const def = ACTIVITY_DEFS[scope].find((d) => d.key === key)
  if (!def) throw new Error(`Unknown activity ${scope}:${key}`)
  return def
}

/** Physical progress counts only these categories. Survey and QA/QC are tracked as separate readiness measures. */
export const isConstructionCategory = (c: ActivityCategory) => c === 'construction' || c === 'rebar'

export const STATUS_OPTIONS: Record<StatusSet, ActivityStatus[]> = {
  work: ['not-started', 'in-progress', 'complete', 'blocked'],
  qaqc: ['not-started', 'in-progress', 'pending-review', 'approved', 'blocked'],
}

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  complete: 'Complete',
  'pending-review': 'Pending review',
  approved: 'Approved',
  blocked: 'Blocked',
}

export const STATUS_TONE: Record<ActivityStatus, Tone> = {
  'not-started': 'muted',
  'in-progress': 'info',
  complete: 'ok',
  'pending-review': 'warn',
  approved: 'ok',
  blocked: 'bad',
}

export const isDone = (s: ActivityStatus) => s === 'complete' || s === 'approved'

/* Fabrication vocabularies */

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  'not-submitted': 'Not submitted',
  'quote-requested': 'Quote requested',
  'under-review': 'Under review',
  'revisions-requested': 'Revisions requested',
  approved: 'Approved',
}
export const AUTH_LABEL: Record<AuthStatus, string> = { 'not-required': 'Not required', pending: 'Pending', authorized: 'Authorized', paid: 'Paid' }
export const FAB_LABEL: Record<FabStatus, string> = { 'not-started': 'Not started', queued: 'Queued', cutting: 'CNC cutting', complete: 'Complete' }
export const PICKUP_LABEL: Record<PickupStatus, string> = { 'not-ready': 'Not ready', ready: 'Ready for pickup', collected: 'Collected' }
export const SITE_LABEL: Record<SiteReceiptStatus, string> = { pending: 'Pending', received: 'Received on site' }
export const REUSE_LABEL: Record<TemplateReuse, string> = { 'single-use': 'Single use', reusable: 'Reusable', 'to-be-confirmed': 'To be confirmed' }

/* Handover */

export const AUTO_METRIC_LABEL: Record<AutoMetric, string> = {
  construction: 'All construction activities complete',
  survey: 'All survey activities complete',
  qaqc: 'All QA/QC inspections approved',
  deficiencies: 'No open deficiencies',
}

export const ACCEPTANCE_LABEL: Record<Acceptance, string> = {
  'not-submitted': 'Not submitted',
  submitted: 'Submitted for handover',
  accepted: 'Accepted',
  returned: 'Returned with comments',
}

/** Placeholder checklist: the real REEF handover requirements are not defined yet and are editable per area. */
export const DEFAULT_HANDOVER_REQUIREMENTS: { label: string; metric: AutoMetric | null }[] = [
  { label: 'All construction activities complete', metric: 'construction' },
  { label: 'All survey activities complete', metric: 'survey' },
  { label: 'All QA/QC inspections approved', metric: 'qaqc' },
  { label: 'No open deficiencies', metric: 'deficiencies' },
  { label: 'As-built survey package issued', metric: null },
  { label: 'Concrete test reports compiled', metric: null },
  { label: 'Inspection records package compiled', metric: null },
]

/* Workforce context */

export const ROTATION = { onDays: 14, offDays: 7 }

/* Handover phases (construction completion is distinct from handover) */

export type HandoverPhase = 'in-progress' | 'construction-complete' | 'handover-preparation' | 'ready-for-review' | 'handed-over'

export const HANDOVER_PHASES: { id: HandoverPhase; label: string }[] = [
  { id: 'in-progress', label: 'Construction in progress' },
  { id: 'construction-complete', label: 'Construction complete' },
  { id: 'handover-preparation', label: 'Handover preparation' },
  { id: 'ready-for-review', label: 'Ready for review' },
  { id: 'handed-over', label: 'Handed over' },
]

/** Shown beside the progress figures so the basis is never hidden. */
export const PROGRESS_BASIS = [
  'Every footing and every plinth record has construction stages: rebar, forming and pouring, plus installation of post-installed anchor bolts and embed plates wherever they are required. Concrete recorded as poured in a pour counts toward the pouring stage.',
  'The stages count equally. The rebar stage is split evenly between "built" and "installed", so rebar is not counted twice as heavily as forming or pouring.',
  'Each foundation type (one designation) has one progress figure: the average of its footing and plinth records. How the types are combined depends on the Completion basis: each type counts once (Foundation type), by how many individual foundations it represents (Foundation count), or by concrete volume (Concrete volume). Overall progress combines every foundation of every area directly; it is not an average of the area percentages.',
  'No quantities, hours or costs are available, so there is no effort weighting. Survey, QA/QC and handover are tracked separately and never change this figure.',
]

/* Project status (explicitly recorded) */

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning', active: 'Active', 'at-risk': 'At risk', delayed: 'Delayed', 'on-hold': 'On hold', complete: 'Complete',
}
export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planning: 'muted', active: 'ok', 'at-risk': 'warn', delayed: 'bad', 'on-hold': 'neutral', complete: 'neutral',
}
/** Sort order for "needs attention first". */
export const PROJECT_STATUS_RANK: Record<ProjectStatus, number> = { delayed: 0, 'at-risk': 1, active: 2, planning: 3, 'on-hold': 4, complete: 5 }
/** Projects currently being delivered. At risk and delayed are subsets of active work. */
export const IN_DELIVERY: ProjectStatus[] = ['active', 'at-risk', 'delayed']

/** One definition of a completed foundation, used everywhere. */
export const FOUNDATION_COMPLETE_DEFINITION =
  'A foundation is complete when every rebar, forming and pouring activity is complete for its footing and all of its plinths. Survey and QA/QC close-out, and formal handover, are tracked separately.'
