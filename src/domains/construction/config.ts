import type { Tone } from '@/components/ui/StatusBadge'
import type { ActivityScope, ActivityStatus, Acceptance, AutoMetric, ApprovalStatus, AuthStatus, FabStatus, PickupStatus, SiteReceiptStatus, TemplateReuse } from './types'

export type ActivityCategory = 'materials' | 'construction' | 'rebar' | 'survey' | 'qaqc'
export type StatusSet = 'work' | 'qaqc'
export type Derivation = 'bolts' | 'nuts' | 'washers' | 'templates'

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  materials: 'Materials & Procurement',
  construction: 'Construction & Installation',
  rebar: 'Rebar',
  survey: 'Survey',
  qaqc: 'QA/QC',
}

export const CATEGORY_ORDER: ActivityCategory[] = ['materials', 'construction', 'rebar', 'survey', 'qaqc']

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
  { key: 'postSurvey', scope: 'footing', category: 'survey', label: 'Post-pour survey', statusSet: work, after: ['poured'] },
  { key: 'postInspection', scope: 'footing', category: 'qaqc', label: 'Post-pour inspection', statusSet: qaqc, after: ['poured'] },
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
  { key: 'postSurvey', scope: 'plinth', category: 'survey', label: 'Post-pour survey', statusSet: work, after: ['poured'] },
  { key: 'postInspection', scope: 'plinth', category: 'qaqc', label: 'Post-pour inspection', statusSet: qaqc, after: ['poured'] },
]

export const ACTIVITY_DEFS: Record<ActivityScope, ActivityDef[]> = {
  footing: FOOTING_ACTIVITIES,
  plinth: PLINTH_ACTIVITIES,
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
