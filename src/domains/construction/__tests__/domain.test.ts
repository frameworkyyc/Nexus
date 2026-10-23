import { describe, expect, it } from 'vitest'
import * as A from '../actions'
import { deriveExceptions } from '../exceptions'
import { companyIssues } from '../portfolio'
import { emptyTracker } from '../tracker/types'
import { packageProgress } from '../packageProgress'
import { buildPortfolio, buildSeed } from '../seed'
import { migrateConstruction } from '../store'
import {
  areaStatus, boltRows, bulkRows, computeStats, foundationsOfProject, portfolioCounts, projectSummaries, foundationActivities, crewsOnSite, deriveIssues, effectiveStatus, evaluateHandover, foundationState, foundationsOf, getIndex, plinthBoltStage, progressOf, qty,
} from '../selectors'
import type { ConstructionState } from '../types'

const TODAY = '2026-10-21'
const seed = () => buildSeed(TODAY)

function apply(s: ConstructionState, r: A.Reducer): ConstructionState {
  const out = r(s)
  if (out.error !== undefined) throw new Error(out.error)
  return out.state
}
const error = (s: ConstructionState, r: A.Reducer) => r(s).error

describe('seed integrity', () => {
  const s = seed()
  const idx = getIndex(s)

  it('has the five areas and the specified Mole Sieve / OP1-02 relationships', () => {
    expect(s.areas.map((a) => a.name)).toEqual(['Mole Sieve', 'Propane BOG', 'Piperack', 'Locomotive Shelter', 'E-House'])
    for (const n of ['21-01', '21-03', '21-05']) {
      const plinth = s.plinths.find((p) => p.id === `p-${n}-1`)
      expect(plinth?.anchorageTypeId).toBe('OP1-02')
    }
    expect(s.anchorageTypes.map((t) => t.code)).toContain('OP1-01')
    expect(s.company.name).toBe('Progressive')
    expect(s.projects[0]).toMatchObject({ name: 'REEF', jobNumber: '928', location: 'Ridley Island, British Columbia', scope: 'Concrete Foundations' })
  })

  it('does not assume one plinth per foundation or one anchorage type per plinth', () => {
    const counts = new Set(s.foundations.map((f) => idx.plinthsByFoundation.get(f.id)!.length))
    expect(counts.size).toBeGreaterThan(1)
    expect(new Set(s.plinths.map((p) => p.anchorageTypeId)).size).toBeGreaterThan(3)
  })

  it('references only existing records', () => {
    for (const p of s.plinths) {
      expect(idx.foundation.has(p.foundationId)).toBe(true)
      expect(idx.anchorage.has(p.anchorageTypeId!)).toBe(true)
    }
    for (const a of s.activities) expect(idx.foundation.has(a.foundationId)).toBe(true)
    for (const l of idx.poLine.values()) expect(l.line.kind === 'bolt' ? idx.spec.has(l.line.itemId) : idx.bulk.has(l.line.itemId)).toBe(true)
  })

  it('never allocates more than was received, or more than a plinth needs', () => {
    for (const [key, allocated] of idx.allocated) expect(allocated).toBeLessThanOrEqual(qty(idx.received, key))
    for (const r of boltRows(idx)) for (const l of r.lines) expect(l.allocated).toBeLessThanOrEqual(l.qty)
  })

  it('only marks plinths ready when every bolt is allocated', () => {
    for (const r of s.plinthReady) expect(plinthBoltStage(idx, idx.plinth.get(r.plinthId)!)).toBe('ready')
    for (const r of boltRows(idx)) for (const l of r.lines.filter((x) => x.ready)) expect(l.allocated).toBe(l.qty)
  })

  it('keeps physical progress consistent with materials (plinths forming have bolts ready)', () => {
    for (const a of s.activities.filter((x) => x.scope === 'plinth' && x.key === 'formed' && (x.status === 'complete' || x.status === 'in-progress'))) {
      expect(idx.ready.has(a.plinthId!)).toBe(true)
    }
  })

  it('contains the 700 sample nut requirement flagged as a sample', () => {
    const nuts = s.bulkMaterials.find((b) => b.areaId === 'mole-sieve' && b.kind === 'nut' && b.size === '3/4"')
    expect(nuts).toMatchObject({ requiredQty: 700, sample: true })
  })

  it('has no pour recorded without an approved pre-pour inspection', () => {
    expect(deriveIssues(idx, TODAY).filter((i) => i.category === 'sequence')).toEqual([])
  })
})

