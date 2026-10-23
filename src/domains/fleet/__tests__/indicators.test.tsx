import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as A from '../actions'
import { inspectionIndicator, lifeShares, lifespanIndicator, oilIndicator, pct1, serviceIndicator, tireIndicator } from '../indicators'
import { buildFleetSeed, T6010_ID } from '../seed'
import { isOilChange } from '../selectors'
import { VehicleGauges } from '../VehicleGauges'
import type { FleetState } from '../types'

const TODAY = '2026-10-21'
const T6005 = 'veh-T6005'
const full = () => buildFleetSeed()
/** The seed without the labelled demonstration inspections (genuine records only). */
const seed = (): FleetState => { const s = buildFleetSeed(); return { ...s, inspections: s.inspections.filter((i) => !i.demo) } }
const apply = (s: FleetState, r: A.Reducer): FleetState => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state }
const tire = (over: Partial<A.TireInput> = {}): A.TireInput => ({ manufacturer: 'Bridgestone', model: 'Dueler A/T', size: '', classes: [], studded: 'unknown', origin: 'Original factory tires', installDate: null, installOdometer: 0, condition: 'unknown', notes: '', expectedLifeKm: 60_000, ...over })
const tireId = (s: FleetState) => s.tireSets.find((t) => t.vehicleId === T6010_ID && t.active)!.id
const maint = (s: FleetState, type: string, odometer: number | null, date = '2026-10-10') => apply(s, A.recordMaintenance(T6010_ID, { date, serviceType: type, odometer, description: '', notes: '' }, TODAY))
const odo = (s: FleetState, reading: number, date = '2026-10-21') => apply(s, A.recordOdometer(T6010_ID, { date, reading, note: '' }, TODAY))
const inspect = (s: FleetState, date: string) => apply(s, A.submitInspection(T6010_ID, { date, submittedBy: 'x', notes: '', defects: [] }, TODAY))

describe('life shares', () => {
  it('splits a total into clamped remaining and consumed shares', () => {
    expect(lifeShares(25, 100)).toEqual({ remainingPercent: 75, consumedPercent: 25, remaining: 75 })
    expect(lifeShares(100, 100)).toEqual({ remainingPercent: 0, consumedPercent: 100, remaining: 0 })
  })
  it('clamps to 0–100 when the estimate is exceeded, while keeping the true distance', () => {
    expect(lifeShares(150, 100)).toEqual({ remainingPercent: 0, consumedPercent: 100, remaining: -50 })
  })
  it('is null when either figure is missing or invalid', () => {
    for (const [u, t] of [[null, 100], [10, null], [10, 0], [-1, 100]] as const) expect(lifeShares(u, t)).toEqual({ remainingPercent: null, consumedPercent: null, remaining: null })
  })
})

describe('T6010 vehicle lifespan (180,000 km estimate, 11,856 km driven)', () => {
  it('is 93.4% / 168,144 km remaining and 6.6% consumed, green', () => {
    const i = lifespanIndicator(seed(), T6010_ID)
    expect(i).toMatchObject({ expectedKm: 180_000, current: 11_856, remainingKm: 168_144, status: 'ok' })
    expect(pct1(i.remainingPercent!)).toBe(93.4)
    expect(pct1(i.consumedPercent!)).toBe(6.6)
  })

  it('is a planning estimate: passing it clamps the gauge and flags planning (orange), never critical or unserviceable', () => {
    const s = odo(seed(), 185_000)
    const i = lifespanIndicator(s, T6010_ID)
    expect(i).toMatchObject({ remainingKm: -5_000, remainingPercent: 0, consumedPercent: 100, status: 'warn' })
    expect(i.label).toMatch(/beyond estimate/i)
    expect(['bad', 'critical']).not.toContain(i.status)
  })

  it('is editable, validated and leaves condition alone', () => {
    const s = apply(seed(), A.setVehiclePlanning(T6010_ID, { expectedLifeKm: 250_000, inspectionIntervalDays: null }))
    expect(lifespanIndicator(s, T6010_ID).remainingKm).toBe(250_000 - 11_856)
    expect(A.setVehiclePlanning(T6010_ID, { expectedLifeKm: -1, inspectionIntervalDays: null })(s).error).toMatch(/lifespan/)
    expect(A.setVehiclePlanning(T6010_ID, { expectedLifeKm: 100_000, inspectionIntervalDays: 0 })(s).error).toMatch(/inspection interval/)
    expect(lifespanIndicator(apply(s, A.setVehiclePlanning(T6010_ID, { expectedLifeKm: null, inspectionIntervalDays: null })), T6010_ID).status).toBe('unknown')
  })

  it('works for any vehicle: unknown until an estimate is set', () => {
    expect(lifespanIndicator(seed(), T6005)).toMatchObject({ status: 'unknown', remainingPercent: null, expectedKm: null })
    const s = apply(seed(), A.setVehiclePlanning(T6005, { expectedLifeKm: 100_000, inspectionIntervalDays: null }))
    expect(lifespanIndicator(s, T6005).status).toBe('unknown') // estimate but no odometer reading: nothing is guessed
  })
})

