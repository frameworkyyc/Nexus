import { toCsv } from '../selectors'
import type { TrackerLine } from '../types'

/** Downloads the given rows as an Excel-compatible CSV. */
export function downloadMaterialsCsv(lines: TrackerLine[], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(lines)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
