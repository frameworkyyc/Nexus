import { isoDate } from './isoDate'
import { componentInfo, componentVolume, concreteOf, footingDone, isOpen, itemKey } from './pours'
import type { Reducer } from './actions'
import type { ConstructionState, Pour, PourItem } from './types'

const fail = (error: string) => ({ error }) as const
const ok = (state: ConstructionState) => ({ state }) as const

const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const pourOf = (s: ConstructionState, id: string) => (s.pours ?? []).find((p) => p.id === id)
const itemsOf = (s: ConstructionState) => s.pourItems ?? []
const okPct = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
const okM3 = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100_000
const projectOf = (s: ConstructionState, foundationId: string) => { const f = s.foundations.find((x) => x.id === foundationId); return f ? s.areas.find((a) => a.id === f.areaId)?.projectId : undefined }
const patchPour = (s: ConstructionState, id: string, fn: (p: Pour) => Pour): ConstructionState => ({ ...s, pours: (s.pours ?? []).map((p) => (p.id === id ? fn(p) : p)) })
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Ids are sequential per project so the browser and the server agree on them. */
function nextPourId(s: ConstructionState, projectId: string) {
  const slug = projectId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  let n = (s.pours ?? []).filter((p) => p.projectId === projectId).length + 1
  while ((s.pours ?? []).some((p) => p.id === `pour-${slug}-${n}`)) n++
  return `pour-${slug}-${n}`
}

export interface PourPatch { name?: string; date?: string | null; wastePct?: number; notes?: string }

/** Creates a pour plan. A pour with a date is "scheduled"; without one it is only "planned". */
export const createPour = (projectId: string, name: string, date: string | null, wastePct: number, notes = ''): Reducer => (s, ctx) => {
  if (!s.projects.some((p) => p.id === projectId)) return fail('Project not found.')
  const n = clean(name, 80)
  if (n.length < 2) return fail('Enter a name for the pour, for example “Footings OP1 – week 12”.')
  if (date !== null && !isoDate(date)) return fail('Enter a valid date.')
  if (!okPct(wastePct)) return fail('Waste / overage must be between 0 and 100 percent.')
  const pour: Pour = { id: nextPourId(s, projectId), projectId, name: n, status: date ? 'scheduled' : 'planned', date, wastePct, notes: clean(notes, 500), actualM3: null, completedDate: null, createdAt: ctx?.now ?? new Date().toISOString(), createdBy: ctx?.actor ?? '' }
  return ok({ ...s, pours: [...(s.pours ?? []), pour] })
}

export const updatePour = (pourId: string, patch: PourPatch): Reducer => (s) => {
  const p = pourOf(s, pourId)
  if (!p) return fail('Pour not found.')
  if (p.status === 'cancelled') return fail('A cancelled pour cannot be changed.')
  const closed = p.status === 'completed'
  if (closed && (patch.name !== undefined || patch.date !== undefined || patch.wastePct !== undefined)) return fail('A completed pour keeps its plan. Only the notes can be edited.')
  if (patch.name !== undefined && clean(patch.name, 80).length < 2) return fail('Enter a name for the pour.')
  if (patch.date !== undefined && patch.date !== null && !isoDate(patch.date)) return fail('Enter a valid date.')
  if (patch.wastePct !== undefined && !okPct(patch.wastePct)) return fail('Waste / overage must be between 0 and 100 percent.')
  return ok(patchPour(s, pourId, (x) => {
    const date = patch.date === undefined ? x.date : patch.date
    return { ...x, ...(patch.name !== undefined ? { name: clean(patch.name, 80) } : {}), ...(patch.wastePct !== undefined ? { wastePct: patch.wastePct } : {}), ...(patch.notes !== undefined ? { notes: clean(patch.notes, 500) } : {}), date, status: closed ? x.status : date ? 'scheduled' : 'planned' }
  }))
}

export interface PourSelection {
  foundationId: string
  /** Which physical foundations (1..quantity). */
  units: number[]
  components: 'footing' | 'plinth' | 'both'
  /** Plinths to include. Absent = all of the foundation's plinths. */
  plinthIds?: string[]
}

/**
 * Adds components to an open pour. Selecting 6 of 18 footings adds exactly those 6. A component that is already poured, or already in another
 * open pour, is refused (so nothing is counted twice); one already in this pour is left as it is. If part of a component was poured before, only
 * the remaining volume is planned. Plinths can be planned before their footings are poured.
 */
