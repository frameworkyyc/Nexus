import type { Identity } from '../identity'
/**
 * TEST FIXTURE ONLY. A realistic project/fleet identity used by the automated tests (substituted for identity.ts when VITEST is set, see
 * vite.config.ts). It is never part of an application bundle: a new installation has no organization, project or fleet until its user creates them.
 */
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