describe('T6010 oil change (next 13,551 km, 5,000 km interval)', () => {
  it('is one indicator: 33.9% remaining, 66.1% consumed, 1,695 km left, due at 13,551, orange', () => {
    const i = oilIndicator(seed(), T6010_ID)
    expect(i).toMatchObject({ dueAt: 13_551, current: 11_856, remaining: 1_695, intervalKm: 5_000, intervalStart: 8_551, status: 'warn', label: 'Due soon' })
    expect(pct1(i.remainingPercent!)).toBe(33.9)
    expect(pct1(i.consumedPercent!)).toBe(66.1)
  })

  it('treats 8,551 km as a calculated baseline only: no completed record exists and none is created', () => {
    const s = seed()
    const i = oilIndicator(s, T6010_ID)
    expect(i.baselineCalculated).toBe(true)
    expect(i.last).toBeUndefined()
    expect(i.lastAt).toBeNull()
    expect(s.maintenance).toEqual([])
    expect(JSON.stringify(s)).not.toContain('8551')
    expect(JSON.stringify(s)).not.toContain('8,551')
  })

  it('does not duplicate schedules: the scheduled-service gauge is empty and there is a single target', () => {
    const s = seed()
    expect(s.serviceTargets.filter((t) => t.vehicleId === T6010_ID)).toHaveLength(1)
    expect(serviceIndicator(s, T6010_ID).schedule).toBeUndefined()
  })

  it('uses configurable warning thresholds: green outside the window, orange inside, red overdue', () => {
    const set = (warn: number | null) => apply(seed(), A.setServiceTarget(T6010_ID, 13_551, '', TODAY, { serviceType: 'Oil change', warnWithinKm: warn ?? undefined, intervalKm: 5_000 }))
    expect(oilIndicator(set(1_000), T6010_ID).status).toBe('ok')
    expect(oilIndicator(seed(), T6010_ID).status).toBe('warn') // the configured 2,000 km window
    expect(oilIndicator(set(null), T6010_ID).status).toBe('info') // no threshold recorded: not yet due, nothing claimed
    expect(oilIndicator(odo(set(1_000), 13_700), T6010_ID)).toMatchObject({ status: 'bad', remaining: -149, remainingPercent: 0 })
  })

  it('updates automatically when the oil change is completed and the next mileage is recorded', () => {
    let s = maint(seed(), 'Oil change', 11_856, '2026-10-21')
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ schedule: undefined, status: 'unknown', lastAt: 11_856 }) // done: the old target is no longer "next"
    s = apply(s, A.setServiceTarget(T6010_ID, 16_856, '', TODAY, { serviceType: 'Oil change', warnWithinKm: 2_000, intervalKm: 5_000 }))
    const i = oilIndicator(s, T6010_ID)
    expect(i).toMatchObject({ dueAt: 16_856, remaining: 5_000, intervalStart: 11_856, baselineCalculated: false, status: 'ok' })
    expect(pct1(i.remainingPercent!)).toBe(100)
  })

  it('prefers a real last oil change over the calculated baseline when one is recorded', () => {
    const s = maint(apply(seed(), A.setServiceTarget(T6010_ID, 13_551, '', TODAY, { serviceType: 'Oil change' })), 'Oil change', 9_000, '2026-09-01') // no configured interval
    const i = oilIndicator(s, T6010_ID)
    expect(i).toMatchObject({ intervalStart: 9_000, baselineCalculated: false, lastAt: 9_000 })
    expect(pct1(i.consumedPercent!)).toBe(62.8) // (11,856 − 9,000) / (13,551 − 9,000)
    // With the 5,000 km interval configured, a change at exactly the calculated start is that cycle's own baseline (schedule stays)…
    const exact = maint(seed(), 'Oil change', 8_551, '2026-09-01')
    expect(oilIndicator(exact, T6010_ID)).toMatchObject({ dueAt: 13_551, intervalStart: 8_551, baselineCalculated: false, remaining: 1_695 })
    // …while one later than that start means this cycle's change was done: a new next mileage is needed.
    expect(oilIndicator(maint(seed(), 'Oil change', 9_000, '2026-09-01'), T6010_ID).schedule).toBeUndefined()
  })

  it('keeps other scheduled services separate', () => {
    const s = apply(seed(), A.setServiceTarget(T6010_ID, 20_000, '', TODAY, { serviceType: 'Brake service', warnWithinKm: 3_000 }))
    expect(serviceIndicator(s, T6010_ID)).toMatchObject({ dueAt: 20_000, remaining: 8_144, status: 'ok' })
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ dueAt: 13_551 }) // oil unaffected
    expect(s.serviceTargets.filter((t) => t.vehicleId === T6010_ID)).toHaveLength(2)
  })

  it('is Unknown for a vehicle with no oil-change schedule', () => {
    expect(oilIndicator(seed(), T6005)).toMatchObject({ status: 'unknown', schedule: undefined, remainingPercent: null })
  })

  it('percent needs an interval: an oil target with no interval and no last change shows km only', () => {
    const s = apply(seed(), A.setServiceTarget(T6010_ID, 14_000, '', TODAY, { serviceType: 'Oil change' }))
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ remaining: 2_144, remainingPercent: null, consumedPercent: null, intervalStart: null })
  })

  it('validates the interval', () => {
    expect(A.setServiceTarget(T6010_ID, 14_000, '', TODAY, { serviceType: 'Oil change', intervalKm: -5 })(seed()).error).toMatch(/interval/)
    expect(A.setServiceTarget(T6010_ID, 3_000, '', TODAY, { serviceType: 'Oil change', intervalKm: 5_000 })(seed()).error).toMatch(/below zero/)
  })

  it('recognises oil changes by their recorded type only', () => {
    expect(['Oil change', 'oil change', 'Engine oil change', 'Oil & filter', 'Oil and filter'].every(isOilChange)).toBe(true)
    expect(['Oil leak repair', 'Brake service', '', null].some((t) => isOilChange(t))).toBe(false)
  })
})

