import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { intervalConsumed, remainingStatus, ringFraction, ringGeometry, toneToStatus, worstStatus } from '../status'
import { MemoryRouter } from 'react-router-dom'
import { Donut } from '@/components/ui/Donut'
import { MaintenanceAlerts, RadialGauge, RING_SIZE, Ring, RingValue, ringStroke, Sparkline, StatusMark, UnknownState, sparkGeometry } from '..'

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
  const base = { title: 'Oil Change', statusLabel: 'Not yet due', value: '33.9%', unit: '1,695 km remaining' }

  it('draws a smooth arc only when the percentage is known', () => {
    const known = renderToStaticMarkup(<RadialGauge {...base} percent={40} status="ok" />)
    expect(known).toContain('data-testid="gauge-arc"')
    expect(known).toContain('data-fraction="0.4"')
    const unknown = renderToStaticMarkup(<RadialGauge {...base} percent={null} status="unknown" />)
    expect(unknown).not.toContain('data-testid="gauge-arc"')
    expect(unknown).toContain('data-fraction="none"')
  })

  it('is always one smooth circle: no dashed, dotted or segmented stroke anywhere', () => {
    const variants = [
      renderToStaticMarkup(<RadialGauge {...base} percent={40} status="ok" />),
      renderToStaticMarkup(<RadialGauge {...base} percent={null} status="unknown" />),
      renderToStaticMarkup(<RadialGauge {...base} percent={null} status="warn" />), // status-only
      renderToStaticMarkup(<Donut value={55} label="Materials" />),
      renderToStaticMarkup(<Donut value={null} label="Survey" />),
    ]
    for (const html of variants) {
      expect(html).not.toMatch(/stroke-dasharray="[^"]*\s[^"]*"[^>]*data-testid="gauge-track"/) // the track is never dashed
      expect(html).not.toContain('2 7')
      expect(html).not.toContain('2 6')
      const ring = html.match(/<svg[^>]*data-testid="gauge-ring".*?<\/svg>/)![0]
      expect((ring.match(/<circle/g) ?? []).length).toBeLessThanOrEqual(2) // one track + at most one arc
    }
  })

  it('starts at 12 o’clock and runs clockwise', () => {
    const html = renderToStaticMarkup(<RadialGauge {...base} percent={25} status="ok" />)
    expect(html).toMatch(/transform="rotate\(-90 88 88\)"/) // 176px ring: the circle path starts at 3 o'clock; −90° moves it to 12
    const g = ringGeometry(176, ringStroke(176), 0.25)
    expect(html).toContain(`stroke-dasharray="${g.dash} ${g.circumference}"`) // one dash then a gap ≥ circumference: draws forward (clockwise) only
  })

  it('uses the same size, stroke and track for every ring in Nexus (Fleet and Construction)', () => {
    const fleet = renderToStaticMarkup(<RadialGauge {...base} percent={30} status="info" />)
    const construction = renderToStaticMarkup(<Donut value={30} label="Installation" />)
    for (const html of [fleet, construction]) {
      expect(html).toContain(`data-size="${RING_SIZE}"`)
      expect(html).toContain(`stroke-width="${ringStroke(RING_SIZE)}"`)
      expect(html).toContain('stroke="var(--nx-track)"')
    }
    expect(ringStroke(RING_SIZE)).toBe(11)
  })

  it('uses a clean grey track for unknown values and a lightly tinted track for status-only gauges', () => {
    const unknown = renderToStaticMarkup(<RadialGauge {...base} percent={null} status="unknown" />)
    expect(unknown).toContain('stroke="var(--nx-track)"')
    const statusOnly = renderToStaticMarkup(<RadialGauge {...base} percent={null} status="bad" />)
    expect(statusOnly).toContain('stroke="var(--nx-bad)"')
    expect(statusOnly).toContain('stroke-opacity="0.28"')
    expect(statusOnly).not.toContain('data-testid="gauge-arc"')
  })

  it('shows the semantic colour for the status', () => {
    expect(renderToStaticMarkup(<RadialGauge {...base} percent={40} status="warn" />)).toContain('stroke="var(--nx-warn)"')
    expect(renderToStaticMarkup(<RadialGauge {...base} percent={40} status="ok" />)).toContain('stroke="var(--nx-ok)"')
    expect(renderToStaticMarkup(<Donut value={40} label="Materials" />)).toContain('stroke="var(--nx-info)"') // plain progress is neutral blue, never red
  })

  it('always carries the numeric value and a text status, so colour is never the only signal', () => {
    const html = renderToStaticMarkup(<RadialGauge {...base} percent={33.9} status="warn" statusLabel="Due soon" />)
    expect(html).toContain('33.9%')
    expect(html).toContain('1,695 km remaining')
    expect(html).toContain('Due soon')
    expect(html).toContain('data-status="warn"')
    expect(html).toContain('aria-label="Oil Change: Due soon, 33.9%"')
    expect(html).toContain('<svg') // status glyph
  })

  it('is a real button when it navigates to detail, and a link when given a route', () => {
    expect(renderToStaticMarkup(<RadialGauge {...base} percent={10} status="ok" onSelect={() => undefined} />)).toContain('<button')
    const linked = renderToStaticMarkup(<MemoryRouter><RadialGauge {...base} percent={10} status="ok" to="/fleet/veh-T6010" /></MemoryRouter>)
    expect(linked).toContain('href="/fleet/veh-T6010"')
  })

  it('draws a different glyph per status', () => {
    const glyph = (s: 'ok' | 'warn' | 'bad' | 'unknown' | 'info') => renderToStaticMarkup(<StatusMark status={s} label="x" />).match(/<svg[^>]*class="([^"]*)"/)?.[1]
    expect(new Set((['ok', 'warn', 'bad', 'unknown', 'info'] as const).map(glyph)).size).toBe(5)
  })

  it('keeps Donut working for plain progress and "Not tracked"', () => {
    expect(renderToStaticMarkup(<Donut value={62} label="Materials" />)).toContain('aria-label="Materials: 62%"')
    const none = renderToStaticMarkup(<Donut value={null} label="Survey" />)
    expect(none).toContain('Not tracked')
    expect(none).not.toContain('data-testid="gauge-arc"')
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

  it('scales its typography from the ring size, so large and small gauges stay proportional', () => {
    expect(renderToStaticMarkup(<Ring percent={50} status="ok" size={200}><RingValue value="x" size={200} /></Ring>)).toContain('font-size:40px')
    expect(renderToStaticMarkup(<Ring percent={50} status="ok" size={100}><RingValue value="x" size={100} /></Ring>)).toContain('font-size:20px')
  })
})
