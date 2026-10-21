import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as A from '../actions'
import { inspectionIndicator, oilIndicator, serviceIndicator, tireIndicator } from '../indicators'
import { buildFleetSeed, T6010_ID } from '../seed'
import { isOilChange } from '../selectors'
import { VehicleGauges } from '../VehicleGauges'
import type { FleetState } from '../types'

const TODAY = '2026-10-21'
const seed = () => buildFleetSeed()
const apply = (s: FleetState, r: A.Reducer): FleetState => { const o = r(s); if (o.error !== undefined) throw new Error(o.error); return o.state }
const tire = (over: Partial<A.TireInput> = {}): A.TireInput => ({ manufacturer: 'Bridgestone', model: 'Dueler A/T', size: '', classes: [], studded: 'unknown', origin: 'Original factory tires', installDate: null, installOdometer: 0, condition: 'unknown', notes: '', ...over })
const tireId = (s: FleetState) => s.tireSets.find((t) => t.vehicleId === T6010_ID && t.active)!.id
const maint = (s: FleetState, type: string, odometer: number | null, date = '2026-10-10') => apply(s, A.recordMaintenance(T6010_ID, { date, serviceType: type, odometer, description: '', notes: '' }, TODAY))

describe('scheduled service gauge (T6010 verified values)', () => {
  it('shows 1,695 km remaining with no fabricated percentage', () => {
    const i = serviceIndicator(seed(), T6010_ID)
    expect(i).toMatchObject({ current: 11_856, dueAt: 13_551, remaining: 1_695, percent: null, intervalStart: null })
    expect(i.status).toBe('info') // not overdue, but no warning threshold was recorded, so it is not called "healthy"
    expect(i.label).toContain('1,695 km')
  })

  it('turns orange inside the recorded warning window and red when overdue', () => {
    let s = apply(seed(), A.setServiceTarget(T6010_ID, 13_551, '', TODAY, { warnWithinKm: 2_000 }))
    expect(serviceIndicator(s, T6010_ID).status).toBe('warn')
    s = apply(s, A.setServiceTarget(T6010_ID, 13_551, '', TODAY, { warnWithinKm: 500 }))
    expect(serviceIndicator(s, T6010_ID).status).toBe('ok')
    s = apply(seed(), A.recordOdometer(T6010_ID, { date: '2026-10-21', reading: 13_600, note: '' }, TODAY))
    expect(serviceIndicator(s, T6010_ID)).toMatchObject({ remaining: -49, status: 'bad' })
  })

  it('computes a percentage only when the interval start (last service of the same recorded type) is known', () => {
    let s = apply(seed(), A.setServiceTarget(T6010_ID, 13_551, '', TODAY, { serviceType: 'Brake service' }))
    expect(serviceIndicator(s, T6010_ID).percent).toBeNull()
    s = maint(s, 'Brake service', 10_000)
    const i = serviceIndicator(s, T6010_ID)
    expect(i.intervalStart).toBe(10_000)
    expect(i.percent).toBeCloseTo(((11_856 - 10_000) / (13_551 - 10_000)) * 100)
    expect(maint(seed(), 'Oil change', 9_000) && serviceIndicator(maint(seed(), 'Oil change', 9_000), T6010_ID).percent).toBeNull() // an oil change is not the start of a service interval
  })
})

