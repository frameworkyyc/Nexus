/**
 * Which bundle a build produces.
 *   demo — fictional data only, never calls the API. The PUBLIC bundle.
 *   app  — the saved-data client (no real identity is compiled in). For local development, the protected staging environment and production (`main`).
 *
 * Fail-safe by design: on Cloudflare's build service (WORKERS_CI) every branch builds the public `demo` bundle UNLESS it is
 * `staging` or `main` (production), so a misconfigured, renamed or unknown branch can never publish the application. There is no demo deployment;
 * `npm run build:demo` builds it for local checks. NEXUS_BUNDLE overrides. Anything else (local builds, tests) is `app`.
 */
export function resolveBundle(env) {
  const explicit = env.NEXUS_BUNDLE
  if (explicit === 'demo' || explicit === 'app') return explicit
  if (env.WORKERS_CI) return env.WORKERS_CI_BRANCH === 'staging' || env.WORKERS_CI_BRANCH === 'main' ? 'app' : 'demo'
  return 'app'
}
