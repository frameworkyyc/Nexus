import { parseISO } from './date'

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return parseISO(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100)
}
