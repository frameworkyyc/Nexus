import { parseISO } from './date'

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

/**
 * A completion percentage that never overstates. Whole percent normally, but: 100 only when `done` has reached `of`, and 0 only when nothing is done.
 * An incomplete ratio that would round to 100 shows its decimals instead (99.6, 99.9, or 99.99 when even that would round up); one that would round to 0
 * does the same (0.3, 0.04). Over-completion (done > of) is 100. null when there is nothing to measure against (`of` is 0 or not a number).
 */
export function percentOf(done: number, of: number): number | null {
  if (!Number.isFinite(done) || !Number.isFinite(of) || of <= 0) return null
  if (done >= of) return 100
  if (done <= 0) return 0
  const r = (done / of) * 100
  const whole = Math.round(r)
  if (whole > 0 && whole < 100) return whole
  if (whole >= 100) {
    const one = Math.round(r * 10) / 10
    return one < 100 ? one : Math.min(99.99, Math.floor(r * 100) / 100)
  }
  const one = Math.round(r * 10) / 10
  return one > 0 ? one : Math.max(0.01, Math.round(r * 100) / 100)
}

/** `percentOf` for places that need a number: 0 when there is nothing to measure against. */
export function pct(done: number, total: number): number {
  return percentOf(done, total) ?? 0
}
