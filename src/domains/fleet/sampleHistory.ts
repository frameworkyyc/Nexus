import { addDays, type ISODate } from '@/lib/date'
import type { FleetState } from './types'

/**
 * Sample history for the PUBLIC DEMO ONLY (identity.fleet.extras). Every record is fictional and dated relative to today so the
 * dashboard always looks current. Real data never goes through this: it starts empty beyond the supplied figures.
 */
export function addSampleHistory(s: FleetState, primaryId: string, today: ISODate): FleetState {
  const [, d102, d201, d202] = s.vehicles.map((v) => v.id)
  const reading = (vehicleId: string, daysAgo: number, km: number, id: string) => ({ id, vehicleId, date: addDays(today, -daysAgo), reading: km, unit: 'km' as const, review: 'valid' as const, flag: null, correctsId: null, note: 'Sample reading', reviewNote: '', reviewedDate: null })
  // The seeded primary-unit odometer figure becomes today's reading; earlier ones give the trend line.
  const odometer = s.odometer.map((r) => (r.vehicleId === primaryId ? { ...r, date: addDays(today, -1), note: 'Sample reading' } : r))
  odometer.push(
    reading(primaryId, 120, 15_240, 'smp-odo-p1'), reading(primaryId, 70, 20_050, 'smp-odo-p2'), reading(primaryId, 30, 21_980, 'smp-odo-p3'), reading(primaryId, 8, 23_010, 'smp-odo-p4'),
    reading(d102, 3, 31_205, 'smp-odo-2'), reading(d201, 5, 58_940, 'smp-odo-3'), reading(d202, 2, 61_310, 'smp-odo-4'),
  )
  const target = (id: string, vehicleId: string, odometerKm: number, serviceType: string, warn: number, interval: number | null) => ({ id, vehicleId, odometer: odometerKm, setDate: null, note: 'Sample schedule', serviceType, warnWithinKm: warn, intervalKm: interval })
  const insp = (id: string, vehicleId: string, daysAgo: number, defects: string[]) => ({
    id, vehicleId, date: addDays(today, -daysAgo), submittedBy: 'Demo user', notes: 'Sample inspection', review: 'reviewed' as const, reviewedBy: 'Demo reviewer', reviewedDate: addDays(today, -daysAgo), reviewNote: '', condition: 'good' as const, demo: false,
    defects: defects.map((description, i) => ({ id: `${id}-d${i}`, description, status: 'outstanding' as const, resolvedDate: null, resolutionNote: '' })),
  })
  return {
    ...s,
    vehicles: s.vehicles.map((v) => ({ ...v, expectedLifeKm: v.expectedLifeKm ?? 200_000 })),
    odometer,
    serviceTargets: [
      ...s.serviceTargets,
      target('smp-svc-2', d102, 33_000, 'Oil change', 2_000, 5_000),
      target('smp-svc-4', d202, 60_000, 'Scheduled service', 2_500, null), // already past: shows the overdue state
    ],
    maintenance: [
      ...s.maintenance,
      { id: 'smp-mnt-1', vehicleId: primaryId, date: addDays(today, -70), serviceType: 'Oil change', odometer: 20_000, description: 'Sample record', notes: '' },
      { id: 'smp-mnt-2', vehicleId: primaryId, date: addDays(today, -120), serviceType: 'Tire rotation', odometer: 15_000, description: 'Sample record', notes: '' },
    ],
    inspections: [
      ...s.inspections.filter((i) => !i.demo),
      insp('smp-insp-1', primaryId, 10, []),
      insp('smp-insp-2', primaryId, 3, ['Small chip in windshield (sample defect)']),
      insp('smp-insp-3', d102, 4, []),
    ],
  }
}
