import { getDef, isConstructionCategory } from './config'
import { boltRows, bulkRows, effectiveStatus, foundationActivities, foundationsOf, type Index } from './selectors'
import type { Activity } from './types'

/**
 * Package progress: four readiness measures for one area, calculated only from underlying records.
 * `percent` is null when the records cannot support a figure; the UI then shows "Not tracked".
 * Survey, QA/QC and materials never feed the construction progress figure, and no activity is counted twice.
 */
export interface Metric { label: string; value: string; note?: string }
export interface PackageIndicator {
  key: 'materials' | 'installation' | 'survey' | 'qaqc'
  title: string
  basis: string // one-line statement of what the percentage means
  percent: number | null
  rows: Metric[] // compact breakdown
  gaps: string[] // what the records cannot say
}

const NOT_TRACKED = 'Not tracked'
const round = (n: number) => Math.round(n)
const ratio = (done: number, total: number) => (total > 0 ? round((done / total) * 100) : null)

/** Applicable activities only: an activity exists on a foundation only if the model creates it there. */
function areaActivities(idx: Index, areaId: string): { act: Activity; status: ReturnType<typeof effectiveStatus> }[] {
  return foundationsOf(idx, areaId).flatMap((f) => foundationActivities(idx, f)).map((act) => ({ act, status: effectiveStatus(idx, act) }))
}

const fmt = (n: number) => n.toLocaleString('en-CA')
const doneOf = (xs: { status: string }[]) => xs.filter((x) => x.status === 'complete' || x.status === 'approved').length

export function materialsIndicator(idx: Index, areaId: string): PackageIndicator {
  const lines: { name: string; required: number; ordered: number; received: number; allocated: number; sample: boolean }[] = []
  for (const r of boltRows(idx, areaId)) {
    lines.push({ name: `Anchor bolts ${r.spec.diameter} × ${r.spec.overallLength}″`, required: r.required, ordered: r.ordered, received: r.received, allocated: r.allocated, sample: false })
  }
  for (const r of bulkRows(idx, areaId)) {
    lines.push({ name: r.item.description, required: r.item.requiredQty, ordered: r.ordered, received: r.received, allocated: r.allocated, sample: r.item.sample })
  }
  const usable = lines.filter((l) => l.required > 0)
  // Physical availability: per line, received stock (capped at the requirement) against the requirement, then averaged
  // so a large count of washers cannot swamp a small count of bolts.
  const percent = usable.length ? round((usable.reduce((s, l) => s + Math.min(1, l.received / l.required), 0) / usable.length) * 100) : null
  const rows: Metric[] = usable.map((l) => ({
    label: l.name,
    value: `${fmt(Math.min(l.received, l.required))} / ${fmt(l.required)}`,
    note: `${l.received > l.required ? `received ${fmt(l.received)} (pooled stock) · ` : ''}ordered ${fmt(l.ordered)} · allocated ${fmt(l.allocated)} · outstanding ${fmt(Math.max(0, l.required - l.received))}${l.sample ? ' · sample quantity' : ''}`,
  }))
  const gaps = ['Sole plates have no procurement records, so they are not counted.']
  if (usable.some((l) => l.sample)) gaps.push('Some required quantities are sample figures, not take-offs.')
  return {
    key: 'materials', title: 'Materials',
    basis: 'Physical availability: received against required, averaged across tracked items. Ordered quantities are procurement only and do not raise the percentage.',
    percent, rows, gaps,
  }
}

export function installationIndicator(idx: Index, areaId: string): PackageIndicator {
  const acts = areaActivities(idx, areaId).filter((x) => isConstructionCategory(getDef(x.act.scope, x.act.key).category))
  const group = (label: string, keys: string[]): Metric => {
    const g = acts.filter((x) => keys.includes(x.act.key))
    return { label, value: g.length ? `${doneOf(g)} / ${g.length}` : NOT_TRACKED }
  }
  return {
    key: 'installation', title: 'Installation',
    basis: 'Completed activities against applicable activities across every footing and plinth.',
    percent: ratio(doneOf(acts), acts.length),
    rows: [group('Formwork', ['formed']), group('Rebar', ['rebarBuilt', 'rebarInstalled']), group('Concrete pours', ['poured']), { label: 'Anchor bolt installation', value: NOT_TRACKED }],
    gaps: ['Anchor bolt installation is not recorded; the anchor bolt activity measures material readiness.'],
  }
}

export function surveyIndicator(idx: Index, areaId: string): PackageIndicator {
  const acts = areaActivities(idx, areaId).filter((x) => getDef(x.act.scope, x.act.key).category === 'survey')
  const group = (label: string, key: string): Metric => {
    const g = acts.filter((x) => x.act.key === key)
    return { label, value: g.length ? `${doneOf(g)} / ${g.length}` : NOT_TRACKED }
  }
  return {
    key: 'survey', title: 'Survey',
    basis: 'Survey activities recorded complete. Completion is not acceptance.',
    percent: ratio(doneOf(acts), acts.length),
    rows: [group('Layout', 'layout'), group('Pre-pour survey', 'preSurvey'), group('Post-pour survey', 'postSurvey'), { label: 'Accepted', value: NOT_TRACKED }],
    gaps: ['Survey acceptance is not recorded, only completion.'],
  }
}

export function qaqcIndicator(idx: Index, areaId: string): PackageIndicator {
  const acts = areaActivities(idx, areaId).filter((x) => getDef(x.act.scope, x.act.key).category === 'qaqc')
  const group = (label: string, key: string): Metric => {
    const g = acts.filter((x) => x.act.key === key)
    if (!g.length) return { label, value: NOT_TRACKED }
    const accepted = g.filter((x) => x.status === 'approved').length
    const submitted = g.filter((x) => x.status === 'pending-review').length
    const blocked = g.filter((x) => x.status === 'blocked').length
    return { label, value: `${accepted} / ${g.length}`, note: `accepted ${accepted} · submitted ${submitted} · outstanding ${g.length - accepted - submitted - blocked}${blocked ? ` · blocked ${blocked}` : ''}` }
  }
  return {
    key: 'qaqc', title: 'QA/QC',
    basis: 'Inspections accepted against all pre-pour (CM03) and post-pour (CM04) inspections. Submitted inspections are not yet accepted.',
    percent: ratio(acts.filter((x) => x.status === 'approved').length, acts.length),
    rows: [group('CM03 pre-pour', 'preInspection'), group('CM04 post-pour', 'postInspection'), { label: 'Rejected', value: NOT_TRACKED }],
    gaps: ['Rejected is not a recorded inspection state; a blocked inspection is shown as blocked.'],
  }
}

export const packageProgress = (idx: Index, areaId: string): PackageIndicator[] =>
  [materialsIndicator(idx, areaId), installationIndicator(idx, areaId), surveyIndicator(idx, areaId), qaqcIndicator(idx, areaId)]
