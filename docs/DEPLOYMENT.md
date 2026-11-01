# Deployment: production, staging and the build guards

## What is deployed where (v1.0)

| Branch | Hostname | What it is | Sign-in | Data |
| --- | --- | --- | --- | --- |
| `main` | `nexus.frameworktools.ca` | **Production application** (`nexus`, bundle `app`, `NEXUS_ENV=production`, module locks on) | **WorkOS AuthKit only**: emailed code, invitation-only | `nexus-production` D1 |
| `staging` | `staging.nexus.frameworktools.ca` | Worker Preview of `nexus` (bundle `app`, all modules) | **Cloudflare Access only** | `nexus-staging` D1 |

There is no public demo deployment. A Preview never inherits the production bindings, and a build of `main` is stopped by the release gate until you approve it (`docs/RELEASE-v1.0.md`).
The demo bundle (`npm run dev:demo`) remains for local development, and `scripts/bundle-mode.mjs` still builds it for unknown branches as a fail-safe, with the build guard that fails the build if real identifying data reached it.

## The demo bundle (local development and fail-safe only)

1. **Build-time bundle switch.** `scripts/bundle-mode.mjs`: on Cloudflare only `staging` and `main` build the application; every other branch builds the `demo` bundle. `NEXUS_BUNDLE=demo|app` overrides.
2. **Identity swap and build guard.** In the demo build `src/app/identity.demo.ts` replaces the real identity module, and `vite.config.ts` fails the build if any pattern in `scripts/demo-forbidden.mjs` appears.
3. **No server.** The demo client never calls the API, and a Worker with `NEXUS_ENV=demo` answers every `/api/*` request with 404 before any binding is considered. No deployment uses it.

## Protecting staging (required, manual)

Cloudflare Access applications can only be created in the dashboard (Zero Trust → Access → Applications → Add → Self-hosted):
hostname `staging.nexus.frameworktools.ca`, a policy that allows only approved emails. Then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`
in `wrangler.jsonc` (`previews.vars`). Until this exists the staging hostname is **publicly reachable**, and because staging is the
real-data build, that includes the real seed data in its JavaScript.

## Verifying a deployment

* GitHub → commit → checks: CI must be green. For `main`, a Cloudflare build that stops at the release gate is expected until the release is approved.
* `GET /api/health` reports `{"auth":"workos","environment":"production"}` on production and `{"auth":"access","environment":"staging"}` on staging.