describe('oil change gauge', () => {
  it('is Unknown when no oil-change schedule is recorded, even though a next service exists', () => {
    const i = oilIndicator(seed(), T6010_ID)
    expect(i).toMatchObject({ status: 'unknown', schedule: undefined, remaining: null, percent: null, lastAt: null })
    expect(i.label).toMatch(/no oil-change schedule recorded/i)
  })

  it('does not treat the untyped next service as an oil change, and a typed one does not replace the next service', () => {
    const s = apply(seed(), A.setServiceTarget(T6010_ID, 12_500, '', TODAY, { serviceType: 'Oil change', warnWithinKm: 1_000 }))
    expect(serviceIndicator(s, T6010_ID)).toMatchObject({ dueAt: 13_551, remaining: 1_695 })
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ dueAt: 12_500, remaining: 644, status: 'warn' })
  })

  it('shows the interval percentage only when both the last change and the next change odometers are known', () => {
    let s = apply(seed(), A.setServiceTarget(T6010_ID, 15_000, '', TODAY, { serviceType: 'Oil change', warnWithinKm: 1_000 }))
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ percent: null, status: 'ok' }) // start unknown
    s = maint(s, 'Oil change', null) // done, but odometer not recorded
    expect(oilIndicator(s, T6010_ID).percent).toBeNull()
    s = maint(s, 'Oil change', 10_000, '2026-10-12')
    expect(oilIndicator(s, T6010_ID).percent).toBeCloseTo(37.12, 1)
  })

  it('is red when overdue', () => {
    const s = apply(seed(), A.setServiceTarget(T6010_ID, 11_000, '', TODAY, { serviceType: 'Oil change' }))
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ remaining: -856, status: 'bad' })
  })

  it('treats a target at or below the last completed oil change as already done, not overdue', () => {
    let s = apply(seed(), A.setServiceTarget(T6010_ID, 11_000, '', TODAY, { serviceType: 'Oil change' }))
    s = maint(s, 'Oil change', 11_000)
    expect(oilIndicator(s, T6010_ID)).toMatchObject({ status: 'unknown', schedule: undefined, lastAt: 11_000 })
  })

  it('recognises oil changes by their recorded type only', () => {
    expect(['Oil change', 'oil change', 'Engine oil change', 'Oil & filter', 'Oil and filter'].every(isOilChange)).toBe(true)
    expect(['Oil leak repair', 'Brake service', '', null].some((t) => isOilChange(t))).toBe(false)
  })
})

describe('tire gauge (T6010: factory Bridgestone Dueler A/T, 11,856 km)', () => {
  it('shows the distance but keeps condition and remaining life Unknown', () => {
    const i = tireIndicator(seed(), T6010_ID)
    expect(i).toMatchObject({ km: 11_856, status: 'unknown', percent: null, remainingKm: null, treadMm: null, basis: 'none' })
    expect(i.set).toMatchObject({ manufacturer: 'Bridgestone', model: 'Dueler A/T', origin: 'Original factory tires', installOdometer: 0 })
  })

  it('is never green from distance or age alone, even with a configured lifespan', () => {
    const s = apply(seed(), A.updateTireSet(tireId(seed()), tire({ expectedLifeKm: 60_000 }), TODAY))
    const i = tireIndicator(s, T6010_ID)
    expect(i.status).toBe('info')
    expect(i.percent).toBeCloseTo(19.76, 1)
    expect(i.remainingKm).toBe(48_144)
  })

  it('goes red past a configured lifespan and green only on a recorded good condition or a measured tread above the limit', () => {
    let s = apply(seed(), A.updateTireSet(tireId(seed()), tire({ expectedLifeKm: 10_000 }), TODAY))
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ status: 'bad', remainingKm: -1_856 })
    s = apply(seed(), A.updateTireSet(tireId(seed()), tire({ condition: 'good' }), TODAY))
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ status: 'ok', basis: 'condition' })
    s = apply(seed(), A.updateTireSet(tireId(seed()), tire({ replaceAtMm: 3 }), TODAY))
    s = apply(s, A.addTreadMeasurement(tireId(s), { date: '2026-10-20', depthMm: 8, note: '' }, TODAY))
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ status: 'ok', basis: 'tread', treadMm: 8 })
    s = apply(s, A.addTreadMeasurement(tireId(s), { date: '2026-10-21', depthMm: 3, note: '' }, TODAY))
    expect(tireIndicator(s, T6010_ID)).toMatchObject({ status: 'bad', basis: 'tread' })
  })

  it('maps recorded conditions: fair and worn are orange, replace is red', () => {
    const st = (condition: A.TireInput['condition']) => tireIndicator(apply(seed(), A.updateTireSet(tireId(seed()), tire({ condition }), TODAY)), T6010_ID).status
    expect([st('fair'), st('worn'), st('replace')]).toEqual(['warn', 'warn', 'bad'])
  })

  it('validates the configurable thresholds and invents no default', () => {
    const base = seed()
    expect(A.updateTireSet(tireId(base), tire({ expectedLifeKm: -5 }), TODAY)(base).error).toMatch(/expected tire lifespan/)
    expect(A.updateTireSet(tireId(base), tire({ expectedLifeKm: 1.5 }), TODAY)(base).error).toMatch(/expected tire lifespan/)
    expect(A.updateTireSet(tireId(base), tire({ replaceAtMm: 99 }), TODAY)(base).error).toMatch(/replacement tread depth/)
    expect(base.tireSets[0]).toMatchObject({ expectedLifeKm: null, replaceAtMm: null })
  })

  it('has no set to judge when none is fitted', () => {
    expect(tireIndicator(seed(), 'veh-T6005')).toMatchObject({ set: undefined, status: 'unknown', km: null })
  })
})