describe('T6010 tire lifespan (Bridgestone Dueler A/T, 60,000 km estimate, 11,856 km driven)', () => {
  it('is 80.2% / 48,144 km remaining and 19.8% consumed, green, from an estimate', () => {
    const i = tireIndicator(seed(), T6010_ID)
    expect(i).toMatchObject({ km: 11_856, expectedLifeKm: 60_000, remainingKm: 48_144, status: 'ok', basis: 'lifespan', treadMm: null })
    expect(pct1(i.remainingPercent!)).toBe(80.2)
    expect(pct1(i.consumedPercent!)).toBe(19.8)
  })

  it('keeps the real condition separate: still Not assessed, with the existing tire facts intact', () => {
    const set = tireIndicator(seed(), T6010_ID).set!
    expect(set).toMatchObject({ condition: 'unknown', manufacturer: 'Bridgestone', model: 'Dueler A/T', origin: 'Original factory tires', installOdometer: 0, size: null, classes: [], studded: 'unknown', treads: [] })
  })

  it('clamps when the estimated life is exceeded and goes orange (an estimate, not a condition)', () => {
    const s = odo(apply(seed(), A.updateTireSet(tireId(seed()), tire({ expectedLifeKm: 10_000 }), TODAY)), 11_856)
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ remainingPercent: 0, consumedPercent: 100, remainingKm: -1_856, status: 'warn' })
  })

  it('goes red only on a recorded replace condition or a measured tread at/below the limit', () => {
    expect(tireIndicator(apply(seed(), A.updateTireSet(tireId(seed()), tire({ condition: 'replace' }), TODAY)), T6010_ID).status).toBe('bad')
    let s = apply(seed(), A.updateTireSet(tireId(seed()), tire({ replaceAtMm: 3 }), TODAY))
    s = apply(s, A.addTreadMeasurement(tireId(s), { date: '2026-10-20', depthMm: 8, note: '' }, TODAY))
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ status: 'ok', basis: 'tread' })
    s = apply(s, A.addTreadMeasurement(tireId(s), { date: '2026-10-21', depthMm: 3, note: '' }, TODAY))
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ status: 'bad', basis: 'tread' })
  })

  it('maps recorded conditions: fair and worn orange, good green', () => {
    const st = (condition: A.TireInput['condition']) => tireIndicator(apply(seed(), A.updateTireSet(tireId(seed()), tire({ condition }), TODAY)), T6010_ID).status
    expect([st('fair'), st('worn'), st('good')]).toEqual(['warn', 'warn', 'ok'])
  })

  it('is unknown with no estimate and invents no default; the estimate is editable and validated', () => {
    const base = apply(seed(), A.updateTireSet(tireId(seed()), tire({ expectedLifeKm: null }), TODAY))
    expect(tireIndicator(base, T6010_ID)).toMatchObject({ status: 'unknown', remainingPercent: null })
    expect(A.updateTireSet(tireId(base), tire({ expectedLifeKm: -5 }), TODAY)(base).error).toMatch(/expected tire lifespan/)
    expect(A.updateTireSet(tireId(base), tire({ expectedLifeKm: 1.5 }), TODAY)(base).error).toMatch(/expected tire lifespan/)
    expect(A.updateTireSet(tireId(base), tire({ replaceAtMm: 99 }), TODAY)(base).error).toMatch(/replacement tread depth/)
    expect(tireIndicator(apply(base, A.updateTireSet(tireId(base), tire({ expectedLifeKm: 80_000 }), TODAY)), T6010_ID).remainingKm).toBe(80_000 - 11_856)
  })

  it('keeps replacement history and installation odometers', () => {
    const s = apply(seed(), A.replaceTireSet(T6010_ID, tire({ manufacturer: 'Nokian', model: 'Hakka', installOdometer: 11_856, expectedLifeKm: 70_000 }), { date: null, odometer: 11_856 }, TODAY))
    expect(s.tireSets.filter((t) => t.vehicleId === T6010_ID).map((t) => [t.manufacturer, t.active, t.installOdometer])).toEqual([['Bridgestone', false, 0], ['Nokian', true, 11_856]])
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ km: 0, remainingKm: 70_000 })
  })

  it('has no set to judge when none is fitted', () => {
    expect(tireIndicator(seed(), T6005)).toMatchObject({ set: undefined, status: 'unknown', km: null })
  })
})

