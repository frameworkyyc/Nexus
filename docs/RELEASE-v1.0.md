# Release v1.0: production on WorkOS, staging on Cloudflare Access

**Strategy.** `nexus.frameworktools.ca` becomes the live, authenticated Nexus application (the old public demo there is retired; there is no demo deployment, Worker or hostname). Production signs in with
WorkOS AuthKit only (emailed code, invitation-only) on `nexus-production`. Staging stays on Cloudflare Access and `nexus-staging`.

| | Production | Staging |
| --- | --- | --- |
| Worker | `nexus` (from `main`) | `nexus` Preview `staging` |
| Host | nexus.frameworktools.ca | staging.nexus.frameworktools.ca |
| Sign-in | WorkOS AuthKit only (forced by `NEXUS_ENV=production`; Access tokens and the dev bypass are refused) | Cloudflare Access |
| Database | `nexus-production` (`d3f3ed8d-…`) | `nexus-staging` (`8efc35c6-…`) |
| Module locks | on (QA/QC, Civil, Foundation Overview, Issues, Fleet on this project, All projects, Company overview, Crew, Safety) | off |
| Release gate | a build of `main` is **stopped** until you approve | n/a |

## Merging can never deploy production
`scripts/release-gate.mjs` runs first in `npm run build`. On Cloudflare's build service a build of `main` **fails** (nothing is deployed) unless the build variable `NEXUS_RELEASE_APPROVED=yes` is set for the
`nexus` Worker. Merging `staging` into `main` therefore only produces a failed build and leaves the live site as it is. The cutover is the explicit act of setting that variable and retrying the build.
(Optional second layer, dashboard: set the production deploy command to `npx wrangler versions upload`; see "Cutover" for how a version is then promoted.)

## Credentials and secrets
WorkOS Production (client `client_01M6BZ6XSCEHJM3P69FW4C2T9S`) is configured and verified: email-code on, sign-up off, SSO off, password/passkey/social off, redirect `https://nexus.frameworktools.ca/api/auth/callback`,
sign-in endpoint `https://nexus.frameworktools.ca/api/auth/login`, sign-out `https://nexus.frameworktools.ca`, invitations 7 days, API key "Nexus Production" created.

Three secrets go on the production Worker (never in the repository, never in chat). Run in a terminal where you are signed in (`npx wrangler login`), from the repo, with no `--name` (that is the production Worker):
```
# 1. WorkOS Production API key: wrangler asks for it with a hidden prompt
npx wrangler secret put WORKOS_API_KEY
# 2. Session pepper: generated on your machine and piped straight in; it is never displayed or saved
openssl rand -base64 48 | npx wrangler secret put SESSION_PEPPER
# 3. First administrator's email address (hidden prompt)
npx wrangler secret put INITIAL_ADMIN_EMAIL
npx wrangler secret list      # names only: all three must be listed
```
Each `secret put` makes a new deployment of the Worker's *current* code (still the old site) with the secret attached; visitors see no change. The first administrator signs in with `INITIAL_ADMIN_EMAIL`: their membership
is created at their first verified WorkOS sign-in, only while no administrator exists (`src/worker/authRoutes.ts`).

## Database
`nexus-production` is initialised with migrations **0001 to 0027** (additive, schema only; the only rows are the supplier directory entry and the preference "Anchor bolts → Nucor"). A Time Travel bookmark is taken first and recorded,
the `d1_migrations` ledger is created and filled, and the schema is compared with `nexus-staging`. See "Release log" at the end for what was done and when.

## Final checklist (each item waits for your approval where marked ⛔)
1. ☐ WorkOS Production configured and verified (done).
2. ☐ Production database initialised (0001–0027), bookmark recorded, schema matches staging.
3. ☐ Secrets set on the production Worker: `WORKOS_API_KEY`, `SESSION_PEPPER`, `INITIAL_ADMIN_EMAIL` (`npx wrangler secret list`).
4. ☐ No Cloudflare Access application covers `nexus.frameworktools.ca` (including wildcards such as `*.frameworktools.ca`). The staging Access application stays on `staging.nexus.frameworktools.ca` only.
5. ☐ Recommended: a WAF rate-limiting rule on `/api/auth/*`.
6. ☐ **Pre-flight, with the live site untouched** (no merge needed): from a checkout of `staging`, `npx wrangler versions upload` creates a production-configured *version* that is not deployed and prints its Version URL. Against that URL check:
   `GET /api/health` → `{"auth":"workos","environment":"production","database":true,"access":true}`; `GET /api/session`, `/api/state/construction`, `/api/commands` (POST), `/api/members`, `/api/backup` → **401**; `GET /api/auth/login` → 302 to
   `api.workos.com/user_management/authorize` with `client_id=client_01M6BZ6XSCEHJM3P69FW4C2T9S` and `redirect_uri=https://nexus.frameworktools.ca/api/auth/callback`; the page loads and shows the sign-in screen (no data).
7. ☐ Merge `staging` into `main` (pull request). The Cloudflare build of `main` stops at the release gate; confirm production is unchanged.
8. ⛔ **Cutover (needs your explicit approval)**: set the build variable `NEXUS_RELEASE_APPROVED=yes` on the `nexus` Worker (Workers & Pages → `nexus` → Settings → Build → Variables) and retry the `main` build. It builds the application bundle and deploys.
   (If you chose the optional `versions upload` deploy command instead: promote the verified version with `npx wrangler versions deploy <version-id>@100%`.)
9. ☐ **Verify live**: repeat the signed-out checks in 6 on `https://nexus.frameworktools.ca`.
10. ☐ **First administrator**: in WorkOS Production → Users → **Invite user** with the `INITIAL_ADMIN_EMAIL` address (sign-up is off, so the invitation is how the account is created). Open the email link, enter the emailed code. Check `/api/session` shows your email, `"role":"admin"`, `"via":"workos"`.
11. ☐ **Team**: in Setup → Team members invite an Edit and a View Only user with different projects. Check project restrictions, Edit cannot change setup or users, View Only cannot change data, the nine modules show Coming Soon and their routes and commands are refused, **Revoke** blocks the next request, **Resend invitation** works.
12. ☐ Confirm staging still signs in with Access and uses `nexus-staging`.
13. ☐ After the release: remove the `NEXUS_RELEASE_APPROVED` variable again if you want every later merge to need approval (recommended), and delete the now-unused `WORKOS_*` and `SESSION_PEPPER` secrets from the staging preview.

## Rollback
* Site: Cloudflare dashboard → `nexus` → Deployments → roll back to the previous version (the old site), then remove `NEXUS_RELEASE_APPROVED`.
* Access: revoke members in Team members (immediate), or remove the `INITIAL_ADMIN_EMAIL` secret before the first sign-in.
* Database: `npx wrangler d1 time-travel restore nexus-production --bookmark=<recorded bookmark>`. Staging is never touched.
