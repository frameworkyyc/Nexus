import { useCallback, useState } from 'react'

/**
 * A small remembered choice (a view mode, a sort): kept in this browser so it survives navigating between pages and reloads. Storage can be
 * blocked or empty (private windows), so every access is guarded and the default is used instead.
 */
export function readChoice<T extends string>(storage: Pick<Storage, 'getItem'> | undefined, key: string, allowed: readonly T[], fallback: T): T {
  try { const v = storage?.getItem(key); if (v && (allowed as readonly string[]).includes(v)) return v as T } catch { /* storage unavailable */ }
  return fallback
}

const store = (): Storage | undefined => { try { return window.localStorage } catch { return undefined } }

export function usePersistentChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readChoice(store(), key, allowed, fallback))
  const set = useCallback((v: T) => {
    setValue(v)
    try { store()?.setItem(key, v) } catch { /* storage unavailable */ }
  }, [key])
  return [value, set]
}