describe('rollups', () => {
  const s = seed()
  const idx = getIndex(s)

  it('derives project progress from the activity records, not stored percentages', () => {
    const stats = computeStats(idx, s.foundations)
    const constructionActs = s.activities.filter((a) => ['formed', 'poured', 'rebarBuilt', 'rebarInstalled'].includes(a.key))
    expect(stats.construction.total).toBe(constructionActs.length)
    expect(stats.construction.done).toBe(constructionActs.filter((a) => a.status === 'complete').length)
    expect(stats.footingPoured.total).toBe(s.foundations.length)
    expect(stats.plinthPoured.total).toBe(s.plinths.length)
  })

  it('keeps construction completion separate from survey and QA/QC completion', () => {
    const stats = computeStats(idx, s.foundations)
    expect(stats.constructed).toBeGreaterThanOrEqual(stats.closedOut)
    expect(stats.closedOut).toBeLessThan(stats.constructed + 1)
    // a foundation can be constructed while inspection is still pending
    const f = s.foundations.find((x) => x.number === '21-03')!
    expect(foundationState(idx, f).state).toBe('constructed')
  })

  it('updates area and project rollups when a foundation activity changes', () => {
    const before = computeStats(idx, idx.foundationsByArea.get('mole-sieve')!)
    const next = apply(s, A.updateActivity('f-21-05:postSurvey', { status: 'complete' }, TODAY))
    const nextIdx = getIndex(next)
    const after = computeStats(nextIdx, nextIdx.foundationsByArea.get('mole-sieve')!)
    expect(after.survey.done).toBe(before.survey.done + 1)
    expect(computeStats(nextIdx, next.foundations).survey.done).toBe(computeStats(idx, s.foundations).survey.done + 1)
    expect(next.activities.find((a) => a.id === 'f-21-05:postSurvey')?.actualDate).toBe(TODAY)
  })

  it('tracks plinths independently within one foundation', () => {
    const next = apply(s, A.updateActivity('p-21-02-2:postSurvey', { status: 'complete' }, TODAY))
    const i = getIndex(next)
    expect(effectiveStatus(i, i.activitiesByOwner.get('p-21-02-2')!.find((a) => a.key === 'postSurvey')!)).toBe('complete')
    expect(effectiveStatus(i, i.activitiesByOwner.get('p-21-02-1')!.find((a) => a.key === 'postSurvey')!)).toBe('complete')
    const p3 = i.activitiesByOwner.get('p-21-04-2')!.find((a) => a.key === 'postSurvey')!
    expect(effectiveStatus(i, p3)).toBe('not-started')
  })

  it('does not let derived material statuses be edited directly', () => {
    expect(error(s, A.updateActivity('p-21-05-1:anchorBolts', { status: 'complete' }, TODAY))).toMatch(/derived/)
  })
})

