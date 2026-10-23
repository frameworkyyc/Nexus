import type { Row, RowSet } from '../db'
import type { Accessory, AccessoryPlacement, Defect, FleetState, InspectionRecord, MaintenanceRecord, OdometerReading, ServiceTarget, TireSet, TreadMeasurement, Vehicle, VehicleAssignment } from '@/domains/fleet/types'

const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** FleetState → table rows. Array position becomes `seq` so creation order survives a round trip. */
export function fleetToRows(state: FleetState): RowSet {
  return {
    vehicles: state.vehicles.map((v, seq): Row => ({ id: v.id, company_id: v.companyId, unit_number: v.unitNumber, year: v.year, make: v.make, model: v.model, vin: v.vin, licence_plate: v.licencePlate, notes: v.notes, expected_life_km: v.expectedLifeKm, inspection_interval_days: v.inspectionIntervalDays, seq })),
    vehicle_assignments: state.assignments.map((a, seq): Row => ({ id: a.id, vehicle_id: a.vehicleId, project_id: a.projectId, start_date: a.startDate, end_date: a.endDate, seq })),
    odometer_readings: state.odometer.map((r, seq): Row => ({ id: r.id, vehicle_id: r.vehicleId, reading_date: r.date, reading: r.reading, unit: r.unit, review: r.review, flag: r.flag, corrects_id: r.correctsId, note: r.note, review_note: r.reviewNote, reviewed_date: r.reviewedDate, seq })),
    service_targets: state.serviceTargets.map((t, seq): Row => ({ id: t.id, vehicle_id: t.vehicleId, odometer: t.odometer, set_date: t.setDate, note: t.note, service_type: t.serviceType, warn_within_km: t.warnWithinKm, interval_km: t.intervalKm, seq })),
    maintenance_records: state.maintenance.map((m, seq): Row => ({ id: m.id, vehicle_id: m.vehicleId, service_date: m.date, service_type: m.serviceType, odometer: m.odometer, description: m.description, condition: m.condition ?? null, notes: m.notes, seq })),
    tire_sets: state.tireSets.map((t, seq): Row => ({ id: t.id, vehicle_id: t.vehicleId, manufacturer: t.manufacturer, model: t.model, size: t.size, classes_json: JSON.stringify(t.classes), studded: t.studded, origin: t.origin, active: t.active ? 1 : 0, install_date: t.installDate, install_odometer: t.installOdometer, removal_date: t.removalDate, removal_odometer: t.removalOdometer, condition: t.condition, expected_life_km: t.expectedLifeKm, replace_at_mm: t.replaceAtMm, notes: t.notes, seq })),
    tread_measurements: state.tireSets.flatMap((t) => t.treads.map((m, seq): Row => ({ id: m.id, tire_set_id: t.id, measured_date: m.date, odometer: m.odometer, depth_mm: m.depthMm, note: m.note, seq }))),
    accessories: state.accessories.map((a, seq): Row => ({ id: a.id, name: a.name, category: a.category, description: a.description, specification: a.specification, cost: a.cost, warranty: a.warranty, notes: a.notes, seq })),
    accessory_placements: state.accessories.flatMap((a) => a.placements.map((p, seq): Row => ({ id: `${a.id}:${seq}`, accessory_id: a.id, seq, vehicle_id: p.vehicleId, install_date: p.installDate, install_odometer: p.installOdometer, end_date: p.endDate, end_odometer: p.endOdometer, end_reason: p.endReason, to_vehicle_id: p.toVehicleId, note: p.note }))),
    inspections: state.inspections.map((i, seq): Row => ({ id: i.id, vehicle_id: i.vehicleId, inspection_date: i.date, submitted_by: i.submittedBy, notes: i.notes, review: i.review, reviewed_by: i.reviewedBy, reviewed_date: i.reviewedDate, review_note: i.reviewNote, condition: i.condition, demo: i.demo ? 1 : 0, seq })),
    inspection_defects: state.inspections.flatMap((i) => i.defects.map((d, seq): Row => ({ id: d.id, inspection_id: i.id, description: d.description, status: d.status, resolved_date: d.resolvedDate, resolution_note: d.resolutionNote, seq }))),
  }
}

const by = <T extends Row>(rows: T[] | undefined, key: string) => {
  const m = new Map<string, T[]>()
  for (const r of rows ?? []) m.set(String(r[key]), [...(m.get(String(r[key])) ?? []), r])
  return m
}

