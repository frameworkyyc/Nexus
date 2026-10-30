import { identity } from '@/app/identity'
import { getDef, isConstructionCategory } from './config'
import { effectiveStatus, foundationActivities, foundationsOf, type Index } from './selectors'
import { linesForArea, materialsProgress } from './tracker/selectors'
import type { TrackerState } from './tracker/types'
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

const doneOf = (xs: { status: string }[]) => xs.filter((x) => x.status === 'complete' || x.status === 'approved').length

export function materialsIndicator(idx: Index, areaId: string, tracker: TrackerState): PackageIndicator {
  const lines = linesForArea(tracker, idx.state.areas, areaId).filter((l) => !l.archived)
  const basis = 'Verified received quantity against required quantity, averaged across the area’s material lines. Only receipts recorded in Nexus count: a “Delivered” status in the workbook is shown but does not raise the percentage. Ordered quantities are procurement only.'
  if (!lines.length) {
    return { key: 'materials', title: 'Materials', basis, percent: null, rows: [{ label: 'Material tracker', value: tracker.meta ? 'No lines for this area' : 'Not imported' }], gaps: [`Import the ${identity.trackerName} material tracker workbook to track materials. Demonstration material data is not counted.`] }
  }
  const p = materialsProgress(lines)
  return {
    key: 'materials', title: 'Materials', basis, percent: p.percent,
    rows: [
      { label: 'Lines with verified receipts', value: `${p.verifiedLines} / ${p.lines}` },
      { label: 'Received in full', value: String(p.receivedInFull), note: p.partial ? `${p.partial} partially received` : undefined },
      { label: 'Delivered per workbook, unverified', value: String(p.unverifiedDelivered) },
      { label: 'Pending per workbook', value: String(p.unverifiedPending) },
    ],
    gaps: p.percent === null ? ['No receipts are verified yet, so no percentage is shown.'] : p.unverifiedDelivered ? [`${p.unverifiedDelivered} lines marked Delivered have no recorded receipt and count as zero until verified.`] : [],
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

export const packageProgress = (idx: Index, areaId: string, tracker: TrackerState): PackageIndicator[] =>
  [materialsIndicator(idx, areaId, tracker), installationIndicator(idx, areaId), surveyIndicator(idx, areaId), qaqcIndicator(idx, areaId)]