describe('receiving and allocation', () => {
  it('keeps receiving separate from allocation: arrival does not make a plinth ready', () => {
    const s = seed()
    const idx = getIndex(s)
    const plinth = idx.plinth.get('p-21-05-1')!
    const before = plinthBoltStage(idx, plinth)
    const po = s.purchaseOrders.find((p) => p.status === 'issued' && p.lines.some((l) => l.itemId === 'BS-02'))!
    const line = po.lines.find((l) => l.itemId === 'BS-02')!
    const next = apply(s, A.receiveDelivery(po.id, { date: TODAY, reference: 'SKID-T1', receivedBy: 'x', notes: '', lines: [{ poLineId: line.id, qtyShipped: 10, qtyReceived: 10, note: '' }] }))
    const i = getIndex(next)
    expect(qty(i.received, 'bolt:BS-02')).toBe(qty(idx.received, 'bolt:BS-02') + 10)
    expect(plinthBoltStage(i, i.plinth.get('p-21-05-1')!)).toBe(before)
    expect(i.ready.has('p-21-05-1')).toBe(false)
  })

  it('supports partial receipts and flags shortages and discrepancies', () => {
    const s = seed()
    const po = s.purchaseOrders.find((p) => p.id === 'po-0102')!
    const f = A.receiveDelivery
    const line = po.lines[0]
    const next = apply(s, f(po.id, { date: TODAY, reference: 'SKID-T2', receivedBy: 'x', notes: '', lines: [{ poLineId: line.id, qtyShipped: 20, qtyReceived: 18, note: 'Two bolts damaged' }] }))
    const last = next.deliveries[next.deliveries.length - 1]
    expect(last.lines[0].resolved).toBe(false)
    expect(deriveIssues(getIndex(next), TODAY).some((x) => x.category === 'delivery' && x.detail.includes('counted 18'))).toBe(true)
  })

  it('requires a note to over-receive', () => {
    const s = seed()
    const po = s.purchaseOrders.find((p) => p.id === 'po-0102')!
    expect(error(s, A.receiveDelivery(po.id, { date: TODAY, reference: '', receivedBy: '', notes: '', lines: [{ poLineId: po.lines[0].id, qtyShipped: 9999, qtyReceived: 9999, note: '' }] }))).toMatch(/over-receipt/)
  })

  it('cannot receive against a draft purchase order', () => {
    const s = seed()
    expect(error(s, A.receiveDelivery('po-0103', { date: TODAY, reference: '', receivedBy: '', notes: '', lines: [{ poLineId: 'po-0103-LBS-03', qtyShipped: 1, qtyReceived: 1, note: '' }] }))).toMatch(/issued/)
  })

  it('never allows the same received inventory to be allocated twice', () => {
    const s = seed()
    const idx = getIndex(s)
    const row = boltRows(idx).find((r) => r.spec.id === 'BS-02')!
    expect(row.available).toBeGreaterThan(0)
    const target = row.lines.find((l) => l.allocated < l.qty)!
    const take = Math.min(row.available, target.qty - target.allocated)
    const once = apply(s, A.allocate([{ itemType: 'bolt', itemId: 'BS-02', plinthId: target.plinth.id, qty: take }], TODAY))
    expect(boltRows(getIndex(once)).find((r) => r.spec.id === 'BS-02')!.available).toBe(row.available - take)
    // Drain the pool, then any further allocation must fail.
    const other = row.lines.filter((l) => l.plinth.id !== target.plinth.id && l.allocated < l.qty)
    let drained = once
    for (const l of other) {
      const avail = boltRows(getIndex(drained)).find((r) => r.spec.id === 'BS-02')!.available
      const q = Math.min(avail, l.qty - l.allocated)
      if (q > 0) drained = apply(drained, A.allocate([{ itemType: 'bolt', itemId: 'BS-02', plinthId: l.plinth.id, qty: q }], TODAY))
    }
    const left = boltRows(getIndex(drained)).find((r) => r.spec.id === 'BS-02')!
    const stillOpen = left.lines.find((l) => l.allocated < l.qty)
    if (stillOpen) expect(left.available).toBe(0)
    if (stillOpen) expect(error(drained, A.allocate([{ itemType: 'bolt', itemId: 'BS-02', plinthId: stillOpen.plinth.id, qty: 1 }], TODAY))).toMatch(/available/)
  })

  it('rejects an allocation that exceeds what a plinth requires', () => {
    const s = seed()
    const plinth = 'p-21-01-1'
    expect(error(s, A.allocate([{ itemType: 'bolt', itemId: 'BS-02', plinthId: plinth, qty: 1 }], TODAY))).toMatch(/exceed|available/)
  })

  it('requires full allocation before a plinth can be marked ready, and blocks returning ready stock', () => {
    const s = seed()
    const idx = getIndex(s)
    const partial = boltRows(idx).flatMap((r) => r.lines).find((l) => l.allocated > 0 && l.allocated < l.qty)
    if (partial) expect(error(s, A.setBoltsReady(partial.plinth.id, true, TODAY))).toMatch(/allocated/)
    const ready = s.plinthReady[0]
    const alloc = s.allocations.find((a) => a.plinthId === ready.plinthId && a.itemType === 'bolt')!
    expect(error(s, A.returnAllocation(alloc.id))).toMatch(/ready/)
    const unready = apply(s, A.setBoltsReady(ready.plinthId, false, TODAY))
    const returned = apply(unready, A.returnAllocation(alloc.id))
    expect(boltRows(getIndex(returned)).find((r) => r.spec.id === alloc.itemId)!.available).toBeGreaterThan(0)
  })

  it('consolidates identical bolt specs across anchorage types while preserving foundation requirements', () => {
    const idx = getIndex(seed())
    const bs03 = boltRows(idx).find((r) => r.spec.id === 'BS-03')!
    expect(new Set(bs03.lines.map((l) => l.anchorageTypeId)).size).toBeGreaterThan(1)
    expect(bs03.required).toBe(bs03.lines.reduce((t, l) => t + l.qty, 0))
    expect(bs03.lines.every((l) => l.foundation && l.plinth)).toBe(true)
  })

  it('allocates bulk hardware within an area only', () => {
    const s = seed()
    const idx = getIndex(s)
    const row = bulkRows(idx, 'mole-sieve').find((r) => r.item.kind === 'nut' && r.item.size === '3/4"')!
    expect(row.available).toBeGreaterThan(0)
    expect(error(s, A.allocate([{ itemType: 'bulk', itemId: row.item.id, plinthId: 'p-22-01-1', qty: 1 }], TODAY))).toBeTruthy()
  })

  it('creates, issues and receives a new purchase order for a shortfall', () => {
    let s = seed()
    let poId = ''
    s = apply(s, A.createPurchaseOrder('sup-steel', null, 'test', (id) => (poId = id)))
    s = apply(s, A.addPOLine(poId, 'bolt', 'BS-05', 60))
    expect(boltRows(getIndex(s)).find((r) => r.spec.id === 'BS-05')!.draft).toBe(60)
    s = apply(s, A.issuePurchaseOrder(poId, TODAY))
    expect(boltRows(getIndex(s)).find((r) => r.spec.id === 'BS-05')!.ordered).toBe(60)
    s = apply(s, A.receiveDelivery(poId, { date: TODAY, reference: 'T', receivedBy: 'x', notes: '', lines: [{ poLineId: `${poId}-LBS-05`, qtyShipped: 30, qtyReceived: 30, note: '' }] }))
    expect(boltRows(getIndex(s)).find((r) => r.spec.id === 'BS-05')!.available).toBe(30)
  })
})