/** Table rows → FleetState, the shape the shared reducers and selectors work on. */
export function fleetFromRows(rows: RowSet): FleetState {
  const treads = by(rows.tread_measurements, 'tire_set_id')
  const placements = by(rows.accessory_placements, 'accessory_id')
  const defects = by(rows.inspection_defects, 'inspection_id')
  return {
    vehicles: (rows.vehicles ?? []).map((r): Vehicle => ({ id: String(r.id), companyId: String(r.company_id), unitNumber: String(r.unit_number), year: Number(r.year), make: String(r.make), model: String(r.model), vin: s(r.vin), licencePlate: s(r.licence_plate), notes: String(r.notes), expectedLifeKm: n(r.expected_life_km), inspectionIntervalDays: n(r.inspection_interval_days) })),
    assignments: (rows.vehicle_assignments ?? []).map((r): VehicleAssignment => ({ id: String(r.id), vehicleId: String(r.vehicle_id), projectId: String(r.project_id), startDate: s(r.start_date), endDate: s(r.end_date) })),
    odometer: (rows.odometer_readings ?? []).map((r): OdometerReading => ({ id: String(r.id), vehicleId: String(r.vehicle_id), date: s(r.reading_date), reading: Number(r.reading), unit: String(r.unit) as 'km' | 'mi', review: String(r.review) as OdometerReading['review'], flag: s(r.flag), correctsId: s(r.corrects_id), note: String(r.note), reviewNote: String(r.review_note), reviewedDate: s(r.reviewed_date) })),
    serviceTargets: (rows.service_targets ?? []).map((r): ServiceTarget => ({ id: String(r.id), vehicleId: String(r.vehicle_id), odometer: Number(r.odometer), setDate: s(r.set_date), note: String(r.note), serviceType: s(r.service_type), warnWithinKm: n(r.warn_within_km), intervalKm: n(r.interval_km) })),
    maintenance: (rows.maintenance_records ?? []).map((r): MaintenanceRecord => ({ id: String(r.id), vehicleId: String(r.vehicle_id), date: String(r.service_date), serviceType: String(r.service_type), odometer: n(r.odometer), description: String(r.description), ...(r.condition ? { condition: String(r.condition) as MaintenanceRecord['condition'] } : {}), notes: String(r.notes) })),
    tireSets: (rows.tire_sets ?? []).map((r): TireSet => ({
      id: String(r.id), vehicleId: String(r.vehicle_id), manufacturer: String(r.manufacturer), model: String(r.model), size: s(r.size), classes: JSON.parse(String(r.classes_json)) as TireSet['classes'],
      studded: String(r.studded) as TireSet['studded'], origin: String(r.origin), active: Number(r.active) === 1, installDate: s(r.install_date), installOdometer: n(r.install_odometer), removalDate: s(r.removal_date), removalOdometer: n(r.removal_odometer),
      condition: String(r.condition) as TireSet['condition'], expectedLifeKm: n(r.expected_life_km), replaceAtMm: n(r.replace_at_mm), notes: String(r.notes),
      treads: (treads.get(String(r.id)) ?? []).map((m): TreadMeasurement => ({ id: String(m.id), date: s(m.measured_date), odometer: n(m.odometer), depthMm: Number(m.depth_mm), note: String(m.note) })),
    })),
    accessories: (rows.accessories ?? []).map((r): Accessory => ({
      id: String(r.id), name: String(r.name), category: String(r.category) as Accessory['category'], description: String(r.description), specification: String(r.specification), cost: n(r.cost), warranty: String(r.warranty), notes: String(r.notes),
      placements: (placements.get(String(r.id)) ?? []).map((p): AccessoryPlacement => ({ vehicleId: String(p.vehicle_id), installDate: s(p.install_date), installOdometer: n(p.install_odometer), endDate: s(p.end_date), endOdometer: n(p.end_odometer), endReason: s(p.end_reason) as AccessoryPlacement['endReason'], toVehicleId: s(p.to_vehicle_id), note: String(p.note) })),
    })),
    inspections: (rows.inspections ?? []).map((r): InspectionRecord => ({
      id: String(r.id), vehicleId: String(r.vehicle_id), date: String(r.inspection_date), submittedBy: String(r.submitted_by), notes: String(r.notes), review: String(r.review) as InspectionRecord['review'], reviewedBy: String(r.reviewed_by), reviewedDate: s(r.reviewed_date), reviewNote: String(r.review_note), condition: s(r.condition) as InspectionRecord['condition'], demo: Number(r.demo) === 1,
      defects: (defects.get(String(r.id)) ?? []).map((d): Defect => ({ id: String(d.id), description: String(d.description), status: String(d.status) as Defect['status'], resolvedDate: s(d.resolved_date), resolutionNote: String(d.resolution_note) })),
    })),
  }
}
