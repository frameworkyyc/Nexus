import { installOwners } from './anchorageMounts'
import { INSTALL_ACTIVITIES, INSTALL_ACTIVITY_KEY, INSTALL_KEYS, FOOTING_ACTIVITIES, PLINTH_ACTIVITIES, type InstallItem } from './config'
import type { Activity, ConstructionState, Foundation, Plinth } from './types'

const blank = (id: string, key: string, scope: 'footing' | 'plinth', foundationId: string, plinthId: string | null): Activity => ({
  id, key, scope, foundationId, plinthId, status: 'not-started', plannedDate: null, actualDate: null, assigneeId: null, notes: '', docIds: [],
})

/** The installation activities that exist on one footing or plinth: one for its post-installed anchor bolts and one for its post-installed embed plates, where present (see `installOwners`). */
const boltActivitiesOf = (ownerId: string, scope: 'footing' | 'plinth', foundationId: string, plinthId: string | null, items: Set<InstallItem> | undefined): Activity[] =>
  INSTALL_ACTIVITIES[scope].filter((d) => items && [...items].some((i) => INSTALL_ACTIVITY_KEY[i] === d.key)).map((d) => blank(`${ownerId}:${d.key}`, d.key, scope, foundationId, plinthId))

/**
 * Every applicable activity of a foundation and its plinths, all "not started". Recorded values overlay these. `installs` says where post-installed
 * components are (`installOwners`): only those footings and plinths get installation activities.
 */
export const blankActivitiesFor = (f: Foundation, plinths: Plinth[], installs?: Map<string, Set<InstallItem>>): Activity[] => [
  ...FOOTING_ACTIVITIES.map((d) => blank(`${f.id}:${d.key}`, d.key, 'footing', f.id, null)),
  ...boltActivitiesOf(f.id, 'footing', f.id, null, installs?.get(f.id)),
  ...plinths.flatMap((p) => [
    ...PLINTH_ACTIVITIES.map((d) => blank(`${p.id}:${d.key}`, d.key, 'plinth', p.foundationId, p.id)),
    ...boltActivitiesOf(p.id, 'plinth', p.foundationId, p.id, installs?.get(p.id)),
  ]),
]

/**
 * Brings the installation activities in line with the configuration: every footing and plinth with post-installed bolts or embed plates gets the matching activity
 * (not started, if new), and activities no longer needed are dropped. Activities that stay keep their status, dates and notes, so adding or editing another
 * component, or one with a different method, never loses recorded progress. Run after anything that changes bolts, embeds, anchorage or plinths.
 */
export function syncBoltActivities(s: ConstructionState): ConstructionState {
  const want = new Set<string>()
  for (const [owner, items] of installOwners(s)) for (const i of items) want.add(`${owner}:${INSTALL_ACTIVITY_KEY[i]}`)
  const keep = s.activities.filter((a) => !INSTALL_KEYS.includes(a.key) || want.has(a.id))
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