describe('inspection gauge (verified inspections only)', () => {
  it('is Unknown with no genuine inspection recorded', () => {
    expect(inspectionIndicator(seed(), T6010_ID, TODAY)).toMatchObject({ cadence: 'unknown', status: 'unknown', daysSince: null })
  })

  it('distinguishes current, due and overdue by the interval', () => {
    expect(inspectionIndicator(inspect(seed(), '2026-10-18'), T6010_ID, TODAY)).toMatchObject({ cadence: 'current', daysSince: 3, daysUntilDue: 4 })
    expect(inspectionIndicator(inspect(seed(), '2026-10-14'), T6010_ID, TODAY)).toMatchObject({ cadence: 'due', status: 'warn' })
    expect(inspectionIndicator(inspect(seed(), '2026-10-10'), T6010_ID, TODAY)).toMatchObject({ cadence: 'overdue', status: 'bad', daysSince: 11 })
  })

  it('honours a per-vehicle inspection interval', () => {
    const s = apply(inspect(seed(), '2026-10-10'), A.setVehiclePlanning(T6010_ID, { expectedLifeKm: 180_000, inspectionIntervalDays: 14 }))
    expect(inspectionIndicator(s, T6010_ID, TODAY)).toMatchObject({ cadence: 'current', intervalDays: 14, daysUntilDue: 3 })
  })

  it('does not call a submitted but unreviewed inspection healthy', () => {
    const i = inspectionIndicator(inspect(seed(), '2026-10-20'), T6010_ID, TODAY)
    expect(i).toMatchObject({ cadence: 'current', awaitingReview: true, status: 'info' })
    expect(i.label).toMatch(/awaiting review/)
  })

  it('counts outstanding defects', () => {
    const s = apply(seed(), A.submitInspection(T6010_ID, { date: '2026-10-20', submittedBy: 'x', notes: '', defects: ['Cracked mirror'] }, TODAY))
    expect(inspectionIndicator(s, T6010_ID, TODAY)).toMatchObject({ defects: 1, unreviewedDefects: 1 })
  })
})

