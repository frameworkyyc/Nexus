import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { anchoragesOn } from '../anchorageMounts'
import type { ComponentInput, FoundationConfig } from '../configActions'
import { emptyConstruction } from '../empty'
import { blankBolt, blankPlate, configFromDraft, draftFromFoundation, FoundationConfigFields, emptyMount, type ConfigDraft } from '../pages/FoundationConfigFields'
import { mountedAnchorageText } from '../pages/MountedAnchorage'
import type { ConstructionState, Dims, Foundation } from '../types'

function apply(s: ConstructionState, r: K.Reducer): ConstructionState { const o = r(s, {}); if (o.error !== undefined) throw new Error(o.error); return o.state }
const d = (length: number, width: number, height: number): Dims => ({ length, width, height, unit: 'm' })
const bolt = (qty: number): ComponentInput => ({ kind: 'bolt', qty, diameter: 'M30', length: 1200, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 2, washersPerBolt: 2 })

function world() {
  let s: ConstructionState = { ...emptyConstruction(), company: { id: '', name: '' } }
  s = apply(s, K.createOrganization({ name: 'Northline' }))
  s = apply(s, K.createProject({ name: 'P1' }))
  const pid = s.projects[0].id
  s = apply(s, K.createArea(pid, 'Mole Sieve', []))
  s = apply(s, K.addAnchorageType(pid, 'OP1-A11', ''))
  s = apply(s, K.addAnchorageType(pid, 'OP1-B2', ''))
  const [A11, B2] = s.anchorageTypes.map((t) => t.id)
  s = apply(s, K.setAnchorageComponents(A11, [bolt(12), { kind: 'template', qty: 1 }]))
  return { s, areaId: s.areas[0].id, A11, B2 }
}
const add = (s: ConstructionState, areaId: string, number: string, plinths: number | null, quantity: number, config: FoundationConfig) => {
  const next = apply(s, K.createFoundation(areaId, number, '', plinths, quantity, config))
  return { s: next, f: next.foundations.find((x) => x.number === number) as Foundation }
}
const draftOf = (s: ConstructionState, f: Foundation) => draftFromFoundation(f, s.plinths, (s.anchorageGroups ?? []).filter((g) => g.foundationId === f.id), s.foundationBolts ?? [], s.foundationEmbeds ?? [], s.foundationAnchorages)

