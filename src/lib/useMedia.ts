import { useSyncExternalStore } from 'react'

/** Must match the `phone` variant in index.css. */
export const PHONE_QUERY = '(max-width: 767.98px), (max-height: 500px) and (pointer: coarse)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const m = window.matchMedia(query)
      m.addEventListener('change', notify)
      return () => m.removeEventListener('change', notify)
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches),
    () => false,
  )
}

/** True on phones (portrait and landscape). Use it to choose a different structure (cards instead of a table); use `phone:` classes for pure styling. */
export const useIsPhone = () => useMediaQuery(PHONE_QUERY)
