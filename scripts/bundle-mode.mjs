/**
 * Which bundle a build produces.
 *   demo — fictional data only, never calls the API. The PUBLIC bundle.
 *   app  — the real seed data and the saved-data client. For local development and the protected staging environment.
 *
 * Fail-safe by design: on Cloudflare's build service (WORKERS_CI) every branch builds the public `demo` bundle UNLESS it is the
 * `staging` branch, so a misconfigured, renamed or unknown branch can never publish the real seed data. NEXUS_BUNDLE overrides
 * (tests, `npm run build:demo`). Anything else (local builds, tests) is `app`.
 */
export function resolveBundle(env) {
  const explicit = env.NEXUS_BUNDLE
  if (explicit === 'demo' || explicit === 'app') return explicit
  if (env.WORKERS_CI) return env.WORKERS_CI_BRANCH === 'staging' ? 'app' : 'demo'
  return 'app'
}