describe('fabrication workflow', () => {
  it('enforces approval and authorization before fabrication, and collection before site receipt', () => {
    let s = seed()
    const req = s.fabrication.find((r) => r.approval === 'quote-requested')!
    expect(error(s, A.updateFabrication(req.id, { fabrication: 'cutting' }, TODAY))).toMatch(/approved/)
    expect(error(s, A.updateFabrication(req.id, { approval: 'approved' }, TODAY))).toMatch(/drawing/)
    s = apply(s, A.updateFabrication(req.id, { supplierDrawingDocId: s.documents[0].id }, TODAY))
    s = apply(s, A.updateFabrication(req.id, { approval: 'approved', authorization: 'authorized' }, TODAY))
    s = apply(s, A.updateFabrication(req.id, { fabrication: 'complete' }, TODAY))
    expect(error(s, A.updateFabrication(req.id, { siteReceipt: 'received' }, TODAY))).toMatch(/collected/)
    s = apply(s, A.updateFabrication(req.id, { pickup: 'ready' }, TODAY))
    s = apply(s, A.updateFabrication(req.id, { pickup: 'collected' }, TODAY))
    s = apply(s, A.updateFabrication(req.id, { siteReceipt: 'received' }, TODAY))
    const done = s.fabrication.find((r) => r.id === req.id)!
    expect(done.history.length).toBeGreaterThan(req.history.length)
    expect(done.receivedDate).toBe(TODAY)
  })

  it('drives the plywood template activity from site receipt', () => {
    let s = seed()
    const req = s.fabrication.find((r) => r.siteReceipt === 'pending' && r.plinthIds.length)!
    const plinthId = req.plinthIds[0]
    const status = (st: ConstructionState) => { const i = getIndex(st); return effectiveStatus(i, i.activitiesByOwner.get(plinthId)!.find((a) => a.key === 'templates')!) }
    expect(status(s)).not.toBe('complete')
    s = apply(s, A.updateFabrication(req.id, { supplierDrawingDocId: s.documents[0].id }, TODAY))
    s = apply(s, A.updateFabrication(req.id, { approval: 'approved', authorization: 'paid', fabrication: 'complete', pickup: 'collected', siteReceipt: 'received' }, TODAY))
    expect(status(s)).toBe('complete')
  })

  it('configures quantity independently of assignments', () => {
    let s = seed()
    const req = s.fabrication[0]
    s = apply(s, A.updateFabrication(req.id, { quantity: 1, reuse: 'reusable' }, TODAY))
    s = apply(s, A.setFabricationPlinths(req.id, req.plinthIds.slice(0, 2), TODAY))
    const next = s.fabrication[0]
    expect(next.quantity).toBe(1)
    expect(next.plinthIds).toHaveLength(Math.min(2, req.plinthIds.length))
  })
})