export const addPourItems = (pourId: string, selections: PourSelection[]): Reducer => (s) => {
  const pour = pourOf(s, pourId)
  if (!pour) return fail('Pour not found.')
  if (!isOpen(pour)) return fail('Items can only be added to a planned or scheduled pour.')
  if (!Array.isArray(selections) || selections.length === 0) return fail('Select at least one foundation.')
  let items = itemsOf(s)
  let added = 0
  for (const sel of selections) {
    const f = s.foundations.find((x) => x.id === sel.foundationId)
    if (!f) return fail('Foundation not found.')
    if (projectOf(s, f.id) !== pour.projectId) return fail(`${f.number} belongs to a different project than this pour.`)
    if (f.archived) return fail(`${f.number} is archived.`)
    const qty = f.quantity ?? 1
    const units = [...new Set(sel.units ?? [])]
    if (units.length === 0) return fail(`Select which ${f.number} foundations are being poured.`)
    if (units.some((u) => !Number.isInteger(u) || u < 1 || u > qty)) return fail(`${f.number} has ${qty} foundation${qty === 1 ? '' : 's'}; choose numbers from 1 to ${qty}.`)
    if (!['footing', 'plinth', 'both'].includes(sel.components)) return fail('Choose Footings, Plinths or Both.')
    const conc = concreteOf(s, f)
    const plinths = s.plinths.filter((p) => p.foundationId === f.id && (!sel.plinthIds || sel.plinthIds.includes(p.id))).sort((a, b) => a.index - b.index)
    if (sel.plinthIds && sel.plinthIds.some((id) => !s.plinths.some((p) => p.id === id && p.foundationId === f.id))) return fail('A selected plinth does not belong to that foundation.')
    if ((sel.components === 'plinth' || sel.components === 'both') && plinths.length === 0 && !sel.plinthIds) return fail(`${f.number} has no plinths to pour.`)
    for (const unit of units.sort((a, b) => a - b)) {
      const wanted: { component: 'footing' | 'plinth'; plinthId: string | null }[] = [
        ...(sel.components !== 'plinth' ? [{ component: 'footing' as const, plinthId: null }] : []),
        ...(sel.components !== 'footing' ? plinths.map((p) => ({ component: 'plinth' as const, plinthId: p.id })) : []),
      ]
      for (const w of wanted) {
        const probe = { ...s, pourItems: items }
        if (items.some((i) => i.pourId === pourId && itemKey(i) === itemKey({ foundationId: f.id, unit, ...w }))) continue
        const info = componentInfo(probe, f.id, unit, w.plinthId)
        const label = `${f.number} #${unit} ${w.plinthId ? `plinth ${s.plinths.find((p) => p.id === w.plinthId)?.index}` : 'footing'}`
        if (info.state === 'completed') return fail(`${label} is already recorded as poured${info.completedDate ? ` on ${info.completedDate}` : ''}.`)
        if (info.state === 'planned') return fail(`${label} is already in the pour “${info.inPour?.name}”.`)
        const vol = componentVolume(conc, w.plinthId)
        const planned = vol === null ? null : round6(Math.max(0, vol - info.pouredM3))
        items = [...items, { id: `${pourId}:${f.id}:${unit}:${w.plinthId ?? 'footing'}`, pourId, foundationId: f.id, unit, component: w.component, plinthId: w.plinthId, plannedM3: planned, pouredM3: null, completedDate: null, overrideReason: '', overrideBy: '' }]
        added++
      }
    }
  }
  if (added === 0) return fail('Everything selected is already in this pour.')
  return ok({ ...s, pourItems: items })
}

/** Takes a component out of an open pour, as long as nothing has been recorded against it. */
export const removePourItem = (itemId: string): Reducer => (s) => {
  const i = itemsOf(s).find((x) => x.id === itemId)
  if (!i) return fail('That item is not in the pour.')
  const pour = pourOf(s, i.pourId)
  if (!pour || !isOpen(pour)) return fail('Items can only be removed from a planned or scheduled pour.')
  if (i.completedDate || i.pouredM3 !== null) return fail('Concrete has been recorded for this item, so it cannot be removed.')
  return ok({ ...s, pourItems: itemsOf(s).filter((x) => x.id !== itemId) })
}

export interface PourRecord { pouredM3: number | null; complete: boolean; date: string | null }

