export function formatDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Milestone proxy for the demo: active/planning projects targeting completion within the next 90 days. */
export function isWithinDays(iso: string, days: number, now = new Date()): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  const diff = (new Date(y, m - 1, d).getTime() - now.getTime()) / 86_400_000
  return diff >= 0 && diff <= days
}
