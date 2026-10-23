import type { Identity } from './identity'

/**
 * FICTIONAL identity for the public demo. Nothing here refers to a real organization, project, client, site, vehicle or person; the
 * names are invented. It replaces `identity.ts` in demo builds.
 */
export const identity: Identity = {
  organization: 'Demo Construction Co.',
  userInitials: 'DC',
  companyId: 'demo-co',
  project: {
    id: 'harbour-point', name: 'Harbour Point', jobNumber: '1042', client: 'Sample Industrial Client', location: 'Port Example, Canada', scope: 'Concrete Foundations',
    statusNote: 'Anchor bolt delivery is late and one footing is blocked (sample record).',
  },
  areas: [['area-a', 'Process Area A'], ['area-b', 'Utility Area B'], ['area-c', 'Pipe Rack C'], ['area-d', 'Shelter D'], ['area-e', 'Electrical Building E']],
  foundationPrefixes: ['11', '12', '13', '14', '15'],
  anchorageCodes: ['AB-101', 'AB-102', 'AB-103', 'AB-201', 'AB-202', 'AB-301'],
  numberStem: '1042',
  storageKeys: { fleet: 'nexus.public-demo.fleet', construction: 'nexus.public-demo.construction', tracker: 'nexus.public-demo.materialTracker' },
  trackerName: 'Harbour Point',
  fleet: {
    units: [['D101', 2025, 'Ford', 'F-250'], ['D102', 2025, 'Ford', 'F-250'], ['D201', 2023, 'Ram', '3500'], ['D202', 2023, 'Ram', '3500']],
    primary: {
      unit: 'D101', odometerKm: 23_480, nextOilAtKm: 25_000, oilIntervalKm: 5_000, oilWarnWithinKm: 2_000, lifespanKm: 200_000,
      tire: { manufacturer: 'Summit', model: 'Trail A/T', origin: 'Original factory tires', lifeKm: 70_000 },
      accessory: { name: '500 L Tidy Tank', specification: '500 L' },
      note: 'Sample value for the public demo.',
    },
    extras: true,
  },
}
