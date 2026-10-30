import type { TrackerState } from '@/domains/construction/tracker/types'
/**
 * Everything that identifies the real organization, project and fleet in the seed data lives in THIS file, and nowhere else in the
 * client bundle. The public demo is built with `identity.demo.ts` swapped in for it (see vite.config.ts), so the public bundle never
 * contains these strings; `scripts/check-demo-bundle.mjs` enforces that on every demo build.
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
  trackerSeed?: () => TrackerState
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

export const identity: Identity = {
  organization: 'Progressive',
  userInitials: 'PC',
  companyId: 'progressive',
  project: {
    id: 'reef', name: 'REEF', jobNumber: '928', client: 'Ridley Terminals Partners', location: 'Ridley Island, British Columbia', scope: 'Concrete Foundations',
    statusNote: 'Anchor bolt delivery is late and one footing is blocked (recorded).',
  },
  areas: [['mole-sieve', 'Mole Sieve'], ['propane-bog', 'Propane BOG'], ['piperack', 'Piperack'], ['locomotive-shelter', 'Locomotive Shelter'], ['e-house', 'E-House']],
  foundationPrefixes: ['21', '22', '31', '41', '51'],
  anchorageCodes: ['OP1-01', 'OP1-02', 'OP1-03', 'OP2-01', 'OP2-02', 'OP3-01'],
  numberStem: '928',
  storageKeys: { fleet: 'nexus.demo.fleet', construction: 'nexus.demo.construction', tracker: 'nexus.reef.materialTracker' },
  trackerName: 'REEF',
  fleet: {
    units: [['T6010', 2026, 'Ford', 'F-350'], ['T6005', 2026, 'Ford', 'F-350'], ['LV167', 2024, 'GMC', '3500'], ['LV174', 2024, 'GMC', '3500']],
    primary: {
      unit: 'T6010', odometerKm: 11_856, nextOilAtKm: 13_551, oilIntervalKm: 5_000, oilWarnWithinKm: 2_000, lifespanKm: 180_000,
      tire: { manufacturer: 'Bridgestone', model: 'Dueler A/T', origin: 'Original factory tires', lifeKm: 60_000 },
      accessory: { name: '750 L Tidy Tank', specification: '750 L' },
      note: 'Verified information supplied for this unit; date not recorded.',
    },
    extras: false,
  },
}
