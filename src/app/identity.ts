import type { ConstructionState } from '@/domains/construction/types'
import type { TrackerState } from '@/domains/construction/tracker/types'
/**
 * What the seed/demo code needs to know about a project and fleet. The application bundle uses the neutral values below (nothing is
 * seeded); the public demo build swaps in `identity.demo.ts` (fictional); the tests swap in a fixture. See vite.config.ts.
 *
 * Both files must satisfy `Identity`.
 */
export interface Identity {
  organization: string
  userInitials: string
  companyId: string
  project: { id: string; name: string; jobNumber: string; client: string; location: string; scope: string; statusNote: string }
  /** Exactly five construction areas, in order. */
  areas: [id: string, name: string][]
  /** Foundation tag prefix for each area, in the same order. */
  foundationPrefixes: string[]
  /** Anchorage type codes: three type-1, two type-2, one type-3 (see seed.ts for how they are used). */
  anchorageCodes: [string, string, string, string, string, string]
  /** Number used inside purchase-order and fabrication-request numbers. */
  numberStem: string
  /** Where this browser keeps its copy of each module (localStorage). */
  storageKeys: { fleet: string; construction: string; tracker: string }
  /** What the imported material tracker is called in the UI. */
  trackerName: string
  /** Fictional starting materials for a browser-only demo. Absent on the real identity, whose tracker starts empty. */
  trackerSeed?: (construction: ConstructionState) => TrackerState
  fleet: {
    units: [unit: string, year: number, make: string, model: string][]
    /** The unit that carries the detailed verified/sample figures below. */
    primary: {
      unit: string
      odometerKm: number
      nextOilAtKm: number
      oilIntervalKm: number
      oilWarnWithinKm: number
      lifespanKm: number
      tire: { manufacturer: string; model: string; origin: string; lifeKm: number }
      accessory: { name: string; specification: string }
      /** Wording of the note on the seeded odometer and service target. */
      note: string
    }
    /** Sample history relative to today, for the public demo only. Real data starts empty beyond the verified figures. */
    extras: boolean
  }
}

/**
 * The identity of an installation that has not been configured: no organization, project, areas or fleet. Everything real comes from the
 * database once the user creates it (organization setup, projects, areas, foundations, vehicles). Nothing here names a real company.
 */
export const identity: Identity = {
  organization: '',
  userInitials: '',
  companyId: '',
  project: { id: '', name: '', jobNumber: '', client: '', location: '', scope: '', statusNote: '' },
  areas: [],
  foundationPrefixes: [],
  anchorageCodes: ['', '', '', '', '', ''],
  numberStem: '',
  // Unused by the application bundle, which keeps no operational records in this browser. Kept distinct from every other key.
  storageKeys: { fleet: 'nexus.app.unused.fleet', construction: 'nexus.app.unused.construction', tracker: 'nexus.app.unused.materialTracker' },
  trackerName: 'project',
  fleet: {
    units: [],
    primary: { unit: '', odometerKm: 0, nextOilAtKm: 0, oilIntervalKm: 0, oilWarnWithinKm: 0, lifespanKm: 0, tire: { manufacturer: '', model: '', origin: '', lifeKm: 0 }, accessory: { name: '', specification: '' }, note: '' },
    extras: false,
  },
}
