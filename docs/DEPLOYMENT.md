# Deployment: public demo, staging and the future production app

## What is deployed where

| Branch | Hostname | What it is | Data | Protection |
| --- | --- | --- | --- | --- |
| `main` | `nexus.frameworktools.ca` | **Public interactive demo** (bundle `demo`, Worker `NEXUS_ENV=demo`) | Fictional sample data, kept in each visitor's own browser | None needed or wanted: it holds no real or shared data |
| `staging` | `staging.nexus.frameworktools.ca` | Real-data build (bundle `app`) for development | Real seed data in the bundle; saved data in the staging D1 database once configured | **Cloudflare Access must be created for this hostname** (see below) |

## How the public demo is kept free of real data

1. **Build-time bundle switch.** `scripts/bundle-mode.mjs` decides the bundle. On Cloudflare's build service every branch except
   `staging` builds the public `demo` bundle (fail-safe: an unknown or renamed branch is public-safe). `NEXUS_BUNDLE=demo|app` overrides.
2. **Identity swap.** Everything that identifies the real organization, project, client, site, areas, anchorage codes and fleet lives in
   `src/app/identity.ts`. In the demo build `identity.demo.ts` (fictional) replaces it, so the real strings never enter the build.
3. **Build guard.** `vite.config.ts` scans every emitted file for the patterns in `scripts/demo-forbidden.mjs` and **fails the build**
   if any match. A failed build means nothing is deployed. Add a pattern whenever real data gains a new identifier.
4. **No server.** The demo client never sends a request (`src/lib/api.ts`), the saved-data tools are not offered, and the Worker has
   `NEXUS_ENV=demo`, which answers every `/api/*` request with 404 before authentication or any binding is considered. The main
   deployment has no D1 binding and no Access configuration.
5. **Browser-local data.** Sample data is kept in `localStorage` under `nexus.public-demo.*`. Visitors never share data; clearing
   site data or **Reset Demo** (top bar → Demo Environment) restores the original sample data.
6. **Tests** (`src/app/__tests__`, `src/worker/__tests__/demo.test.ts`) build the demo bundle, scan it, run the seed builders against
   the fictional identity, and prove the guard trips on the real-data bundle.

## Moving the demo to `demo.nexus.frameworktools.ca`

The hostname list lives in `src/app/demoConfig.ts`. When the main domain should become the authenticated application:

1. Attach `demo.nexus.frameworktools.ca` to the demo deployment (Worker → Domains & Routes) and add it to `DEMO_HOSTNAMES`.
2. Give the authenticated deployment its own build that is not the demo bundle, its own D1 database and Access application
   (docs/OPERATIONS.md), and set its Worker variable `NEXUS_ENV` to `production`.
3. Keep the demo deployment on `NEXUS_ENV=demo` with no bindings.

## Protecting staging (required, manual)

Cloudflare Access applications can only be created in the dashboard (Zero Trust → Access → Applications → Add → Self-hosted):
hostname `staging.nexus.frameworktools.ca`, a policy that allows only approved emails. Then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`
in `wrangler.jsonc` (`previews.vars`). Until this exists the staging hostname is **publicly reachable**, and because staging is the
real-data build, that includes the real seed data in its JavaScript.

## Verifying a deployment

* GitHub → commit → checks: `Workers Builds: nexus` must be green (a red check means no deploy, e.g. the guard failed).
* `GET /api/health` on the demo returns 404 `{ "code": "demo" }`; the page shows the **Demo Environment** marker.
* In a browser's network tab the demo makes no `/api` requests.
