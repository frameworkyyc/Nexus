import { useSyncExternalStore } from 'react'
import { identity } from '@/app/identity'
import { can, isRole, type Permission, type Role } from '@/shared/rbac'
import { useBackend } from './dataSource'

/**
 * What the current user may do, for deciding which controls to show.
 *
 * With saved data the role comes from the server, which re-checks it on every change — hiding a button here is a courtesy, never
 * the protection. In the browser-only demo there is no sign-in and no server, so the role is a labelled SIMULATION chosen by the
 * visitor: it changes what this page shows and grants access to nothing.
 */
const KEY = `${identity.storageKeys.tracker}.simulatedRole`
const listeners = new Set<() => void>()
let simulated: Role = (() => { try { const v = localStorage.getItem(KEY); return isRole(v) ? v : 'admin' } catch { return 'admin' } })()
export const setSimulatedRole = (r: Role) => {
  simulated = r
  try { localStorage.setItem(KEY, r) } catch { /* in-memory only */ }
  listeners.forEach((l) => l())
}
const useSimulated = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => simulated)

export interface Access { role: Role | null; simulated: boolean; user?: string; can: (p: Permission) => boolean }

export function useAccess(): Access {
  const b = useBackend()
  const sim = useSimulated()
  if (b.mode === 'server') return { role: b.role ?? null, simulated: false, user: b.user, can: (p) => can(b.role, p) }
  if (b.mode === 'demo') return { role: sim, simulated: true, can: (p) => can(sim, p) }
  return { role: null, simulated: false, can: () => false }
}
