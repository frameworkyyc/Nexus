import { describe, expect, it } from 'vitest'
import * as K from '../actions'
import { anchorageIssue, foundationAnchorageIssues } from '../anchorageStatus'
import { build, world } from './materialsFixtures'

describe('anchorage configuration warnings', () => {
  it('a fully configured type, and the foundations using it, have no warning', () => {
    const { c, D2, f1 } = world()
    expect(anchorageIssue(c, D2)).toBeNull()
    expect(foundationAnchorageIssues(c, f1)).toEqual([])
  })

  it('a type with no components is unconfigured and its foundations say which type is missing what', () => {
    const { c, D2, f1, f3, f2 } = world()
    const bare = build(c, K.setAnchorageComponents(D2, []))
    expect(anchorageIssue(bare, D2)).toBe('no components defined yet')
    expect(foundationAnchorageIssues(bare, f1)).toEqual(['OP1-D2: no components defined yet'])
    expect(foundationAnchorageIssues(bare, f3)).toEqual(['OP1-D2: no components defined yet']) // the configured D3 is not listed
    expect(foundationAnchorageIssues(bare, f2)).toEqual([])
  })

  it('an incomplete component (reusing the save validation) is reported, and completing it clears the warning', () => {
    const { c, D2, f1 } = world()
    // Stored data can predate today's rules: break a saved bolt directly.
    const broken = { ...c, anchorageComponents: (c.anchorageComponents ?? []).map((x) => (x.anchorageTypeId === D2 && x.kind === 'bolt' ? { ...x, length: null } : x)) }
    expect(anchorageIssue(broken, D2)).toMatch(/enter the total bolt length/)
    expect(foundationAnchorageIssues(broken, f1)[0]).toMatch(/^OP1-D2: component \d+: enter the total bolt length/)
    expect(foundationAnchorageIssues(c, f1)).toEqual([])
  })

  it('archived types and foundations without an anchorage type are not flagged', () => {
    const { c, D2, f1 } = world()
    const archived = (() => { const b = build(c, K.setAnchorageComponents(D2, [])); return { ...b, anchorageTypes: b.anchorageTypes.map((t) => (t.id === D2 ? { ...t, archived: true } : t)) } })()
    expect(foundationAnchorageIssues(archived, f1)).toEqual([])
    expect(foundationAnchorageIssues(c, 'nope')).toEqual([])
  })
})
