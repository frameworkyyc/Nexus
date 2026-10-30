/**
 * Supplier directory rules, shared by the browser and the server. A supplier's identity is its normalised name, so capitalisation,
 * spacing, punctuation, a trailing legal suffix ("Inc.", "Ltd") or a one-letter slip cannot create a second entry.
 */
export interface SupplierRecord { id: string; name: string; archived?: boolean; createdAt?: string; createdBy?: string }

const SUFFIX = /\b(incorporated|inc|ltd|limited|corp|corporation|co|company|llc|lp|ulc)\b/g

export const supplierKey = (name: string) =>
  name.toLowerCase().replace(/&/g, ' and ').replace(SUFFIX, ' ').replace(/[^a-z0-9]+/g, '')

export const supplierId = (name: string) => `sup-${supplierKey(name)}`

function distance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 1) return 2
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** An existing supplier the proposed name would duplicate: same normalised name, or one character apart for names of 6+ characters. */
export function findSimilarSupplier(list: SupplierRecord[], name: string): SupplierRecord | undefined {
  const k = supplierKey(name)
  if (!k) return undefined
  return list.find((s) => { const o = supplierKey(s.name); return o === k || (k.length >= 6 && o.length >= 6 && distance(o, k) <= 1) })
}

export const cleanSupplierName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
