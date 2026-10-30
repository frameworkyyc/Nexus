import { useSyncExternalStore } from 'react'

interface Options<T> {
  key: string
  version: number
  seed: () => T
  /** Upgrade data saved by an older version instead of discarding the user's edits. */
  migrate?: (data: unknown, fromVersion: number) => T
}

export interface PersistedStore<T> {
  get: () => T
  set: (next: T) => void
  reset: () => void
  use: () => T
}

/**
 * Minimal browser-local store for the demo build. Swap for an API-backed
 * implementation later without changing consumers.
 */
export function createPersistedStore<T>({ key, version, seed, migrate }: Options<T>): PersistedStore<T> {
  const listeners = new Set<() => void>()

  function load(): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw) as { version: number; data: T }
        if (parsed.version === version) return parsed.data
        if (migrate && parsed.version < version) return migrate(parsed.data, parsed.version)
      }
    } catch {
      /* fall through to seed */
    }
    return seed()
  }

  let current = load()

  function set(next: T) {
    current = next
    try {
      localStorage.setItem(key, JSON.stringify({ version, data: next }))
    } catch {
      /* storage unavailable; keep in memory */
    }
    listeners.forEach((l) => l())
  }

  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }

  return {
    get: () => current,
    set,
    reset: () => set(seed()),
    use: () => useSyncExternalStore(subscribe, () => current),
  }
}

/**
 * An in-memory store with the same interface and nothing written to the browser. Used by the application (non-demo) bundle, which keeps
 * no operational records on this device: they live in the database. It only ever holds an empty "nothing loaded yet" value.
 */
export function createEphemeralStore<T>(seed: () => T): PersistedStore<T> {
  const listeners = new Set<() => void>()
  let current = seed()
  const set = (next: T) => { current = next; listeners.forEach((l) => l()) }
  const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
  return { get: () => current, set, reset: () => set(seed()), use: () => useSyncExternalStore(subscribe, () => current) }
}