describe('handover', () => {
  it('never marks an area handed over automatically', () => {
    let s = seed()
    const areaId = 'e-house'
    // Force every activity to complete/approved and every manual requirement done.
    s = { ...s, activities: s.activities.map((a) => (s.foundations.find((f) => f.id === a.foundationId)!.areaId === areaId ? { ...a, status: a.key.includes('Inspection') ? 'approved' as const : 'complete' as const } : a)) }
    for (const r of s.handover.find((h) => h.areaId === areaId)!.requirements.filter((r) => !r.metric)) s = apply(s, A.setRequirementDone(areaId, r.id, true, TODAY))
    const ev = evaluateHandover(getIndex(s), areaId)
    expect(ev.constructionComplete).toBe(true)
    expect(ev.record.acceptance).toBe('not-submitted')
    expect(ev.phase).toBe('handover-preparation')
    expect(ev.allMet).toBe(true)
    expect(error(s, A.recordAcceptance(areaId, true, 'Owner rep', TODAY))).toMatch(/submitted/)
    s = apply(s, A.submitHandover(areaId, TODAY, ev.allMet))
    s = apply(s, A.recordAcceptance(areaId, true, 'Owner rep', TODAY))
    expect(evaluateHandover(getIndex(s), areaId).phase).toBe('handed-over')
  })

  it('blocks submission while requirements are outstanding and supports configurable requirements', () => {
    let s = seed()
    const ev = evaluateHandover(getIndex(s), 'mole-sieve')
    expect(ev.allMet).toBe(false)
    expect(error(s, A.submitHandover('mole-sieve', TODAY, ev.allMet))).toMatch(/must be met/)
    s = apply(s, A.addRequirement('mole-sieve', 'Owner walkdown completed', null))
    expect(evaluateHandover(getIndex(s), 'mole-sieve').items.at(-1)?.label).toBe('Owner walkdown completed')
  })
})

describe('workforce context', () => {
  it('has two crews and one or two superintendents on site at any time', () => {
    const idx = getIndex(seed())
    for (let d = 0; d < 42; d++) {
      const date = new Date(2026, 9, 1 + d).toISOString().slice(0, 10)
      const on = crewsOnSite(idx, date)
      expect(on.crews).toHaveLength(2)
      expect(on.superintendents.length).toBeGreaterThanOrEqual(1)
    }
    const people = idx.state.people
    expect(people.filter((p) => p.role === 'foreman')).toHaveLength(3)
    expect(people.filter((p) => p.role === 'carpenter')).toHaveLength(12)
  })
})

describe('construction progress', () => {
  const s = seed()
  const idx = getIndex(s)
  const only = (ids: string[], status: 'complete' | 'not-started') => (state: ConstructionState, owner: string) => ({
    ...state,
    activities: state.activities.map((a) => ((a.plinthId ?? a.foundationId) === owner && ids.includes(a.key) ? { ...a, status } : a)),
  })

  it('is 0 with nothing done and 100 with everything done for an element', () => {
    const blank = { ...s, activities: s.activities.map((a) => ({ ...a, status: 'not-started' as const })) }
    expect(computeStats(getIndex(blank), blank.foundations).progress).toBe(0)
    const full = { ...blank, activities: blank.activities.map((a) => ({ ...a, status: 'complete' as const })) }
    expect(computeStats(getIndex(full), full.foundations).progress).toBe(100)
  })

  it('counts rebar as one stage, not as half of all progress', () => {
    const base = { ...s, activities: s.activities.map((a) => ({ ...a, status: 'not-started' as const })) }
    const f = s.foundations.find((x) => x.number === '21-01')!
    const owner = f.id
    const rebarOnly = only(['rebarBuilt', 'rebarInstalled'], 'complete')(base, owner)
    const footingActs = getIndex(rebarOnly).activitiesByOwner.get(owner)!
    expect(progressOf(getIndex(rebarOnly), footingActs)).toBe(33) // 1 of 3 stages
    const poured = only(['poured'], 'complete')(base, owner)
    expect(progressOf(getIndex(poured), getIndex(poured).activitiesByOwner.get(owner)!)).toBe(33)
    const half = only(['rebarBuilt'], 'complete')(base, owner)
    expect(progressOf(getIndex(half), getIndex(half).activitiesByOwner.get(owner)!)).toBe(17) // half of the rebar stage
  })

  it('ignores survey, QA/QC and material statuses', () => {
    const before = computeStats(idx, s.foundations).progress
    const changed = { ...s, activities: s.activities.map((a) => (['preSurvey', 'postSurvey', 'preInspection', 'postInspection', 'solePlates'].includes(a.key) ? { ...a, status: 'complete' as const } : a)) }
    expect(computeStats(getIndex(changed), changed.foundations).progress).toBe(before)
  })

  it('pools elements across areas rather than averaging the area percentages', () => {
    const areas = s.areas.map((a) => computeStats(idx, foundationsOf(idx, a.id)))
    const overall = computeStats(idx, s.foundations)
    const elements = s.foundations.length + s.plinths.length
    const weighted = areas.reduce((t, a) => t + (a.progress / 100) * (a.foundations + a.plinths), 0) / elements
    expect(Math.abs(overall.progress - weighted * 100)).toBeLessThanOrEqual(areas.length / 2)
  })
})

