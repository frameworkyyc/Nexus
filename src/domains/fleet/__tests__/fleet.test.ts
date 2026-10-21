import { describe, expect, it } from 'vitest'
import { buildSeed } from '@/domains/construction/seed'
import { reassignVehicle, type Reducer } from '../actions'
import { buildFleetSeed } from '../seed'
import { conditionOf, currentAssignment, fleetCounts, historyOf, latestOdometer } from '../selectors'
import type { FleetState } from '../types'

const TODAY = '2026-10-21'
const projects = buildSeed(TODAY).projects.map((p) => p.id)
const name = (id: string) => (id === 'reef' ? 'REEF' : id)
const apply = (s: FleetState, r: Reducer): FleetState => {
  const out = r(s)
  if (out.error !== undefined) throw new Error(out.error)
  return out.state
}

describe('fleet seed', () => {
  const s = buildFleetSeed()

  it('contains exactly the four supplied REEF vehicles', () => {
    expect(s.vehicles.map((v) => [v.unitNumber, v.year, v.make, v.model])).toEqual([
      ['T6010', 2026, 'Ford', 'F-350'],
      ['T6005', 2026, 'Ford', 'F-350'],
      ['LV167', 2024, 'GMC', '3500'],
      ['LV174', 2024, 'GMC', '3500'],
    ])
    expect(new Set(s.vehicles.map((v) => v.unitNumber)).size).toBe(4)
  })

  it('does not invent VINs, plates, mileage, inspections, maintenance, notes or assignment dates', () => {
    for (const v of s.vehicles) expect(v).toMatchObject({ vin: null, licencePlate: null, notes: '' })
    expect(s.odometer).toEqual([])
    expect(s.inspections).toEqual([])
    expect(s.maintenance).toEqual([])
    for (const a of s.assignments) expect(a.startDate).toBeNull()
    expect(JSON.stringify(s)).not.toMatch(/driver/i)
  })

  it('assigns every vehicle to the existing REEF project via its id', () => {
    expect(projects).toContain('reef')
    for (const v of s.vehicles) expect(currentAssignment(s, v.id)?.projectId).toBe('reef')
  })

  it('models vehicles as organization-level assets, not project-owned records', () => {
    for (const v of s.vehicles) {
      expect(v.companyId).toBe('progressive')
      expect(v).not.toHaveProperty('projectId')
    }
  })

  it('reports every vehicle as Not assessed until a record states a condition', () => {
    for (const v of s.vehicles) expect(conditionOf(s, v.id)).toBe('not-assessed')
    expect(latestOdometer(s, s.vehicles[0].id)).toBeUndefined()
  })

  it('counts vehicles and project assignments', () => {
    expect(fleetCounts(s)).toEqual({ vehicles: 4, assigned: 4, unassigned: 0, projects: 1 })
  })
})

describe('condition derivation', () => {
  it('uses the most recent recorded inspection or maintenance outcome', () => {
    const s = buildFleetSeed()
    const id = s.vehicles[0].id
    const next: FleetState = {
      ...s,
      inspections: [{ id: 'i1', vehicleId: id, date: '2026-09-01', condition: 'good', notes: '' }],
      maintenance: [{ id: 'm1', vehicleId: id, date: '2026-10-01', description: 'Brake service', condition: 'fair', notes: '' }, { id: 'm2', vehicleId: id, date: '2026-10-10', description: 'Oil change', notes: '' }],
    }
    expect(conditionOf(next, id)).toBe('fair') // latest dated record that states a condition
    expect(conditionOf(next, s.vehicles[1].id)).toBe('not-assessed') // other vehicles unaffected
  })
})

describe('reassignment', () => {
  const s = buildFleetSeed()
  const id = s.vehicles[0].id
  const other = projects.find((p) => p !== 'reef')!

  it('moves a vehicle between projects and keeps the earlier assignment in history', () => {
    const next = apply(s, reassignVehicle(id, other, projects, TODAY))
    expect(currentAssignment(next, id)?.projectId).toBe(other)
    expect(next.assignments.filter((a) => a.vehicleId === id)).toHaveLength(2)
    const history = historyOf(next, id, name)
    expect(history.map((h) => h.text)).toEqual([`Assigned to ${other}`, 'Removed from REEF', 'Assigned to REEF'])
    expect(history[0].date).toBe(TODAY)
    expect(history[history.length - 1].date).toBeNull() // seed assignment date was never recorded
    expect(fleetCounts(next)).toMatchObject({ assigned: 4, projects: 2 })
  })

  it('can unassign a vehicle and reassign it later', () => {
    const off = apply(s, reassignVehicle(id, null, projects, TODAY))
    expect(currentAssignment(off, id)).toBeUndefined()
    expect(fleetCounts(off)).toMatchObject({ assigned: 3, unassigned: 1 })
    expect(currentAssignment(apply(off, reassignVehicle(id, 'reef', projects, TODAY)), id)?.projectId).toBe('reef')
  })

  it('rejects unknown projects, unknown vehicles and no-op moves', () => {
    expect(reassignVehicle(id, 'nope', projects, TODAY)(s).error).toMatch(/does not exist/)
    expect(reassignVehicle('ghost', 'reef', projects, TODAY)(s).error).toMatch(/not found/)
    expect(reassignVehicle(id, 'reef', projects, TODAY)(s).error).toMatch(/already/)
  })

  it('leaves the vehicle record itself untouched', () => {
    const next = apply(s, reassignVehicle(id, other, projects, TODAY))
    expect(next.vehicles).toEqual(s.vehicles)
  })
})