describe('the setup form round-trips anchorage mounts', () => {
  it('a pad with anchorage and no plinths reads back as a footing-only foundation and saves to the same configuration', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'OP1-21-29', 0, 1, { footing: d(8.5, 3.5, 0.5), anchorages: [{ anchorageTypeId: w.A11, qty: 2 }] })
    const draft = draftOf(r.s, r.f)
    expect(draft).toMatchObject({ noPlinths: true, groups: [], anchorages: [{ typeId: w.A11, qty: '2' }] })
    const cfg = configFromDraft(draft)
    if ('error' in cfg) throw new Error(cfg.error)
    expect(cfg.config.groups).toEqual([])
    expect(cfg.config.anchorages).toEqual([{ id: r.s.foundationAnchorages![0].id, anchorageTypeId: w.A11, qty: 2, installMethod: 'wet-set' }])
    const again = apply(r.s, K.configureFoundation(r.f.id, cfg.config))
    expect(again.foundationAnchorages).toEqual(r.s.foundationAnchorages) // saving the unchanged form changes nothing
    expect(again.plinths).toEqual(r.s.plinths)
  })

  it('plinth sets carry their own anchorage groups, bolts and embed plates through the form', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'MX-1', null, 3, {
      footing: d(4, 4, 0.6), anchorages: [{ anchorageTypeId: w.B2, qty: 1 }],
      groups: [{ count: 2, dims: d(1, 1, 1), anchorages: [{ anchorageTypeId: w.A11, qty: 2 }, { anchorageTypeId: w.B2, qty: 1 }], bolts: [{ qty: 5, diameter: 'M16', length: 400, lengthUnit: 'mm', thread: 'all-thread', nutsPerBolt: 1, washersPerBolt: 1 }] }],
    })
    const draft = draftOf(r.s, r.f)
    expect(draft.groups).toHaveLength(1)
    expect(draft.groups[0].anchorages.map((a) => [a.typeId, a.qty])).toEqual([[w.A11, '2'], [w.B2, '1']])
    expect(draft.groups[0].bolts).toHaveLength(1)
    expect(draft.bolts).toHaveLength(0) // the plinth bolts are not shown on the footing
    const cfg = configFromDraft(draft)
    if ('error' in cfg) throw new Error(cfg.error)
    const again = apply(r.s, K.configureFoundation(r.f.id, cfg.config))
    expect(again.foundationAnchorages).toEqual(r.s.foundationAnchorages)
    expect(again.foundationBolts).toEqual(r.s.foundationBolts)
    expect(mountedAnchorageText(again, r.f.id, null)).toBe('OP1-B2')
    expect(mountedAnchorageText(again, r.f.id, again.anchorageGroups![0].id)).toBe('OP1-A11 × 2 · OP1-B2')
  })

  it('older data (no stored anchorage groups) shows each set’s type as one anchorage per plinth', () => {
    const w = world()
    const r = add(w.s, w.areaId, 'OLD', null, 2, { groups: [{ anchorageTypeId: w.A11, count: 3 }] })
    const legacy = { ...r.s, foundationAnchorages: undefined }
    expect(draftOf(legacy, r.f).groups[0].anchorages).toEqual([{ typeId: w.A11, qty: '1', installMethod: 'wet-set' }])
    expect(mountedAnchorageText(legacy, r.f.id, legacy.anchorageGroups![0].id)).toBe('OP1-A11')
    expect(anchoragesOn(r.s, r.f.id, r.s.anchorageGroups![0].id)).toHaveLength(1)
  })

  it('says what is wrong instead of saving: a group with no type, or a quantity that is not a whole number', () => {
    const base: ConfigDraft = { footing: { length: '', width: '', height: '', unit: 'm' }, plinthBase: 'above-footing', groups: [], ...emptyMount() }
    expect(configFromDraft({ ...base, anchorages: [{ typeId: '', qty: '1', installMethod: 'wet-set' as const }] })).toEqual({ error: 'Footing anchorage group 1: choose an anchorage type from the library.' })
    expect(configFromDraft({ ...base, anchorages: [{ typeId: 'x', qty: '1.5', installMethod: 'wet-set' as const }] })).toEqual({ error: 'Footing anchorage group 1: enter the number of anchorages (a whole number of 1 or more).' })
    expect(configFromDraft({ ...base, groups: [{ count: '2', dims: { length: '', width: '', height: '', unit: 'm' }, anchorages: [{ typeId: 'x', qty: '', installMethod: 'wet-set' as const }], bolts: [], embeds: [] }] })).toEqual({ error: 'Plinths 1 anchorage group 1: enter the number of anchorages (a whole number of 1 or more).' })
  })
})

describe('the setup form', () => {
  const html = (draft: ConfigDraft, quantity = 1) => {
    const w = world()
    return renderToStaticMarkup(<FoundationConfigFields draft={draft} onChange={() => undefined} types={w.s.anchorageTypes} components={w.s.anchorageComponents ?? []} quantity={quantity} preview={null} />)
  }
  const blank: ConfigDraft = { footing: { length: '', width: '', height: '', unit: 'mm' }, plinthBase: 'above-footing', groups: [], ...emptyMount() }

  it('has separate places for the footing and for plinths, each with anchorage groups, bolts and embed plates', () => {
    const out = html({ ...blank, groups: [{ count: '2', dims: { length: '', width: '', height: '', unit: 'mm' }, ...emptyMount() }] }, 4)
    expect(out).toContain('On the footing')
    expect(out).toContain('Nothing here creates plinths')
    expect(out).toContain('On each plinth of this set')
    expect(out.match(/Add anchorage group/g)).toHaveLength(2)
    expect(out.match(/Individual anchor bolts/g)).toHaveLength(2)
    expect(out.match(/Add embed plates/g)).toHaveLength(2)
    expect(out).toContain('8 in all') // 2 plinths × 4 foundations: the plinth quantity, separate from anchorage
  })

  it('offers "no plinths" when none are entered, and shows what an anchorage group adds up to', () => {
    const w = world()
    const draft: ConfigDraft = { ...blank, anchorages: [{ typeId: w.A11, qty: '2', installMethod: 'wet-set' as const }] }
    const out = renderToStaticMarkup(<FoundationConfigFields draft={draft} onChange={() => undefined} types={w.s.anchorageTypes} components={w.s.anchorageComponents ?? []} quantity={1} preview={null} />)
    expect(out).toContain('This foundation has no plinths')
    expect(out).toContain('24 anchor bolts')
    expect(out).toContain('48 nuts')
    expect(out).toContain('2 plywood templates')
    expect(out).toContain('the plinth count is not known yet')
  })
})