describe('inspection gauge', () => {
  const inspect = (s: FleetState, date: string) => apply(s, A.submitInspection(T6010_ID, { date, submittedBy: 'x', notes: '', defects: [] }, TODAY))

  it('is Unknown with no inspection recorded', () => {
    expect(inspectionIndicator(seed(), T6010_ID, TODAY)).toMatchObject({ cadence: 'unknown', status: 'unknown', percent: null })
  })

  it('distinguishes current, due and overdue by the weekly interval', () => {
    expect(inspectionIndicator(inspect(seed(), '2026-10-18'), T6010_ID, TODAY)).toMatchObject({ cadence: 'current', daysSince: 3, daysUntilDue: 4 })
    expect(inspectionIndicator(inspect(seed(), '2026-10-14'), T6010_ID, TODAY)).toMatchObject({ cadence: 'due', status: 'warn' })
    expect(inspectionIndicator(inspect(seed(), '2026-10-10'), T6010_ID, TODAY)).toMatchObject({ cadence: 'overdue', status: 'bad', daysSince: 11 })
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
  const html = renderToStaticMarkup(<VehicleGauges state={seed()} vehicle={seed().vehicles[0]} today={TODAY} handlers={{ jump: () => undefined }} />)

  it('shows the verified figures', () => {
    expect(html).toContain('11,856')
    expect(html).toContain('1,695')
    expect(html).toContain('13,551')
    expect(html).toContain('Bridgestone Dueler A/T')
    expect(html).toContain('original factory tires')
    expect(html).toContain('750 L Tidy Tank')
  })

  it('shows Unknown rather than made-up values, and never an arc without data', () => {
    expect(html).toContain('No oil-change schedule')
    expect(html).toContain('Remaining life: Unknown')
    expect(html).toContain('Condition: Not assessed')
    expect(html).toContain('Interval start not recorded')
    expect(html).not.toContain('data-testid="gauge-arc"') // every ring here lacks the data for a percentage
  })

  it('uses responsive grid classes: 1 column on phones, 2 on tablets, 4 on desktop', () => {
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('sm:grid-cols-2')
    expect(html).toContain('xl:grid-cols-4')
  })

  it('hides edit actions for view-only users', () => {
    expect(html).not.toContain('Record oil change')
    const editable = renderToStaticMarkup(<VehicleGauges state={seed()} vehicle={seed().vehicles[0]} today={TODAY} handlers={{ jump: () => undefined, edit: { service: () => undefined, oilTarget: () => undefined, oilRecord: () => undefined, tire: () => undefined, tread: () => undefined, inspection: () => undefined } }} />)
    expect(editable).toContain('Record oil change')
    expect(editable).toContain('Set next oil change')
  })
})
