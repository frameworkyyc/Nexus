# Release v1.0: production (WorkOS) with staging on Cloudflare Access

**Strategy.** Staging keeps Cloudflare Access (`AUTH_PROVIDER=access`, `nexus-staging`). Production uses WorkOS AuthKit only (emailed code, invitation-only, `nexus-production`). The public demo is a
separate Worker. Nothing in this document has been run against production: every step below needs your approval first.

| | Production | Staging | Public demo |
| --- | --- | --- | --- |
| Worker | `nexus` (from `main`) | `nexus` Preview `staging` | `nexus-demo` |
| Host | nexus.frameworktools.ca | staging.nexus.frameworktools.ca | demo.nexus.frameworktools.ca |
| Bundle | application (`npm run build`) | application | demo (`npm run build:demo`) |
| Sign-in | WorkOS AuthKit only (forced by `NEXUS_ENV=production`) | Cloudflare Access | none, API off |
| Database | `nexus-production` (`d3f3ed8d-…`) | `nexus-staging` (`8efc35c6-…`) | none |
| Module locks | on | off | n/a |

## What you must provide (WorkOS **Production** environment of the Nexus project, client `client_01M6BZ6XSCEHJM3P69FW4C2T9S`)
1. **API key** (secret): WorkOS dashboard → Nexus → Production → API Keys → Create. (None exists yet.) It becomes the Cloudflare secret `WORKOS_API_KEY`.
2. **AuthKit settings**: AuthKit enabled; **Email code (Magic Auth) on**; password, social sign-in and SSO **off**; **sign-up off** (invitation-only).
3. **URLs** (AuthKit → Redirects), exactly:
   * Redirect URI: `https://nexus.frameworktools.ca/api/auth/callback`
   * Sign-in endpoint (initiate login URI; invitation emails link here): `https://nexus.frameworktools.ca/api/auth/login`
   * Sign-out redirect (logout URI): `https://nexus.frameworktools.ca`
4. **First administrator's email address** (secret `INITIAL_ADMIN_EMAIL`).
5. **Session pepper** (secret `SESSION_PEPPER`): 32+ random characters, generated fresh for production (not the staging one).

## Cloudflare settings
* Worker `nexus`: custom domain `nexus.frameworktools.ca` (already attached). Workers Builds production branch `main`, build `npm run build`, deploy `npx wrangler deploy`.
* No Cloudflare Access application may cover `nexus.frameworktools.ca` (including a wildcard such as `*.frameworktools.ca`): Access would intercept the WorkOS routes. The staging Access application stays on `staging.nexus.frameworktools.ca` only.
* New Worker `nexus-demo` with custom domain `demo.nexus.frameworktools.ca`; Workers Builds project from this repo, branch `main`, build `npm run build:demo`, deploy `npx wrangler deploy --config wrangler.demo.jsonc`, builds for other branches off.
* Recommended: a WAF rate-limiting rule on `/api/auth/*` (the Framework portal does the same). Nexus has no in-Worker limiter yet.
* Secrets on the production Worker (`npx wrangler secret put <NAME>`, no `--name`): `WORKOS_API_KEY`, `SESSION_PEPPER`, `INITIAL_ADMIN_EMAIL`. They are never in the repository.

## Database
Production is empty (`nexus-production` has no tables). Apply migrations **0001 to 0027** in order; all are additive and create schema only (no seed data; the only rows are the supplier directory entry and the preference "Anchor bolts → Nucor").
1. Take and record a Time Travel bookmark: `npx wrangler d1 time-travel info nexus-production`.
2. `npx wrangler d1 migrations apply nexus-production --remote`
3. Verify: `d1_migrations` lists 0001…0027, `schema_info.schema_version = '27'`, `user_roles` is empty.

## Release steps (in order; each waits for your approval)
1. **WorkOS Production**: items 1 to 3 above (dashboard).
2. **Demo first**: from a checkout of this branch, `npx wrangler deploy --config wrangler.demo.jsonc` (creates the separate `nexus-demo` Worker; production is untouched). Attach `demo.nexus.frameworktools.ca`. Verify the page says "Demo Environment" and `/api/health` answers 404 `{"code":"demo"}`. Then connect its Workers Builds project (above).
3. **Database**: bookmark, migrations, verify (above).
4. **Secrets** on the production Worker (above). Nothing changes for visitors yet.
5. **Review and merge** `staging` into `main` (pull request; the diff is the release). Workers Builds deploys `nexus` with `NEXUS_ENV=production`, the application bundle and the `nexus-production` binding. (Until then `nexus.frameworktools.ca` keeps serving the old demo.)
6. **Verify, signed out**: `GET /api/health` → `{"auth":"workos","environment":"production","database":true,"access":true}`; `GET /api/session`, `/api/state/construction`, `/api/commands`, `/api/members`, `/api/backup` → 401; `GET /api/auth/login` → redirect to `api.workos.com/user_management/authorize` with `redirect_uri=https://nexus.frameworktools.ca/api/auth/callback`; the page loads and shows "Sign in".
7. **First administrator**: in WorkOS Production → Users → **Invite user** with the `INITIAL_ADMIN_EMAIL` address. Open the email link, enter the emailed code. The admin membership is created at that sign-in (only while no administrator exists, only for that email).
8. **Team**: in Setup → Team members invite an Edit and a View Only user with different projects. Check: project restrictions, Edit cannot change setup or users, View Only cannot change data, the nine modules show Coming Soon and their routes and commands are refused, **Revoke** blocks the next request, **Resend invitation** works.
9. **Staging unaffected**: staging still signs in with Access and uses `nexus-staging`.

## Rollback
* Application: Cloudflare dashboard → `nexus` → Deployments → roll back to the previous version (the old demo), or revert the merge commit on `main`.
* Sign-in: set the WorkOS Production environment's sign-up/invitations aside; revoke members from Team members (instant) or clear `INITIAL_ADMIN_EMAIL`.
* Database: restore `nexus-production` to the recorded bookmark (`npx wrangler d1 time-travel restore nexus-production --bookmark=<id>`). Staging is never touched by any of this.
