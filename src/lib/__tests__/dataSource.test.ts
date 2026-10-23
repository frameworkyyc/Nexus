import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistedStore } from '../createPersistedStore'
import { tagModule } from '../commandTag'
import { createModuleStore, getBackend, startBackend } from '../dataSource'

/** A tiny module with one counter, so the store's save behaviour can be tested without any real domain. */
interface S { items: string[] }
type R = (s: S) => { state?: S; error?: string }
const actions = tagModule('fleet', {
  add: (name: string): R => (s) => (name === 'bad' ? { error: 'Not allowed.' } : { state: { items: [...s.items, name] } }),
})
const plain = (name: string): R => (s) => ({ state: { items: [...s.items, name] } })

interface Call { url: string; body?: { requestId: string; name: string; args: unknown[] } }
let calls: Call[]
let respond: (call: Call) => Promise<Response> | Response
let server: S

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  calls = []
  server = { items: [] }
  respond = (c) => {
    if (c.url === '/api/health') return json({ ok: true, database: true, access: true, environment: 'test' })
    if (c.url === '/api/session') return json({ ok: true, user: 'me@example.com', environment: 'test', schemaVersion: '2', versions: {} })
    if (c.url === '/api/state/fleet') return json({ version: 1, state: server })
    if (c.url === '/api/commands') {
      const name = String(c.body!.args[0])
      if (name === 'bad') return json({ error: 'Not allowed.', code: 'rejected' }, 422)
      server = { items: [...server.items, name] }
      return json({ version: server.items.length + 1, state: server })
    }
    return json({ error: 'nope' }, 404)
  }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const call: Call = { url, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    return respond(call)
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

// The command module name sent to the server is "fleet"; the args carry the item so the fake server can apply it.
const wire = (name: string): R => { const r = actions.add(name); return r }

async function serverStore() {
  const local = createPersistedStore<S>({ key: `test.${Math.random()}`, version: 1, seed: () => ({ items: ['local-demo'] }) })
  const store = createModuleStore<S>('fleet', local, () => ({ items: [] }))
  await startBackend()
  return { store, local }
}

describe('saved-data mode', () => {
  it('uses the server, not the browser copy, once connected', async () => {
    const { store } = await serverStore()
    expect(getBackend().mode).toBe('server')
    expect(store.get()).toEqual({ items: [] }) // the browser's demo seed is not shown
  })

  it('shows nothing as saved until the server confirms', async () => {
    const { store } = await serverStore()
    let release!: (r: Response) => void
    respond = (c) => (c.url === '/api/commands' ? new Promise<Response>((res) => { release = res }) : json({ ok: true }))
    const pending = store.run(wire('a'))
    await Promise.resolve(); await Promise.resolve()
    expect(store.get().items).toEqual([]) // in flight: not displayed
    release(json({ version: 2, state: { items: ['a'] } }))
    expect(await pending).toBeNull()
    expect(store.get().items).toEqual(['a']) // confirmed: now displayed
  })

  it('treats a double click as one request', async () => {
    const { store } = await serverStore()
    const [a, b] = [store.run(wire('x')), store.run(wire('x'))]
    expect(await a).toBeNull(); expect(await b).toBeNull()
    expect(calls.filter((c) => c.url === '/api/commands')).toHaveLength(1)
    expect(server.items).toEqual(['x'])
  })

  it('runs different commands one at a time, in order', async () => {
    const { store } = await serverStore()
    await Promise.all([store.run(wire('one')), store.run(wire('two'))])
    expect(calls.filter((c) => c.url === '/api/commands').map((c) => c.body!.args[0])).toEqual(['one', 'two'])
    expect(store.get().items).toEqual(['one', 'two'])
  })

  it('a refused change is reported and leaves the records untouched', async () => {
    const { store } = await serverStore()
    expect(await store.run(wire('bad'))).toBe('Not allowed.')
    expect(store.get().items).toEqual([])
  })

  it('after a dropped connection it retries with the same request id, so the change cannot be applied twice', async () => {
    vi.useFakeTimers()
    const { store } = await serverStore()
    let n = 0
    respond = (c) => {
      if (c.url !== '/api/commands') return json({ ok: true })
      n++
      throw new TypeError('network down') // the request never got an answer
    }
    const failed = store.run(wire('y'))
    await vi.advanceTimersByTimeAsync(5000)
    const msg = await failed
    expect(msg).toMatch(/Not saved/)
    expect(msg).toMatch(/still on screen/)
    expect(n).toBe(3) // retried automatically
    expect(store.get().items).toEqual([]) // never shown as saved
    const ids = new Set(calls.filter((c) => c.url === '/api/commands').map((c) => c.body!.requestId))
    expect(ids.size).toBe(1)
    // The user clicks again after the network returns: same id, so a server that already applied it answers instead of repeating it.
    server = { items: ['y'] }
    respond = (c) => (c.url === '/api/commands' ? json({ version: 5, state: server, replayed: true }) : json({ ok: true }))
    expect(await store.run(wire('y'))).toBeNull()
    expect(new Set(calls.filter((c) => c.url === '/api/commands').map((c) => c.body!.requestId)).size).toBe(1)
    expect(store.get().items).toEqual(['y']) // exactly one
  })

  it('a server error (5xx) is treated as outcome-unknown, not as success', async () => {
    vi.useFakeTimers()
    const { store } = await serverStore()
    respond = (c) => (c.url === '/api/commands' ? json({ error: 'boom' }, 500) : json({ ok: true }))
    const p = store.run(wire('z'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toMatch(/Not saved/)
    expect(store.get().items).toEqual([])
  })

  it('refuses actions the server cannot save, instead of silently changing nothing', async () => {
    const { store } = await serverStore()
    expect(await store.run(plain('p'))).toMatch(/not available with saved data/)
    expect(calls.some((c) => c.url === '/api/commands')).toBe(false)
  })

  it('moves to a sign-in screen when the Access session has expired', async () => {
    const { store } = await serverStore()
    respond = (c) => (c.url === '/api/commands' ? json({ error: 'Sign in required.', code: 'no-token' }, 401) : json({ ok: true }))
    expect(await store.run(wire('q'))).toMatch(/Sign in required/)
    expect(getBackend().mode).toBe('blocked')
    expect(store.get().items).toEqual([])
  })
})

describe('demonstration mode', () => {
  it('is used when no server answers, keeps data in the browser, and never calls the command API', async () => {
    respond = () => json({ error: 'not found' }, 404)
    const local = createPersistedStore<S>({ key: `test.${Math.random()}`, version: 1, seed: () => ({ items: [] }) })
    const store = createModuleStore<S>('fleet', local, () => ({ items: [] }))
    await startBackend()
    expect(getBackend().mode).toBe('demo')
    expect(await store.run(wire('d'))).toBeNull()
    expect(store.get().items).toEqual(['d'])
    expect(calls.some((c) => c.url === '/api/commands')).toBe(false)
  })

  it('stays in demonstration mode when Access is not configured (fail closed), even if a database is bound', async () => {
    respond = (c) => (c.url === '/api/health' ? json({ ok: true, database: true, access: false }) : json({ error: 'x' }, 503))
    await startBackend()
    expect(getBackend()).toMatchObject({ mode: 'demo', serverAvailable: false })
    expect(getBackend().reason).toMatch(/Access control is not configured/)
  })
})
