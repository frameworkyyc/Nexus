import { handleApi, type Env } from './api'
import { publicHeaders } from './publicApi'

/**
 * Entry point. Normally static files are served by Cloudflare's asset layer without invoking this Worker and only /api/* is routed here
 * (see `assets.run_worker_first` in wrangler.jsonc). The public view-only site routes EVERY request through here so that each page, not only the API,
 * carries the noindex and security headers (wrangler.production-public.example.jsonc); the files themselves still come from the asset layer.
 */
interface WorkerEnv extends Env { ASSETS?: { fetch(request: Request): Promise<Response> } }
interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: Ctx): Promise<Response> {
    const path = new URL(request.url).pathname
    if (env.NEXUS_ENV === 'public' && !path.startsWith('/api/')) {
      if (path === '/robots.txt') return new Response(env.PUBLIC_INDEXABLE === 'true' ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8', ...publicHeaders(env) } })
      if (!env.ASSETS) return new Response('Not found.', { status: 404 })
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('This site is view only.', { status: 405, headers: { allow: 'GET, HEAD', ...publicHeaders(env) } })
      const res = await env.ASSETS.fetch(request)
      const out = new Response(res.body, res)
      for (const [k, v] of Object.entries(publicHeaders(env))) out.headers.set(k, v)
      return out
    }
    return handleApi(request, env, undefined, undefined, ctx ? (p) => ctx.waitUntil(p) : undefined)
  },
}
