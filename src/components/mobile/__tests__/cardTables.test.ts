import { describe, expect, it } from 'vitest'
import { isNumericColumn } from '../cardTables'

describe('table standard: numeric columns', () => {
  it('right-aligns columns of numbers, units, percentages and empty dashes', () => {
    expect(isNumericColumn(['20', '1,200', '—', '12 ea'])).toBe(true)
    expect(isNumericColumn(['72%', '5%'])).toBe(true)
    expect(isNumericColumn(['−3', '4.5 m³'])).toBe(true)
  })
  it('leaves text, mixed and empty columns alone', () => {
    expect(isNumericColumn(['E-House', '12'])).toBe(false)
    expect(isNumericColumn(['11-01', '12-02'])).toBe(false)
    expect(isNumericColumn(['—', '–'])).toBe(false)
    expect(isNumericColumn(['', ''])).toBe(false)
    expect(isNumericColumn(['Oct 29, 2026'])).toBe(false)
  })
})