function record(s: ConstructionState, itemId: string, rec: PourRecord, today: string, override: { reason: string; by: string } | null): ReturnType<Reducer> {
  const i = itemsOf(s).find((x) => x.id === itemId)
  if (!i) return fail('That item is not in the pour.')
  const pour = pourOf(s, i.pourId)
  if (!pour || !isOpen(pour)) return fail('Concrete can only be recorded on a planned or scheduled pour.')
  if (i.completedDate) return fail('This component is already recorded as poured.')
  if (rec.pouredM3 !== null && !okM3(rec.pouredM3)) return fail('Enter the concrete poured in m³ (zero or more).')
  if (!rec.complete && rec.pouredM3 === null) return fail('Enter how much concrete was poured, or mark the component as completed.')
  let date: string | null = null
  if (rec.complete) {
    date = rec.date ?? today
    if (!isoDate(date) || date > today) return fail('Enter a valid completion date that is not in the future.')
    // Whole-component duplicate guard (also enforced by the database): a component is completed once, across every pour.
    if (componentInfo(s, i.foundationId, i.unit, i.plinthId).state === 'completed') return fail('This component is already recorded as poured in another pour.')
    if (i.component === 'plinth' && !footingDone(s, i.foundationId, i.unit)) {
      const f = s.foundations.find((x) => x.id === i.foundationId)
      if (!override) return fail(`The footing of ${f?.number} #${i.unit} is not recorded as poured yet, so its plinths cannot be marked completed. An administrator can override this with a reason.`)
    }
  }
  const keep = override && i.component === 'plinth' && rec.complete && !footingDone(s, i.foundationId, i.unit)
  const next: PourItem = { ...i, pouredM3: rec.pouredM3 === null ? i.pouredM3 : round6(rec.pouredM3), completedDate: rec.complete ? date : null, ...(keep ? { overrideReason: override!.reason, overrideBy: override!.by } : {}) }
  return ok({ ...s, pourItems: itemsOf(s).map((x) => (x.id === itemId ? next : x)) })
}

/**
 * Records concrete poured against a component. `pouredM3` is the total poured so far for that component (setting it again replaces, never adds,
 * so a repeated submit cannot double-count). Marking it `complete` closes the component; a lower figure without `complete` is a partial pour and the
 * rest stays remaining. A plinth cannot be completed until its footing is recorded as poured.
 */
export const recordPour = (itemId: string, rec: PourRecord, today: string): Reducer => (s) => record(s, itemId, rec, today, null)

/** Administrator override: completes a plinth before its footing, with a reason that is kept on the record. */
export const recordPourOverride = (itemId: string, rec: PourRecord, reason: string, today: string): Reducer => (s, ctx) => {
  const why = clean(reason, 300)
  if (why.length < 5) return fail('Enter the reason for completing this plinth before its footing (at least 5 characters).')
  return record(s, itemId, rec, today, { reason: why, by: ctx?.actor ?? '' })
}

/** Records the total concrete actually placed for the whole pour (what was delivered and used), m³. */
export const setPourActual = (pourId: string, actualM3: number | null): Reducer => (s) => {
  const p = pourOf(s, pourId)
  if (!p) return fail('Pour not found.')
  if (p.status === 'cancelled') return fail('A cancelled pour cannot be changed.')
  if (actualM3 !== null && !okM3(actualM3)) return fail('Enter the concrete placed in m³ (zero or more).')
  return ok(patchPour(s, pourId, (x) => ({ ...x, actualM3: actualM3 === null ? null : round6(actualM3) })))
}

/**
 * Closes a pour. Components with nothing recorded are released (they go back to "not yet poured" and can be planned again); components poured
 * only in part stay on this pour with what was placed, and their remaining volume is planned in a later pour. At least one component must
 * have concrete recorded.
 */
export const completePour = (pourId: string, date: string | null, today: string): Reducer => (s) => {
  const p = pourOf(s, pourId)
  if (!p) return fail('Pour not found.')
  if (!isOpen(p)) return fail('Only a planned or scheduled pour can be completed.')
  const d = date ?? today
  if (!isoDate(d) || d > today) return fail('Enter a valid completion date that is not in the future.')
  const mine = itemsOf(s).filter((i) => i.pourId === pourId)
  if (!mine.some((i) => i.completedDate || (i.pouredM3 ?? 0) > 0)) return fail('Nothing has been recorded as poured. Record the concrete first, or cancel the pour.')
  const release = new Set(mine.filter((i) => !i.completedDate && i.pouredM3 === null).map((i) => i.id))
  return ok(patchPour({ ...s, pourItems: itemsOf(s).filter((i) => !release.has(i.id)) }, pourId, (x) => ({ ...x, status: 'completed', completedDate: d })))
}

/** Cancels a pour that has no concrete recorded; its components are released. */
export const cancelPour = (pourId: string): Reducer => (s) => {
  const p = pourOf(s, pourId)
  if (!p) return fail('Pour not found.')
  if (!isOpen(p)) return fail('Only a planned or scheduled pour can be cancelled.')
  if (itemsOf(s).some((i) => i.pourId === pourId && (i.completedDate || i.pouredM3 !== null))) return fail('Concrete has been recorded on this pour. Complete it instead of cancelling.')
  return ok(patchPour({ ...s, pourItems: itemsOf(s).filter((i) => i.pourId !== pourId) }, pourId, (x) => ({ ...x, status: 'cancelled' })))
}
