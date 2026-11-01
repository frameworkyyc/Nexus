import { getDef, isConstructionCategory, isDone, type ActivityCategory } from './config'
import { effectiveStatus, foundationActivities, foundationsOf, progressOf, type Index } from './selectors'
import type { Activity, Foundation } from './types'

export type TrackState = 'not-started' | 'in-progress' | 'completed'

/** The four trackers share one page and one set of rules; each reads the activities of its own categories from the existing activity records. */
export type Discipline = 'construction' | 'survey' | 'qaqc' | 'civil'

export const DISCIPLINES: Record<Discipline, { title: string; description: string; inDiscipline: (c: ActivityCategory) => boolean; order: string[] }> = {
  construction: { title: 'Construction', description: 'Update each foundation’s construction activities.', inDiscipline: isConstructionCategory, order: ['formed', 'poured', 'rebarBuilt', 'rebarInstalled'] },
  survey: { title: 'Survey', description: 'Record layout, pre- and post-pour surveys and the anchor bolt survey for each foundation.', inDiscipline: (c) => c === 'survey', order: ['layout', 'preSurvey', 'postSurvey', 'anchorBoltSurvey'] },
  qaqc: { title: 'QA/QC', description: 'Record pre- and post-pour inspections and anchor bolt verification for each foundation.', inDiscipline: (c) => c === 'qaqc', order: ['preInspection', 'postInspection', 'anchorBoltVerification'] },
  civil: { title: 'Civil / Earthworks', description: 'Record excavation, subgrade, compaction, elevation, backfill and final grading for each foundation.', inDiscipline: (c) => c === 'civil', order: ['excavation', 'subgradePrep', 'compaction', 'elevationVerification', 'backfill', 'finalGrading'] },
}

/** The activities of a foundation in one discipline (on the footing and on each plinth). */
export const trackedActivities = (idx: Index, f: Foundation, discipline: Discipline = 'construction'): Activity[] =>
  foundationActivities(idx, f).filter((a) => DISCIPLINES[discipline].inDiscipline(getDef(a.scope, a.key).category))

/** The status an activity is set to when marked completed: QA/QC activities are approved, the rest are complete. */
export const doneStatus = (a: Activity) => (getDef(a.scope, a.key).statusSet === 'qaqc' ? 'approved' : 'complete') as 'approved' | 'complete'

/** An activity that is not finished and was planned for a date before today. Only recorded planned dates count: nothing is assumed. */
export const isLate = (idx: Index, a: Activity, today: string) => !isDone(effectiveStatus(idx, a)) && !!a.plannedDate && a.plannedDate < today

/** The wording for the tracker, spelled out: "Footing concrete poured", "Plinth concrete poured". */
export const trackLabel = (a: Activity): string => {
  const def = getDef(a.scope, a.key)
  const base = def.label
  return a.key === 'poured' && def.category === 'construction' ? base.replace(/ poured$/, ' concrete poured') : base
}

export interface FoundationTrack {
  foundation: Foundation
  state: TrackState
  /** Construction uses the existing progress figure (rebar, forming and pouring); the other disciplines use completed over applicable activities, as the Project Status indicators do. */
  percent: number
  done: number
  total: number
  overdue: boolean
  blocked: boolean
  acts: Activity[]
}

/** One foundation's progress in a discipline, from the existing activity records and the existing calculations. */
export function foundationTrack(idx: Index, f: Foundation, today: string, discipline: Discipline = 'construction'): FoundationTrack {
  const acts = trackedActivities(idx, f, discipline)
  const eff = acts.map((a) => effectiveStatus(idx, a))
  const done = eff.filter(isDone).length
  const state: TrackState = acts.length > 0 && done === acts.length ? 'completed' : eff.some((s) => s !== 'not-started') ? 'in-progress' : 'not-started'
  return {
    foundation: f,
    state,
    percent: discipline === 'construction' ? progressOf(idx, acts) : acts.length ? Math.round((done / acts.length) * 100) : 0,
    done,
    total: acts.length,
    overdue: acts.some((a) => isLate(idx, a, today)),
    blocked: eff.includes('blocked'),
    acts,
  }
}

export interface AreaTracks {
  tracks: FoundationTrack[]
  counts: Record<TrackState, number> & { overdue: number }
  /** Whether any construction activity in the area has a planned date. Without one, Overdue cannot be known. */
  scheduled: boolean
}

export function areaTracks(idx: Index, areaId: string, today: string, discipline: Discipline = 'construction'): AreaTracks {
  return summarize(foundationsOf(idx, areaId).filter((f) => !f.archived).map((f) => foundationTrack(idx, f, today, discipline)))
}

/** Every foundation of several areas together (the project-wide "All areas" view), with the same counts worked out across all of them. */
export function projectTracks(idx: Index, areaIds: string[], today: string, discipline: Discipline = 'construction'): AreaTracks {
  return summarize(areaIds.flatMap((id) => areaTracks(idx, id, today, discipline).tracks))
}

function summarize(tracks: FoundationTrack[]): AreaTracks {
  const counts = { 'not-started': 0, 'in-progress': 0, completed: 0, overdue: 0 }
  for (const t of tracks) { counts[t.state]++; if (t.overdue) counts.overdue++ }
  return { tracks, counts, scheduled: tracks.some((t) => t.acts.some((a) => !!a.plannedDate)) }
}

export type TrackFilter = TrackState | 'overdue'
export const matchesFilter = (t: FoundationTrack, filter: TrackFilter | ''): boolean => !filter || (filter === 'overdue' ? t.overdue : t.state === filter)
