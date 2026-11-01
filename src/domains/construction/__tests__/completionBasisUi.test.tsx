import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { completionOf, type BasisResult } from '../completionBasis'
import { BasisFigures, CompletionBasisSelector, percentText } from '../pages/CompletionBasis'

const result = (over: Partial<BasisResult>): BasisResult => ({ basis: 'volume', percent: 33, done: 20, total: 60, unit: 'm³', missing: null, ...over })

describe('completion basis selector', () => {
  const html = renderToStaticMarkup(<CompletionBasisSelector />)

  it('offers the three bases, with the existing calculation selected by default', () => {
    expect(html).toContain('Completion basis')
    for (const label of ['Foundation type', 'Foundation count', 'Concrete volume']) expect(html).toContain(label)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="sm:hidden">Type/)
    expect(html).toContain('Each foundation type counts equally')
  })

  it('is responsive: short names on a phone, full names from sm up, three equal columns', () => {
    expect(html).toContain('grid w-full grid-cols-3')
    expect(html).toContain('sm:inline-grid sm:w-auto')
    expect(html).toContain('<span class="sm:hidden">Volume</span><span class="hidden sm:inline">Concrete volume</span>')
    expect(html).toContain('phone:h-11') // touch-sized on a phone
  })
})

describe('basis figures', () => {
  it('names the basis and shows the completed and total values next to the percentage', () => {
    const out = renderToStaticMarkup(<BasisFigures result={result({})} />)
    expect(out).toContain('Concrete volume · 20.0 of 60.0 m³')
    expect(out).not.toContain('role="note"')
  })

  it('states missing volumes instead of hiding them', () => {
    const out = renderToStaticMarkup(<BasisFigures result={result({ missing: { elements: 2, of: 5, foundations: ['U-1'], knownM3: 60 } })} />)
    expect(out).toContain('role="note"')
    expect(out).toContain('not entered for 2 of 5 footings and plinths (U-1)')
  })

  it('shows a dash, not 0%, when there is no figure', () => {
    expect(percentText(result({ percent: null }))).toBe('—')
    expect(percentText(result({ percent: 0 }))).toBe('0')
  })

  it('works on an empty list of foundations', () => {
    const r = completionOf({ state: { foundations: [] } } as never, [], 'count')
    expect(r).toMatchObject({ percent: null, total: 0 })
  })
})
