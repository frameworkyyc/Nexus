import { percentOf } from '@/lib/format'
import { scopeOn } from './projectSettings'
import type { ScopeItem } from './types'
import { getDef, isConstructionCategory } from './config'
import { effectiveStatus, foundationActivities, foundationsOf, type Index } from './selectors'
import { areaMaterialsSummary } from './tracker/procurement'
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
const ratio = percentOf

/** Applicable activities only: an activity exists on a foundation only if the model creates it there. */
function areaActivities(idx: Index, areaId: string): { act: Activity; status: ReturnType<typeof effectiveStatus> }[] {
  return foundationsOf(idx, areaId).flatMap((f) => foundationActivities(idx, f)).map((act) => ({ act, status: effectiveStatus(idx, act) }))
}

const doneOf = (xs: { status: string }[]) => xs.filter((x) => x.status === 'complete' || x.status === 'approved').length

export function materialsIndicator(idx: Index, areaId: string, tracker: TrackerState): PackageIndicator {
  const basis = 'Material requirements fully delivered, out of all of the area’s requirements (the same requirements, and the same figures, as the Materials tab and Procurement). Only a delivery confirmed in Nexus counts, and only when the whole required quantity has arrived: ordering, a partial delivery or a workbook status does not raise the percentage.'
  const m = areaMaterialsSummary(tracker, idx.state, areaId)
  if (m.counts.total === 0) {
    return { key: 'materials', title: 'Materials', basis, percent: null, rows: [{ label: 'Material requirements', value: 'None yet' }], gaps: ['Materials appear here once anchorage types are assigned to this area’s foundations, footing anchor bolts are added, or materials are entered.'] }
  }
  return {
    key: 'materials', title: 'Materials', basis, percent: m.percent,
    rows: [
      { label: 'Delivered in full', value: `${m.counts.delivered} / ${m.counts.total}`, note: m.partlyDelivered ? `${m.partlyDelivered} partially delivered` : undefined },
      { label: 'Not yet fully delivered', value: `${m.notFullyDelivered} / ${m.counts.total}` },
    ],
    gaps: [],
  }
}

export function installationIndicator(idx: Index, areaId: string): PackageIndicator {
  const acts = areaActivities(idx, areaId).filter((x) => isConstructionCategory(getDef(x.act.scope, x.act.key).category))
  const group = (label: string, keys: string[]): Metric => {
    const g = acts.filter((x) => keys.includes(x.act.key))
    return { label, value: g.length ? `${doneOf(g)} / ${g.length}` : NOT_TRACKED }
  }
  const project = idx.state.projects.find((p) => p.id === idx.area.get(areaId)?.projectId)
  const on = (item: ScopeItem) => scopeOn(project, item)
  const install = (label: string, key: string): Metric => { const g = acts.filter((x) => x.act.key === key); return { label, value: g.length ? `${doneOf(g)} / ${g.length}` : 'None post-installed' } }
  return {
    key: 'installation', title: 'Construction',
    basis: 'Completed activities against applicable activities across every footing and plinth.',
    percent: ratio(doneOf(acts), acts.length),
    // Only the work in the project's scope has a row: a grouting-only project shows equipment setting and grouting, not formwork and rebar.
    rows: [
      ...(on('formed') ? [group('Formwork', ['formed'])] : []),
      ...(on('rebarBuilt') || on('rebarInstalled') ? [group('Rebar', ['rebarBuilt', 'rebarInstalled'])] : []),
      ...(on('poured') ? [group('Concrete pours', ['poured'])] : []),
      ...(on('anchorBolts') ? [install('Anchor bolts installed', 'anchorBoltsPostInstalled')] : []),
      ...(on('embeds') ? [install('Embed plates installed', 'embedsPostInstalled')] : []),
      ...(on('equipmentSet') ? [group('Equipment set', ['equipmentSet'])] : []),
      ...(on('grouted') ? [group('Grouted', ['grouted'])] : []),
    ],
    gaps: [],
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
    rows: [group('Layout', 'layout'), group('Pre-pour survey', 'preSurvey'), group('As-built survey', 'postSurvey'), { label: 'Accepted', value: NOT_TRACKED }],
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
