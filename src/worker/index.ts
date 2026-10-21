import { handleApi, type Env } from './api'

/**
 * Entry point. Static files are served by Cloudflare's asset layer without invoking this Worker; only /api/* is routed here
 * (see `assets.run_worker_first` in wrangler.jsonc).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleApi(request, env)
  },
}
