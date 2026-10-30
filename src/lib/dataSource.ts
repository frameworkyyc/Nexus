import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useToast } from '@/components/ui/Toast'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { api, ApiError } from './api'
import { commandOf } from './commandTag'
import { todayISO } from './date'
import type { PersistedStore } from './createPersistedStore'
import type { Role } from '@/shared/rbac'
import type { ModuleName } from '@/shared/registry'

/* ── Which data the app is showing ──────────────────────────────────────── */

/**
 * server  — saved records, read from and written to the server database.
 * demo    — fictional demonstration data kept in this browser only (also the fallback when no server is configured).
 * blocked — a server exists but this browser is not signed in (or its sign-in expired).
 */
export type Mode = 'checking' | 'server' | 'demo' | 'blocked'
export interface BackendState { mode: Mode; serverAvailable: boolean; environment?: string; user?: string; /** Role the server has on record for this user (display only: the server re-checks every change). */ role?: Role | null; schemaVersion?: string; reason?: string }

let backend: BackendState = { mode: 'checking', serverAvailable: false }
const backendListeners = new Set<() => void>()
const setBackend = (next: BackendState) => { backend = next; backendListeners.forEach((l) => l()) }
export const getBackend = () => backend
const subscribeBackend = (l: () => void) => { backendListeners.add(l); return () => backendListeners.delete(l) }
export const useBackend = () => useSyncExternalStore(subscribeBackend, getBackend)
export const useIsServer = () => useBackend().mode === 'server'

const VIEW_KEY = 'nexus.view'
const viewDemo = () => { try { return sessionStorage.getItem(VIEW_KEY) === 'demo' } catch { return false } }
export function setViewDemo(on: boolean) {
  try { if (on) sessionStorage.setItem(VIEW_KEY, 'demo'); else sessionStorage.removeItem(VIEW_KEY) } catch { /* ignore */ }
  setBackend({ ...backend, mode: on ? 'demo' : backend.serverAvailable ? 'server' : 'demo' })
}

const stores: ModuleStore<never>[] = []

/**
 * Records from other modules that a module's rules check against (for example: the project's areas when adding a material). Used when
 * the rules run in this browser; with saved data the server reads the same records from its own database.
 */
const contexts = new Map<ModuleName, () => Record<string, unknown>>()
export const setModuleContext = (module: ModuleName, provider: () => Record<string, unknown>) => { contexts.set(module, provider) }

/** Decides the mode once at start-up, then loads the saved records. Never falls back to demo data silently while signed out. */
export async function startBackend(): Promise<void> {
  if (IS_PUBLIC_DEMO) { setBackend({ mode: 'demo', serverAvailable: false, reason: 'Public demo: sample data is kept in this browser only.' }); return }
  setBackend({ mode: 'checking', serverAvailable: false })
  const health = await api<{ database?: boolean; access?: boolean; environment?: string }>('GET', '/api/health').catch(() => null)
  if (!health || !health.database || !health.access) {
    setBackend({ mode: 'demo', serverAvailable: false, reason: !health ? 'No server is attached to this app (local development).' : !health.database ? 'The database is not connected.' : 'Access control is not configured, so saved data is switched off.' })
    return
  }
  try {
    const s = await api<{ user: string; role: Role | null; environment: string; schemaVersion: string }>('GET', '/api/session')
    setBackend({ mode: viewDemo() ? 'demo' : 'server', serverAvailable: true, environment: s.environment, user: s.user, role: s.role ?? null, schemaVersion: s.schemaVersion })
    if (!viewDemo()) await Promise.all(stores.map((m) => m.load()))
  } catch (e) {
    if (e instanceof ApiError && e.authRequired) setBackend({ mode: 'blocked', serverAvailable: true, reason: e.message })
    else setBackend({ mode: 'blocked', serverAvailable: true, reason: e instanceof Error ? e.message : 'The server could not be reached.' })
  }
}

/** Reload every module's saved records (after switching from demonstration data, or when the tab regains focus). */
export async function reloadAll() { await Promise.all(stores.map((m) => m.load())) }

/* ── Save status shown to the user ──────────────────────────────────────── */

export interface SyncStatus { pending: number; lastSavedAt: number | null; error: string | null }
let sync: SyncStatus = { pending: 0, lastSavedAt: null, error: null }
const syncListeners = new Set<() => void>()
const setSync = (patch: Partial<SyncStatus>) => { sync = { ...sync, ...patch }; syncListeners.forEach((l) => l()) }
export const useSyncStatus = () => useSyncExternalStore((l) => { syncListeners.add(l); return () => syncListeners.delete(l) }, () => sync)
export const clearSyncError = () => setSync({ error: null })

/* ── One module's records, from the server or from this browser ─────────── */

export interface ModuleStore<S> {
  get(): S
  use(): S
  load(): Promise<void>
  /** Applies a tagged reducer. Resolves to an error message, or null once the change is saved (server) or applied (demo). */
  run(reducer: (s: S) => { state?: S; error?: string }): Promise<string | null>
  /** Latest server version seen, for staleness checks. */
  version(): number
}