describe('handover phases', () => {
  it('starts every area at construction in progress and never at handed over', () => {
    const idx = getIndex(seed())
    for (const a of idx.state.areas) expect(evaluateHandover(idx, a.id).phase).toBe('in-progress')
  })

  it('moves construction complete → preparation → ready for review → handed over only through deliberate steps', () => {
    let s = seed()
    const areaId = 'e-house'
    s = { ...s, activities: s.activities.map((a) => (s.foundations.find((f) => f.id === a.foundationId)!.areaId === areaId ? { ...a, status: a.key.includes('Inspection') ? ('approved' as const) : ('complete' as const) } : a)) }
    expect(evaluateHandover(getIndex(s), areaId).phase).toBe('construction-complete')
    const manual = s.handover.find((h) => h.areaId === areaId)!.requirements.filter((r) => !r.metric)
    s = apply(s, A.setRequirementDone(areaId, manual[0].id, true, TODAY))
    expect(evaluateHandover(getIndex(s), areaId).phase).toBe('handover-preparation')
    for (const r of manual.slice(1)) s = apply(s, A.setRequirementDone(areaId, r.id, true, TODAY))
    s = apply(s, A.submitHandover(areaId, TODAY, evaluateHandover(getIndex(s), areaId).allMet))
    expect(evaluateHandover(getIndex(s), areaId).phase).toBe('ready-for-review')
    s = apply(s, A.recordAcceptance(areaId, true, 'Owner rep', TODAY))
    expect(evaluateHandover(getIndex(s), areaId).phase).toBe('handed-over')
  })
})

