import { describe, expect, it } from 'vitest'
import { pct, percentOf } from '../format'

describe('percentOf: a percentage never overstates', () => {
  it('the reported case: 5,577 of 5,598 ordered is 99.6%, not 100%', () => {
    expect(percentOf(5577, 5598)).toBe(99.6)
    expect(pct(5577, 5598)).toBe(99.6)
  })

  it('100 only when done has reached the total', () => {
    expect(percentOf(5598, 5598)).toBe(100)
    expect(percentOf(1, 1)).toBe(100)
    for (const [done, of] of [[995, 1000], [999, 1000], [9999, 10000], [99999, 100000], [19999, 20000], [5597, 5598]]) expect(percentOf(done, of), `${done}/${of}`).toBeLessThan(100)
  })

  it('shows enough decimals that an incomplete figure never rounds up to 100', () => {
    expect(percentOf(995, 1000)).toBe(99.5)
    expect(percentOf(999, 1000)).toBe(99.9)
    expect(percentOf(9999, 10000)).toBe(99.99) // 99.99% exactly
    expect(percentOf(99999, 100000)).toBe(99.99) // 99.999% still shows as incomplete
    expect(percentOf(499, 500)).toBe(99.8)
  })

  it('whole percent is unchanged everywhere it was already right', () => {
    expect(percentOf(1, 2)).toBe(50)
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(2, 3)).toBe(67)
    expect(percentOf(994, 1000)).toBe(99) // 99.4% rounds to 99, which is not 100
    expect(percentOf(7, 200)).toBe(4) // 3.5% rounds to 4 as before
  })

  it('0 only when nothing is done; a little progress never reads 0%', () => {
    expect(percentOf(0, 100)).toBe(0)
    expect(percentOf(1, 1000)).toBe(0.1)
    expect(percentOf(1, 10000)).toBe(0.01)
    expect(percentOf(1, 100000)).toBe(0.01)
    expect(percentOf(3, 1000)).toBe(0.3)
  })

  it('zero or invalid requirements have no percentage; over-completion is capped at 100', () => {
    expect(percentOf(0, 0)).toBeNull()
    expect(percentOf(5, 0)).toBeNull()
    expect(percentOf(5, -1)).toBeNull()
    expect(percentOf(Number.NaN, 10)).toBeNull()
    expect(percentOf(10, Number.POSITIVE_INFINITY)).toBeNull()
    expect(percentOf(120, 100)).toBe(100)
    expect(percentOf(-3, 100)).toBe(0)
    expect(pct(0, 0)).toBe(0) // callers that need a number get 0 for "nothing to measure"
  })

  it('is consistent with the counts it comes from: never above the true ratio unless rounding to a whole number below 100', () => {
    for (let of = 1; of <= 300; of++) {
      for (let done = 0; done <= of; done++) {
        const p = percentOf(done, of)!
        expect(p === 100, `${done}/${of}`).toBe(done === of)
        expect(p === 0, `${done}/${of}`).toBe(done === 0)
        expect(Math.abs(p - (done / of) * 100), `${done}/${of}`).toBeLessThanOrEqual(0.5)
      }
    }
  })
})