type Reducer<S> = (s: S, ctx?: Record<string, unknown>) => { state?: S; error?: string }

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9_-]/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createModuleStore<S>(module: ModuleName, local: PersistedStore<S>, emptyRemote: () => S, notify: (msg: string) => void = () => {}): ModuleStore<S> {
  let remote: S | null = null
  let version = 0
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const subscribe = (l: () => void) => { listeners.add(l); const off = subscribeBackend(l); return () => { listeners.delete(l); off() } }
  const isServer = () => backend.mode === 'server'
  // Only demonstration mode ever shows the browser copy. While checking or signed out, show saved records (or nothing), never the demo seed.
  const snapshot = (): S => (backend.mode === 'demo' ? local.get() : remote ?? emptyRemote())

  // Commands run one at a time so each is checked against the records the previous one produced.
  let tail: Promise<unknown> = Promise.resolve()
  const inFlight = new Map<string, Promise<string | null>>()
  // A request whose outcome is unknown (connection lost) is retried with the same id, so it can never be applied twice.
  const unknownOutcome = new Map<string, string>()

  const store: ModuleStore<S> = {
    get: snapshot,
    use() {
      const l = local.use()
      const r = useSyncExternalStore(subscribe, () => remote)
      // The snapshot also depends on the data mode (checking → demo/server). Without this a component rendered before the mode was
      // known (the top bar, outside DataGate) kept the empty "checking" snapshot, which is why breadcrumbs showed "Project" / "Vehicle".
      const m = useBackend()
      void l; void r; void m
      return snapshot()
    },
    version: () => version,
    async load() {
      const r = await api<{ version: number; state: S }>('GET', `/api/state/${module}`)
      remote = r.state; version = r.version; emit()
    },
    run(reducer: Reducer<S>) {
      if (!isServer()) {
        const result = reducer(local.get(), contexts.get(module)?.())
        if (result.error !== undefined) { notify(result.error); return Promise.resolve(result.error) }
        local.set(result.state as S)
        return Promise.resolve(null)
      }
      const meta = commandOf(reducer)
      if (!meta || meta.module !== module) {
        const msg = 'This action is not available with saved data yet.'
        notify(msg)
        return Promise.resolve(msg)
      }
      const key = JSON.stringify([meta.name, meta.args])
      const existing = inFlight.get(key)
      if (existing) return existing // a double click is the same request
      const promise = (tail = tail.then(() => send(meta, key))) as Promise<string | null>
      inFlight.set(key, promise)
      void promise.finally(() => inFlight.delete(key))
      return promise
    },
  }

  async function send(meta: { name: string; args: unknown[] }, key: string): Promise<string | null> {
    const requestId = unknownOutcome.get(key) ?? newId()
    setSync({ pending: sync.pending + 1, error: null })
    try {
      let lastError: ApiError | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await api<{ version: number; state: S; noop?: string; importedAt?: string }>('POST', '/api/commands', { module, name: meta.name, args: meta.args, requestId, clientToday: todayISO() })
          remote = res.state; version = res.version
          unknownOutcome.delete(key)
          emit()
          setSync({ lastSavedAt: Date.now(), error: null })
          if (res.noop === 'already-imported') notify(`This exact file was already imported${res.importedAt ? ` on ${res.importedAt.slice(0, 10)}` : ''}. Nothing was changed.`)
          return null
        } catch (e) {
          if (!(e instanceof ApiError)) throw e
          lastError = e
          if (e.authRequired) { setBackend({ ...backend, mode: 'blocked', reason: e.message }); break }
          if (!e.outcomeUnknown) { unknownOutcome.delete(key); notify(e.message); return e.message } // the server refused it: definitively not saved
          if (attempt < 2) await sleep(500 * 3 ** attempt)
        }
      }
      const e = lastError!
      if (!e.authRequired) unknownOutcome.set(key, requestId)
      const msg = e.authRequired ? e.message : `Not saved: ${e.message} Your entry is still on screen — try again.`
      setSync({ error: msg })
      notify(msg)
      return msg
    } finally { setSync({ pending: Math.max(0, sync.pending - 1) }) }
  }

  stores.push(store as unknown as ModuleStore<never>)
  return store
}

/**
 * Wraps a module's run function for buttons and forms: tracks "saving" so a form can disable itself, and calls `onDone`
 * only after the change is confirmed. A form that fails to save stays open with its input intact.
 */
export function useSaver<S>(store: ModuleStore<S>) {
  const [saving, setSaving] = useState(false)
  const alive = useRef(true)
  const toast = useToast()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const run = useCallback((reducer: Reducer<S>, onDone?: () => void) => {
    setSaving(true)
    store.run(reducer).then((err) => { if (err === null) onDone?.() }).catch((e) => toast(e instanceof Error ? e.message : 'Not saved.')).finally(() => { if (alive.current) setSaving(false) })
  }, [store, toast])
  return { run, saving }
}
