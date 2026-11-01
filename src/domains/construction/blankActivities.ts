import { boltOwners } from './anchorageMounts'
import { BOLT_ACTIVITIES, BOLT_ACTIVITY_KEY, BOLT_KEYS, FOOTING_ACTIVITIES, PLINTH_ACTIVITIES } from './config'
import type { Activity, ConstructionState, Foundation, InstallMethod, Plinth } from './types'

const blank = (id: string, key: string, scope: 'footing' | 'plinth', foundationId: string, plinthId: string | null): Activity => ({
  id, key, scope, foundationId, plinthId, status: 'not-started', plannedDate: null, actualDate: null, assigneeId: null, notes: '', docIds: [],
})

/** The anchor bolt installation activities that exist on one footing or plinth: one per installation method present there (see `boltOwners`). */
const boltActivitiesOf = (ownerId: string, scope: 'footing' | 'plinth', foundationId: string, plinthId: string | null, methods: Set<InstallMethod> | undefined): Activity[] =>
  BOLT_ACTIVITIES[scope].filter((d) => methods && [...methods].some((m) => BOLT_ACTIVITY_KEY[m] === d.key)).map((d) => blank(`${ownerId}:${d.key}`, d.key, scope, foundationId, plinthId))

/**
 * Every applicable activity of a foundation and its plinths, all "not started". Recorded values overlay these. `bolts` says where anchor bolts are required
 * (`boltOwners`): only those footings and plinths get anchor bolt installation activities, one per installation method.
 */
export const blankActivitiesFor = (f: Foundation, plinths: Plinth[], bolts?: Map<string, Set<InstallMethod>>): Activity[] => [
  ...FOOTING_ACTIVITIES.map((d) => blank(`${f.id}:${d.key}`, d.key, 'footing', f.id, null)),
  ...boltActivitiesOf(f.id, 'footing', f.id, null, bolts?.get(f.id)),
  ...plinths.flatMap((p) => [
    ...PLINTH_ACTIVITIES.map((d) => blank(`${p.id}:${d.key}`, d.key, 'plinth', p.foundationId, p.id)),
    ...boltActivitiesOf(p.id, 'plinth', p.foundationId, p.id, bolts?.get(p.id)),
  ]),
]

/**
 * Brings the anchor bolt installation activities in line with the configuration: every footing and plinth that needs bolts installed gets one activity per method
 * (not started, if new), and activities of a method no longer present there are dropped. Activities that stay keep their status, dates and notes, so adding or
 * editing another anchorage group, or one with a different method, never loses recorded progress. Run after anything that changes bolts, anchorage or plinths.
 */
export function syncBoltActivities(s: ConstructionState): ConstructionState {
  const want = new Set<string>()
  for (const [owner, methods] of boltOwners(s)) for (const m of methods) want.add(`${owner}:${BOLT_ACTIVITY_KEY[m]}`)
  const keep = s.activities.filter((a) => !BOLT_KEYS.includes(a.key) || want.has(a.id))
  const have = new Set(keep.map((a) => a.id))
  const foundations = new Set(s.foundations.map((f) => f.id))
  const plinth = new Map(s.plinths.map((p) => [p.id, p]))
  const add: Activity[] = []
  for (const id of want) {
    if (have.has(id)) continue
    const at = id.lastIndexOf(':')
    const owner = id.slice(0, at)
    const key = id.slice(at + 1)
    if (foundations.has(owner)) add.push(blank(id, key, 'footing', owner, null))
    else if (plinth.has(owner)) add.push(blank(id, key, 'plinth', plinth.get(owner)!.foundationId, owner))
  }
  return keep.length === s.activities.length && add.length === 0 ? s : { ...s, activities: [...keep, ...add] }
}
