import { FOOTING_ACTIVITIES, PLINTH_ACTIVITIES } from './config'
import type { Activity, Foundation, Plinth } from './types'

const blank = (id: string, key: string, scope: 'footing' | 'plinth', foundationId: string, plinthId: string | null): Activity => ({
  id, key, scope, foundationId, plinthId, status: 'not-started', plannedDate: null, actualDate: null, assigneeId: null, notes: '', docIds: [],
})

/** Every applicable activity of a foundation and its plinths, all "not started". Recorded values overlay these. */
export const blankActivitiesFor = (f: Foundation, plinths: Plinth[]): Activity[] => [
  ...FOOTING_ACTIVITIES.map((d) => blank(`${f.id}:${d.key}`, d.key, 'footing', f.id, null)),
  ...plinths.flatMap((p) => PLINTH_ACTIVITIES.map((d) => blank(`${p.id}:${d.key}`, d.key, 'plinth', p.foundationId, p.id))),
]
