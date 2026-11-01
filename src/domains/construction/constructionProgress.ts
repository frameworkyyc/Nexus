import { getDef, isConstructionCategory, isDone } from './config'
import { effectiveStatus, foundationActivities, foundationState, foundationsOf, progressOf, type Index } from './selectors'
import type { Activity, Foundation } from './types'

export type TrackState = 'not-started' | 'in-progress' | 'completed'

/** The construction activities of a foundation (formwork, pours and rebar, on the footing and on each plinth): what the Construction tracker records. */
export const trackedActivities = (idx: Index, f: Foundation): Activity[] => foundationActivities(idx, f).filter((a) => isConstructionCategory(getDef(a.scope, a.key).category))

/** An activity that is not finished and was planned for a date before today. Only recorded planned dates count: nothing is assumed. */
export const isLate = (idx: Index, a: Activity, today: string) => !isDone(effectiveStatus(idx, a)) && !!a.plannedDate && a.plannedDate < today

/** The wording for the tracker, spelled out: "Footing concrete poured", "Plinth concrete poured". */
export const trackLabel = (a: Activity): string => {
  const base = getDef(a.scope, a.key).label
  return a.key === 'poured' ? base.replace(/ poured$/, ' concrete poured') : base
}

export interface FoundationTrack {
  foundation: Foundation
  state: TrackState
  /** The existing construction progress figure (rebar, forming and pouring), the same one every other view shows. */
  percent: number
  done: number
  total: number
  overdue: boolean
  blocked: boolean
  acts: Activity[]
}

/** One foundation's construction progress, from the existing activity records and the existing progress and state calculations. */
export function foundationTrack(idx: Index, f: Foundation, today: string): FoundationTrack {
  const acts = trackedActivities(idx, f)
  const st = foundationState(idx, f)
  return {
    foundation: f,
    state: st.state === 'not-started' ? 'not-started' : st.state === 'in-progress' ? 'in-progress' : 'completed',
    percent: progressOf(idx, acts),
    done: acts.filter((a) => isDone(effectiveStatus(idx, a))).length,
    total: acts.length,
    overdue: acts.some((a) => isLate(idx, a, today)),
    blocked: st.blocked,
    acts,
  }
}

export interface AreaTracks {
  tracks: FoundationTrack[]
  counts: Record<TrackState, number> & { overdue: number }
  /** Whether any construction activity in the area has a planned date. Without one, Overdue cannot be known. */
  scheduled: boolean
}

export function areaTracks(idx: Index, areaId: string, today: string): AreaTracks {
  const tracks = foundationsOf(idx, areaId).filter((f) => !f.archived).map((f) => foundationTrack(idx, f, today))
  const counts = { 'not-started': 0, 'in-progress': 0, completed: 0, overdue: 0 }
  for (const t of tracks) { counts[t.state]++; if (t.overdue) counts.overdue++ }
  return { tracks, counts, scheduled: tracks.some((t) => t.acts.some((a) => !!a.plannedDate)) }
}

export type TrackFilter = TrackState | 'overdue'
export const matchesFilter = (t: FoundationTrack, filter: TrackFilter | ''): boolean => !filter || (filter === 'overdue' ? t.overdue : t.state === filter)
