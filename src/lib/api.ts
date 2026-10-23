import { IS_PUBLIC_DEMO } from '@/app/bundle'

/** Thin client for the Nexus API. Errors say whether the outcome of the request is known. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, /** true when the request may or may not have been applied (network loss, timeout, 5xx). */ public outcomeUnknown: boolean) { super(message) }
  get authRequired() { return this.status === 401 || this.status === 403 || this.code === 'auth-redirect' }
}

const TIMEOUT_MS = 30_000

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  // The public demo has no server: it must never send a request, so visitors cannot reach (or be mistaken for) saved records.
  if (IS_PUBLIC_DEMO) throw new ApiError('The public demo does not use a server.', 0, 'demo', false)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    // `manual`: when Cloudflare Access has expired it answers with a redirect to its login page; treat that as "sign in again", not as data.
    res = await fetch(path, { method, redirect: 'manual', credentials: 'same-origin', signal: controller.signal, headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(controller.signal.aborted ? 'The server took too long to answer.' : 'Could not reach the server.', 0, 'network', true)
  } finally { clearTimeout(timer) }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new ApiError('Your sign-in has expired. Reload the page to sign in again.', 401, 'auth-redirect', false)
  let data: unknown = null
  try { data = await res.json() } catch { /* not JSON */ }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null
    // A non-JSON error (for example an HTML page from the edge) means the API did not answer; the outcome is unknown for writes.
    throw new ApiError(d?.error ?? `The server answered with an error (${res.status}).`, res.status, d?.code ?? 'http', res.status >= 500 || !d)
  }
  if (data === null) throw new ApiError('The server sent an unreadable answer.', res.status, 'bad-response', method === 'POST')
  return data as T
}