describe('vehicle dashboard gauges render (T6010)', () => {
  const state = full()
  const html = renderToStaticMarkup(<VehicleGauges state={state} vehicle={state.vehicles[0]} today={TODAY} projectName="REEF" handlers={{ jump: () => undefined }} />)

  it('shows the four primary gauges in order', () => {
    const order = ['Vehicle Lifespan', 'Oil Change', 'Tire Lifespan', 'Weekly Inspection'].map((t) => html.indexOf(`<div class="t-label">${t}</div>`))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).not.toContain('Scheduled Service') // no duplicate schedule for T6010
    expect((html.match(/<figure/g) ?? []).length).toBe(4)
  })

  it('shows the calculated figures', () => {
    for (const x of ['93.4%', '168,144 km remaining', '33.9%', '1,695 km remaining', 'Due at 13,551 km', '5,000 km interval', '80.2%', '48,144 km remaining', 'Estimated, mileage-based', 'Planning estimate: 180,000 km', 'Interval start 8,551 km (calculated)']) expect(html).toContain(x)
  })

  it('draws arcs for the three percentage gauges and a status-only ring for inspection', () => {
    expect((html.match(/data-testid="gauge-arc"/g) ?? []).length).toBe(3)
    expect(html).toContain('data-fraction="none"') // inspection: no percentage
    expect(html).toContain('No verified inspection recorded') // demo records are present but ignored
    expect(html).toContain('4 demo records not counted')
  })

  it('keeps condition separate and shows the summary', () => {
    expect(html).toContain('Condition: Not assessed')
    expect(html).toContain('Awaiting a reviewed inspection')
    expect(html).toContain('REEF')
    expect(html).toContain('750 L Tidy Tank')
  })

  it('uses responsive grid classes: 1 column on phones, 2 on tablets, 4 on desktop', () => {
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('sm:grid-cols-2')
    expect(html).toContain('xl:grid-cols-4')
  })

  it('hides edit actions for view-only users and shows them otherwise', () => {
    expect(html).not.toContain('Record oil change')
    const edit = { lifespan: () => undefined, service: () => undefined, oilTarget: () => undefined, oilRecord: () => undefined, tire: () => undefined, tread: () => undefined, inspection: () => undefined }
    const editable = renderToStaticMarkup(<VehicleGauges state={state} vehicle={state.vehicles[0]} today={TODAY} handlers={{ jump: () => undefined, edit }} />)
    for (const x of ['Edit estimate', 'Record oil change', 'Update next oil change', 'Record tread depth', 'Submit inspection']) expect(editable).toContain(x)
  })

  it('renders any other vehicle without invented figures', () => {
    const v = state.vehicles.find((x) => x.id === T6005)!
    const h = renderToStaticMarkup(<VehicleGauges state={state} vehicle={v} today={TODAY} handlers={{ jump: () => undefined }} />)
    expect(h).not.toContain('data-testid="gauge-arc"')
    expect((h.match(/Unknown|No estimate set|No schedule recorded/g) ?? []).length).toBeGreaterThan(2)
  })
})
