/**
 * One semantic status vocabulary for the whole product. Colour is never the only signal: every status also has a glyph and a
 * text label (see StatusMark).
 *
 *   ok       green   confirmed healthy / within a recorded threshold
 *   warn     orange  approaching a threshold / needs attention soon
 *   bad      red     overdue / critical
 *   unknown  grey    not enough recorded data to say
 *   info     blue    neutral information (no judgement implied)
 *
 * Incomplete progress is NOT a status: a low completion percentage is `info` unless it is behind a recorded schedule or target.
 */
export type Status = 'ok' | 'warn' | 'bad' | 'unknown' | 'info'

/** CSS custom properties defined in index.css (with dark-safe, AA-contrast values for text on the canvas). */
export const STATUS_COLOR: Record<Status, string> = {
  ok: 'var(--nx-ok)',
  warn: 'var(--nx-warn)',
  bad: 'var(--nx-bad)',
  unknown: 'var(--nx-unknown)',
  info: 'var(--nx-info)',
}

/** Existing `Tone` names map onto the same vocabulary so older badges and new gauges always agree. */
export const toneToStatus = (tone: 'neutral' | 'info' | 'ok' | 'warn' | 'bad' | 'muted'): Status =>
  tone === 'muted' ? 'unknown' : tone === 'neutral' ? 'info' : tone

/** Worst status first; used to roll several indicators up to one. `unknown` outranks `ok` (we cannot call something healthy that is partly unknown) but not a recorded problem. */
const RANK: Record<Status, number> = { bad: 4, warn: 3, unknown: 2, info: 1, ok: 0 }
export const worstStatus = (statuses: Status[]): Status => statuses.reduce<Status>((w, s) => (RANK[s] > RANK[w] ? s : w), 'ok')

/* ── Gauge geometry ────────────────────────────────────────────────────── */

/** A 0–100 percentage → a 0–1 ring fraction, clamped. null (unknown) stays null: an unknown value never gets a filled arc. */
export function ringFraction(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null
  return Math.min(1, Math.max(0, percent / 100))
}

export interface RingGeometry { radius: number; circumference: number; dash: number; gap: number }

export function ringGeometry(size: number, stroke: number, fraction: number | null): RingGeometry {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = fraction === null ? 0 : fraction * circumference
  return { radius, circumference, dash, gap: circumference - dash }
}

/**
 * Status for "distance (or time) remaining before something falls due".
 * - remaining unknown → unknown
 * - past due → bad
 * - inside a recorded warning window → warn
 * - outside a recorded warning window → ok (the threshold supports calling it healthy)
 * - no warning window recorded → info: not yet due, but there is no threshold to say more than that
 */
export function remainingStatus(remaining: number | null, warnWithin: number | null): Status {
  if (remaining === null) return 'unknown'
  if (remaining < 0) return 'bad'
  if (warnWithin === null) return 'info'
  return remaining <= warnWithin ? 'warn' : 'ok'
}

/** Share of an interval used, in percent. Requires both ends of the interval and a current position; otherwise null (never estimated). */
export function intervalConsumed(start: number | null, end: number | null, current: number | null): number | null {
  if (start === null || end === null || current === null) return null
  if (!(end > start) || current < start) return null
  return ((current - start) / (end - start)) * 100
}