describe('dashboard exceptions', () => {
  const idx = getIndex(seed())
  const list = deriveExceptions(idx, TODAY, 'reef')

  it('is short, sorted by severity, and every item links to a record with an area and status', () => {
    expect(list.length).toBeGreaterThan(0)
    expect(list.length).toBeLessThan(deriveIssues(idx, TODAY).length)
    const rank = list.map((e) => (e.severity === 'high' ? 0 : 1))
    expect([...rank].sort()).toEqual(rank)
    for (const e of list) {
      expect(e.to).toMatch(/^\/projects\/reef\//)
      expect(e.area).toBeTruthy()
      expect(e.status).toBeTruthy()
    }
  })

  it('groups related records instead of repeating them', () => {
    const bolts = list.filter((e) => e.id.startsWith('bolts:'))
    expect(new Set(bolts.map((e) => e.area)).size).toBe(bolts.length)
  })

  it('covers the required exception types', () => {
    const ids = list.map((e) => e.id.split(':')[0])
    for (const k of ['blocked', 'bolts', 'po', 'fab', 'def']) expect(ids).toContain(k)
  })
})

describe('foundation completion (one definition everywhere)', () => {
  const s = seed()
  const idx = getIndex(s)
  const isComplete = (f: ConstructionState['foundations'][number]) =>
    foundationActivities(idx, f).filter((a) => ['formed', 'poured', 'rebarBuilt', 'rebarInstalled'].includes(a.key)).every((a) => effectiveStatus(idx, a) === 'complete')

  it('complete means every rebar, forming and pouring activity of the footing and all plinths is complete', () => {
    for (const f of s.foundations) {
      expect(['constructed', 'closed-out'].includes(foundationState(idx, f).state)).toBe(isComplete(f))
    }
  })

  it('complete + in progress + not started always equals the total, for every area and the project', () => {
    for (const set of [...s.areas.map((a) => foundationsOf(idx, a.id)), foundationsOfProject(idx, 'reef')]) {
      const st = computeStats(idx, set)
      expect(st.constructed + st.inProgress + st.notStarted).toBe(st.foundations)
    }
    const total = s.areas.reduce((t, a) => t + computeStats(idx, foundationsOf(idx, a.id)).constructed, 0)
    expect(total).toBe(computeStats(idx, foundationsOfProject(idx, 'reef')).constructed)
  })

  it('keeps completion separate from close-out and from handover', () => {
    const st = computeStats(idx, s.foundations)
    expect(st.closedOut).toBeLessThan(st.constructed) // seed has complete foundations still awaiting QA/QC
    for (const a of s.areas) expect(evaluateHandover(idx, a.id).phase).not.toBe('handed-over')
  })

  it('area outstanding foundations use the same definition', () => {
    for (const a of s.areas) {
      const st = computeStats(idx, foundationsOf(idx, a.id))
      expect(evaluateHandover(idx, a.id).outstandingFoundations).toBe(st.foundations - st.constructed)
    }
  })

  it('area status reads "Not started" only when nothing has been completed', () => {
    const blank = { ...s, activities: s.activities.map((a) => ({ ...a, status: 'not-started' as const })) }
    expect(areaStatus(getIndex(blank), 'e-house').label).toBe('Not started')
    expect(areaStatus(idx, 'e-house').label).not.toBe('Not started')
  })
})

describe('company dashboard', () => {
  const s = seed()
  const idx = getIndex(s)
  const ex = (id: string) => deriveExceptions(idx, TODAY, id)

  it('has dozens of projects with unique ids and job numbers, REEF (928) included once', () => {
    expect(s.projects.length).toBeGreaterThan(20)
    expect(new Set(s.projects.map((p) => p.id)).size).toBe(s.projects.length)
    expect(new Set(s.projects.map((p) => p.jobNumber)).size).toBe(s.projects.length)
    expect(s.projects.filter((p) => p.jobNumber === '928')).toHaveLength(1)
  })

  it('counts active (in delivery), at risk and delayed from recorded status', () => {
    const c = portfolioCounts(s.projects)
    expect(c.active).toBe(s.projects.filter((p) => ['active', 'at-risk', 'delayed'].includes(p.status)).length)
    expect(c.atRisk).toBe(s.projects.filter((p) => p.status === 'at-risk').length)
    expect(c.delayed).toBe(s.projects.filter((p) => p.status === 'delayed').length)
    expect(c.atRisk + c.delayed).toBeLessThanOrEqual(c.active)
  })

  it('derives REEF completion from activity records and uses reported figures for summary projects', () => {
    const rows = projectSummaries(idx, ex)
    const reef = rows.find((r) => r.project.id === 'reef')!
    expect(reef.progressSource).toBe('derived')
    expect(reef.progress).toBe(computeStats(idx, foundationsOfProject(idx, 'reef')).progress)
    for (const r of rows.filter((x) => x.project.tracking === 'summary')) {
      expect(r.progressSource).toBe('reported')
      expect(r.progress).toBe(r.project.reportedProgress)
    }
  })

  it('never infers status from completion: low or high percentages do not change a recorded status', () => {
    const delayed = s.projects.find((p) => p.status === 'delayed' && p.tracking === 'summary')!
    const active = s.projects.find((p) => p.status === 'active' && p.tracking === 'summary')!
    let next = apply(s, A.setReportedProgress(delayed.id, 100))
    next = apply(next, A.setReportedProgress(active.id, 0))
    expect(next.projects.find((p) => p.id === delayed.id)!.status).toBe('delayed')
    expect(next.projects.find((p) => p.id === active.id)!.status).toBe('active')
    expect(portfolioCounts(next.projects)).toEqual(portfolioCounts(s.projects))
    // Real REEF records changing does not alter its recorded status either.
    const blank = { ...s, activities: s.activities.map((a) => ({ ...a, status: 'not-started' as const })) }
    expect(blank.projects.find((p) => p.id === 'reef')!.status).toBe('at-risk')
  })

  it('requires a recorded reason for at risk, delayed or on hold, and rejects reported progress on detailed projects', () => {
    const p = s.projects.find((x) => x.status === 'active' && x.tracking === 'summary')!
    expect(error(s, A.setProjectStatus(p.id, 'delayed', ''))).toMatch(/why/)
    const next = apply(s, A.setProjectStatus(p.id, 'delayed', 'Client directed change'))
    expect(next.projects.find((x) => x.id === p.id)).toMatchObject({ status: 'delayed', statusNote: 'Client directed change' })
    expect(error(s, A.setReportedProgress('reef', 50))).toMatch(/calculated/)
  })

  it('lists significant issues only from recorded status notes, recorded issues and critical derived items', () => {
    const issues = companyIssues(idx, TODAY)
    expect(issues.length).toBeGreaterThan(0)
    const projectsWithIssues = new Set(issues.map((i) => i.projectId))
    for (const id of projectsWithIssues) {
      const p = s.projects.find((x) => x.id === id)!
      const recorded = s.projectIssues.some((i) => i.projectId === id && i.status === 'open')
      expect(['at-risk', 'delayed'].includes(p.status) || recorded || p.tracking === 'detailed').toBe(true)
    }
    expect(issues[0].severity).toBe('high')
    // a healthy active project with low completion is not flagged
    const quiet = s.projects.find((p) => p.status === 'active' && p.tracking === 'summary' && !s.projectIssues.some((i) => i.projectId === p.id))
    if (quiet) expect(projectsWithIssues.has(quiet.id)).toBe(false)
  })

  it('stays fast and well-formed with hundreds of projects', () => {
    const big = buildPortfolio(TODAY, 400)
    expect(new Set(big.projects.map((p) => p.id)).size).toBe(400)
    const state = { ...s, projects: [s.projects[0], ...big.projects], projectIssues: big.issues }
    const started = Date.now()
    const rows = projectSummaries(getIndex(state), () => [])
    expect(rows).toHaveLength(401)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('storage migration', () => {
  it('upgrades a v1 save without losing edits', () => {
    const fresh = seed()
    const v1 = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>
    delete v1.projectIssues
    ;(v1.projects as Record<string, unknown>[]) = [{ id: 'reef', companyId: 'progressive', name: 'REEF', jobNumber: '928', location: 'Ridley Island, British Columbia', scope: 'Concrete Foundations' }]
    const edited = apply(fresh, A.updateActivity('f-21-05:postSurvey', { status: 'complete' }, TODAY))
    v1.activities = edited.activities
    const migrated = migrateConstruction(v1, 1)
    expect(migrated.projects.length).toBeGreaterThan(20)
    expect(migrated.projects[0]).toMatchObject({ id: 'reef', name: 'REEF', tracking: 'detailed', status: 'at-risk' })
    expect(migrated.activities.find((a) => a.id === 'f-21-05:postSurvey')!.status).toBe('complete')
    expect(Array.isArray(migrated.projectIssues)).toBe(true)
  })
})

describe('package progress', () => {
  const s = seed()
  const idx = getIndex(s)
  const mole = s.areas.find((a) => a.name === 'Mole Sieve')!
  const ind = (k: string, i = idx) => packageProgress(i, mole.id, emptyTracker()).find((x) => x.key === k)!

  it('derives every indicator from records, in range', () => {
    for (const p of packageProgress(idx, mole.id, emptyTracker())) {
      if (p.percent === null) continue
      expect(p.percent).toBeGreaterThanOrEqual(0)
      expect(p.percent).toBeLessThanOrEqual(100)
    }
  })
  it('reports Not tracked for unrecorded items and null for an empty area', () => {
    expect(ind('survey').rows.at(-1)!.value).toBe('Not tracked')
    expect(ind('qaqc').rows.at(-1)!.value).toBe('Not tracked')
    const empty = { ...s, foundations: s.foundations.filter((f) => f.areaId !== mole.id), plinths: [] }
    expect(ind('installation', getIndex(empty)).percent).toBeNull()
  })
  it('counts only approved inspections as accepted; submitted does not raise the figure', () => {
    const acts = foundationsOf(idx, mole.id).flatMap((f) => foundationActivities(idx, f)).filter((a) => a.key.endsWith('Inspection'))
    const approved = acts.filter((a) => a.status === 'approved').length
    expect(ind('qaqc').percent).toBe(Math.round((approved / acts.length) * 100))
    const bumped = { ...s, activities: s.activities.map((a) => (a.key === 'preInspection' && a.status === 'not-started' ? { ...a, status: 'pending-review' as const } : a)) }
    expect(ind('qaqc', getIndex(bumped)).percent).toBe(ind('qaqc').percent)
  })
})
