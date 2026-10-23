import { describe, expect, it, vi } from 'vitest'
import { DEMO_FORBIDDEN } from '../../../scripts/demo-forbidden.mjs'

// Run the seed builders against the FICTIONAL identity, exactly as the public bundle does.
vi.mock('@/app/identity', async () => import('@/app/identity.demo'))

const { buildFleetSeed } = await import('@/domains/fleet/seed')
const { buildSeed, buildPortfolio } = await import('@/domains/construction/seed')
const { fleetRow, inspectionStatus } = await import('@/domains/fleet/selectors')
const { oilIndicator, lifespanIndicator, tireIndicator } = await import('@/domains/fleet/indicators')
const { identity } = await import('@/app/identity')
const { tenant } = await import('@/app/tenant')

const TODAY = '2026-10-23'
const flagged = (text: string) => DEMO_FORBIDDEN.filter((re) => re.test(text)).map(String)

describe('public demo seed data (fictional identity)', () => {
  it('uses the fictional identity', () => {
    expect(identity.organization).toBe('Demo Construction Co.')
    expect(tenant.organization).toBe('Demo Construction Co.')
  })

  it('construction seed contains nothing that identifies the real project, client, site or areas', () => {
    const s = buildSeed(TODAY)
    expect(flagged(JSON.stringify(s))).toEqual([])
    const flagship = s.projects.find((p) => p.tracking === 'detailed')!
    expect(flagship).toMatchObject({ id: 'harbour-point', name: 'Harbour Point', jobNumber: '1042' })
    expect(s.areas.map((a) => a.name)).toEqual(['Process Area A', 'Utility Area B', 'Pipe Rack C', 'Shelter D', 'Electrical Building E'])
    expect(s.company).toEqual({ id: 'demo-co', name: 'Demo Construction Co.' })
  })

  it('construction seed is internally consistent', () => {
    const s = buildSeed(TODAY)
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id)
    for (const list of [s.projects, s.areas, s.foundations, s.plinths, s.activities]) expect(new Set(ids(list)).size).toBe(list.length)
    expect(s.areas.every((a) => a.projectId === 'harbour-point')).toBe(true)
    expect(s.foundations.every((f) => s.areas.some((a) => a.id === f.areaId))).toBe(true)
    expect(s.foundations.map((f) => f.number).every((n) => /^1[1-5]-\d\d$/.test(n))).toBe(true)
    const anchorage = new Set(s.anchorageTypes.map((t) => t.code))
    expect([...anchorage]).toEqual(['AB-101', 'AB-102', 'AB-103', 'AB-201', 'AB-202', 'AB-301'])
    expect(s.plinths.every((p) => !p.anchorageTypeId || anchorage.has(p.anchorageTypeId))).toBe(true)
    expect(s.purchaseOrders.every((po) => po.number.startsWith('PO-1042-'))).toBe(true)
    expect(buildPortfolio(TODAY).projects.some((p) => p.jobNumber === '1042')).toBe(false) // no clash with the flagship job number
  })

  it('fleet seed is fictional and has working sample history', () => {
    const f = buildFleetSeed()
    expect(flagged(JSON.stringify(f))).toEqual([])
    expect(f.vehicles.map((v) => v.unitNumber)).toEqual(['D101', 'D102', 'D201', 'D202'])
    expect(f.vehicles.every((v) => v.vin === null && v.licencePlate === null)).toBe(true) // no VINs or plates, not even fake ones
    expect(f.assignments.every((a) => a.projectId === 'harbour-point')).toBe(true)
    expect(JSON.stringify(f)).not.toMatch(/driver/i)
  })

  it('sample history drives every gauge from the fictional figures', () => {
    const f = buildFleetSeed()
    expect(lifespanIndicator(f, 'veh-D101')).toMatchObject({ expectedKm: 200_000, current: 23_480, remainingKm: 176_520, status: 'ok' })
    expect(oilIndicator(f, 'veh-D101')).toMatchObject({ dueAt: 25_000, remaining: 1_520, intervalKm: 5_000, lastAt: 20_000, status: 'warn' })
    expect(tireIndicator(f, 'veh-D101')).toMatchObject({ expectedLifeKm: 70_000, status: 'ok' })
    expect(inspectionStatus(f, 'veh-D101', new Date().toISOString().slice(0, 10)).state).not.toBe('none')
    // One vehicle is deliberately overdue so the red state can be explored.
    const d202 = fleetRow(f, f.vehicles[3], TODAY)
    expect(d202.service.state).toBe('overdue')
  })

  it('the sample inspections are ordinary demo records, not flagged placeholders', () => {
    const f = buildFleetSeed()
    expect(f.inspections.length).toBeGreaterThan(0)
    expect(f.inspections.every((i) => i.demo === false)).toBe(true)
  })
})
