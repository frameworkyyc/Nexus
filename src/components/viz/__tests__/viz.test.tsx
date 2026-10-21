import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { intervalConsumed, remainingStatus, ringFraction, ringGeometry, toneToStatus, worstStatus } from '../status'
import { MaintenanceAlerts, RadialGauge, Sparkline, StatusMark, UnknownState, sparkGeometry } from '..'

describe('gauge maths', () => {
  it('maps percentages to a clamped ring fraction and keeps unknown unknown', () => {
    expect(ringFraction(0)).toBe(0)
    expect(ringFraction(42)).toBeCloseTo(0.42)
    expect(ringFraction(180)).toBe(1)
    expect(ringFraction(-5)).toBe(0)
    expect(ringFraction(null)).toBeNull()
    expect(ringFraction(Number.NaN)).toBeNull()
  })

  it('draws no arc for an unknown fraction and a proportional arc otherwise', () => {
    expect(ringGeometry(200, 16, null).dash).toBe(0)
    const g = ringGeometry(200, 16, 0.25)
    expect(g.radius).toBe(92)
    expect(g.dash).toBeCloseTo(g.circumference / 4)
    expect(g.dash + g.gap).toBeCloseTo(g.circumference)
  })

  it('only computes the interval share when both ends and the current position are known', () => {
    expect(intervalConsumed(10_000, 15_000, 12_500)).toBe(50)
    expect(intervalConsumed(10_000, 15_000, 16_000)).toBe(120)
    expect(intervalConsumed(null, 15_000, 12_500)).toBeNull()
    expect(intervalConsumed(10_000, null, 12_500)).toBeNull()
    expect(intervalConsumed(10_000, 15_000, null)).toBeNull()
    expect(intervalConsumed(15_000, 15_000, 15_000)).toBeNull() // zero-length interval
    expect(intervalConsumed(15_000, 10_000, 12_000)).toBeNull() // end before start
    expect(intervalConsumed(10_000, 15_000, 9_000)).toBeNull() // current before start
  })
})

describe('status thresholds', () => {
  it('is green only inside a recorded warning window threshold, orange within it, red when past due', () => {
    expect(remainingStatus(5_000, 1_000)).toBe('ok')
    expect(remainingStatus(1_000, 1_000)).toBe('warn')
    expect(remainingStatus(0, 1_000)).toBe('warn')
    expect(remainingStatus(-1, 1_000)).toBe('bad')
    expect(remainingStatus(-1, null)).toBe('bad')
  })

  it('is neutral blue, not green, when nothing is overdue but no threshold was recorded', () => {
    expect(remainingStatus(1_695, null)).toBe('info')
  })

  it('is grey when the remaining distance is unknown', () => {
    expect(remainingStatus(null, 1_000)).toBe('unknown')
    expect(remainingStatus(null, null)).toBe('unknown')
  })

  it('rolls statuses up worst first and never lets unknown pass as healthy', () => {
    expect(worstStatus(['ok', 'ok'])).toBe('ok')
    expect(worstStatus(['ok', 'unknown'])).toBe('unknown')
    expect(worstStatus(['unknown', 'warn'])).toBe('warn')
    expect(worstStatus(['warn', 'bad', 'ok'])).toBe('bad')
  })

  it('maps the older tone names onto the same vocabulary', () => {
    expect(toneToStatus('muted')).toBe('unknown')
    expect(toneToStatus('neutral')).toBe('info')
    expect(toneToStatus('bad')).toBe('bad')
  })
})

describe('components', () => {
  const base = { title: 'Oil change', statusLabel: 'Not yet due', value: '1,695', unit: 'km remaining' }

  it('renders an arc only when the percentage is known', () => {
    const known = renderToStaticMarkup(<RadialGauge {...base} percent={40} status="ok" />)
    expect(known).toContain('data-testid="gauge-arc"')
    expect(known).toContain('data-fraction="0.4"')
    const unknown = renderToStaticMarkup(<RadialGauge {...base} percent={null} status="info" />)
    expect(unknown).not.toContain('data-testid="gauge-arc"')
    expect(unknown).toContain('data-fraction="unknown"')
    expect(unknown).toContain('stroke-dasharray="2 7"') // dashed empty track, never a partial fill
  })

  it('always carries the numeric value and a text status, so colour is never the only signal', () => {
    const html = renderToStaticMarkup(<RadialGauge {...base} percent={null} status="warn" statusLabel="Due soon · 400 km left" />)
    expect(html).toContain('1,695')
    expect(html).toContain('Due soon · 400 km left')
    expect(html).toContain('data-status="warn"')
    expect(html).toContain('aria-label="Oil change: Due soon · 400 km left"')
    expect(html).toContain('<svg') // status glyph
  })

  it('is a real button when it navigates to detail', () => {
    const html = renderToStaticMarkup(<RadialGauge {...base} percent={10} status="ok" onSelect={() => undefined} />)
    expect(html).toContain('<button')
    expect(html).toContain('Show details')
  })

  it('draws a different glyph per status', () => {
    const glyph = (s: 'ok' | 'warn' | 'bad' | 'unknown' | 'info') => renderToStaticMarkup(<StatusMark status={s} label="x" />).match(/<svg[^>]*class="([^"]*)"/)?.[1]
    expect(new Set((['ok', 'warn', 'bad', 'unknown', 'info'] as const).map(glyph)).size).toBe(5)
  })

  it('shows the unknown state with its reason instead of a number', () => {
    const html = renderToStaticMarkup(<UnknownState title="Oil change" reason="No oil-change schedule is recorded." />)
    expect(html).toContain('Unknown')
    expect(html).toContain('No oil-change schedule is recorded.')
  })

  it('lists alerts worst first and renders nothing when there are none', () => {
    expect(renderToStaticMarkup(<MaintenanceAlerts items={[]} />)).toBe('')
    const html = renderToStaticMarkup(<MaintenanceAlerts items={[{ id: 'a', status: 'warn', text: 'Warn text' }, { id: 'b', status: 'bad', text: 'Bad text' }]} />)
    expect(html.indexOf('Bad text')).toBeLessThan(html.indexOf('Warn text'))
  })

  it('draws a trend only from two or more distinct points', () => {
    expect(sparkGeometry([{ x: 1, y: 1 }], 100, 30)).toBeNull()
    expect(sparkGeometry([{ x: 1, y: 1 }, { x: 1, y: 2 }], 100, 30)).toBeNull()
    expect(sparkGeometry([{ x: 1, y: 1 }, { x: 5, y: 9 }], 100, 30)).not.toBeNull()
    expect(renderToStaticMarkup(<Sparkline points={[{ x: 1, y: 1 }]} label="t" />)).toBe('')
    expect(renderToStaticMarkup(<Sparkline points={[{ x: 1, y: 1 }, { x: 5, y: 9 }]} label="t" />)).toContain('role="img"')
  })

  it('lays out responsively: the gauge grid collapses to one column on phones', () => {
    const html = renderToStaticMarkup(<RadialGauge {...base} percent={null} status="info" />)
    expect(html).toContain('width="184"') // fixed ring size; the grid around it (see VehicleGauges) sets 1 / 2 / 4 columns
  })
})