describe('the setup form: Post-Install checkbox', () => {
  it('offers a Post-Install checkbox on anchorage groups, individual bolts and embed plates, unchecked by default, and saves the choice', () => {
    const w = world()
    const blank: ConfigDraft = { footing: { length: '', width: '', height: '', unit: 'mm' }, plinthBase: 'above-footing', groups: [], ...emptyMount() }
    const draft: ConfigDraft = { ...blank, anchorages: [{ typeId: w.A11, qty: '2', installMethod: 'post-installed' }], bolts: [{ ...blankBolt(), diameter: '5/8"', length: '250', thread: 'all-thread', installMethod: 'post-installed' }] }
    const out = renderToStaticMarkup(<FoundationConfigFields draft={draft} onChange={() => undefined} types={w.s.anchorageTypes} components={w.s.anchorageComponents ?? []} quantity={1} preview={null} />)
    expect(out).toContain('Post-Install, Footing group 1') // the anchorage group's type (OP1-A11) contains bolts
    expect(out).toContain('Post-Install, bolts 1 (footing)') // the individual bolts
    expect(out).not.toContain('Wet-set')
    expect(out.match(/type="checkbox" aria-label="Post-Install[^>]*checked=""/g)!.length).toBe(2)
    const withEmbed = renderToStaticMarkup(<FoundationConfigFields draft={{ ...blank, embeds: [{ componentId: '', qty: '2', mode: 'per-foundation', plate: blankPlate(), save: 'foundation' }] }} onChange={() => undefined} types={w.s.anchorageTypes} components={w.s.anchorageComponents ?? []} quantity={1} preview={null} />)
    expect(withEmbed).toContain('Post-Install, embed plates 1 (footing)')
    expect(withEmbed).not.toMatch(/aria-label="Post-Install[^>]*checked=""/) // default: installed with the pour
    const cfg = configFromDraft(draft)
    if ('error' in cfg) throw new Error(cfg.error)
    expect(cfg.config.anchorages?.[0]).toMatchObject({ qty: 2, installMethod: 'post-installed' })
    expect(cfg.config.bolts?.[0]).toMatchObject({ installMethod: 'post-installed' })
    // Round trip: saving then reopening shows the same methods.
    const saved = apply(w.s, K.createFoundation(w.areaId, 'OP1-01-06', '', 0, 1, cfg.config))
    const f = saved.foundations.find((x) => x.number === 'OP1-01-06') as Foundation
    const again = draftOf(saved, f)
    expect(again.anchorages[0].installMethod).toBe('post-installed')
    expect(again.bolts[0].installMethod).toBe('post-installed')
    // An embed plate ticked Post-Install keeps the setting through save and reopen.
    const e = configFromDraft({ ...blank, embeds: [{ componentId: '', qty: '2', mode: 'per-foundation', plate: { ...blankPlate(), thickness: '16', width: '300', length: '300' }, save: 'foundation', installMethod: 'post-installed' }] })
    if ('error' in e) throw new Error(e.error)
    const withPlate = apply(w.s, K.createFoundation(w.areaId, 'OP1-01-07', '', 0, 1, e.config))
    expect(draftOf(withPlate, withPlate.foundations.find((x) => x.number === 'OP1-01-07') as Foundation).embeds[0].installMethod).toBe('post-installed')
  })

  it('does not offer Post-Install on an anchorage type that has no bolts or embed plates', () => {
    const w = world()
    const blank: ConfigDraft = { footing: { length: '', width: '', height: '', unit: 'mm' }, plinthBase: 'above-footing', groups: [], ...emptyMount() }
    const out = renderToStaticMarkup(<FoundationConfigFields draft={{ ...blank, anchorages: [{ typeId: w.B2, qty: '1', installMethod: 'wet-set' }] }} onChange={() => undefined} types={w.s.anchorageTypes} components={w.s.anchorageComponents ?? []} quantity={1} preview={null} />)
    expect(out).not.toContain('Post-Install')
  })
})
