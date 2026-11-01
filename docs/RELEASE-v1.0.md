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

Three **secrets** go on the production Worker (never in the repository, never in chat). They must be of type *Secret*, not *Variable*: a plain-text variable added in the dashboard is readable there and through the API, and `wrangler deploy` deletes
any dashboard-only variable because `wrangler.jsonc` is the source of truth, which would remove the pepper and the admin address at cutover. If any of them was added as a variable, delete that variable first (Workers & Pages → `nexus` → Settings → Variables and secrets),
and replace a pepper that was ever stored as a variable with a fresh one. Run in a terminal where you are signed in (`npx wrangler login`), from the repo, with no `--name` (that is the production Worker):
```
# 1. WorkOS Production API key: wrangler asks for it with a hidden prompt
npx wrangler secret put WORKOS_API_KEY
# 2. Session pepper: generated on your machine and piped straight in; it is never displayed or saved
openssl rand -base64 48 | npx wrangler secret put SESSION_PEPPER
# 3. First administrator's email address (hidden prompt)
npx wrangler secret put INITIAL_ADMIN_EMAIL
npx wrangler secret list      # names and types only: all three must be listed as secret_text
```
Each `secret put` makes a new deployment of the Worker's *current* code (still the old site) with the secret attached; visitors see no change. The first administrator signs in with `INITIAL_ADMIN_EMAIL`: their membership
is created at their first verified WorkOS sign-in, only while no administrator exists (`src/worker/authRoutes.ts`).

## Database
`nexus-production` is initialised with migrations **0001 to 0027** (additive, schema only; the only rows are the supplier directory entry and the preference "Anchor bolts → Nucor"). A Time Travel bookmark is taken first and recorded,
the `d1_migrations` ledger is created and filled, and the schema is compared with `nexus-staging`. See "Release log" at the end for what was done and when.

## Final checklist (each item waits for your approval where marked ⛔)
1. ☑ WorkOS Production configured and verified (done).
2. ☑ Production database initialised (0001–0027), bookmark recorded, schema matches staging (done 2026-11-01; see the release log).
3. ☐ Secrets set on the production Worker: `WORKOS_API_KEY`, `SESSION_PEPPER`, `INITIAL_ADMIN_EMAIL` (`npx wrangler secret list`).
4. ☐ No Cloudflare Access application covers `nexus.frameworktools.ca` (including wildcards such as `*.frameworktools.ca`). The staging Access application stays on `staging.nexus.frameworktools.ca` only.
5. ☐ Recommended: a WAF rate-limiting rule on `/api/auth/*`.
6. ☐ **Pre-flight, with the live site untouched** (no merge needed): from a checkout of `staging`, `npx wrangler versions upload` creates a production-configured *version* that is not deployed and prints its Version URL. Against that URL check:
   run `node scripts/preflight.mjs <Version URL>` (it makes every check below with no credentials and exits non-zero on any failure). By hand:
   `GET /api/health` → `{"auth":"workos","environment":"production","database":true,"access":true}`; `GET /api/session`, `/api/state/construction`, `/api/commands` (POST), `/api/members`, `/api/backup` → **401**; `GET /api/auth/login` → 302 to
   `api.workos.com/user_management/authorize` with `client_id=client_01M6BZ6XSCEHJM3P69FW4C2T9S` and `redirect_uri=https://nexus.frameworktools.ca/api/auth/callback`; the page loads and shows the sign-in screen (no data).
7. ☐ Merge `staging` into `main` (pull request). The Cloudflare build of `main` stops at the release gate; confirm production is unchanged.
8. ⛔ **Cutover (needs your explicit approval)**: set the build variable `NEXUS_RELEASE_APPROVED=yes` on the `nexus` Worker (Workers & Pages → `nexus` → Settings → Build → Variables) and retry the `main` build. It builds the application bundle and deploys.
   (If you chose the optional `versions upload` deploy command instead: promote the verified version with `npx wrangler versions deploy <version-id>@100%`.)
9. ☐ **Verify live**: `node scripts/preflight.mjs https://nexus.frameworktools.ca` must pass.
10. ☐ **First administrator**: in WorkOS Production → Users → **Invite user** with the `INITIAL_ADMIN_EMAIL` address (sign-up is off, so the invitation is how the account is created). Open the email link, enter the emailed code. Check `/api/session` shows your email, `"role":"admin"`, `"via":"workos"`.
11. ☐ **Team**: in Setup → Team members invite an Edit and a View Only user with different projects. Check project restrictions, Edit cannot change setup or users, View Only cannot change data, the nine modules show Coming Soon and their routes and commands are refused, **Revoke** blocks the next request, **Resend invitation** works.
12. ☐ Confirm staging still signs in with Access and uses `nexus-staging`.
13. ☐ After the release: remove the `NEXUS_RELEASE_APPROVED` variable again if you want every later merge to need approval (recommended), and delete the now-unused `WORKOS_*` and `SESSION_PEPPER` secrets from the staging preview.

## Pre-flight without a local terminal (GitHub Actions)
Two workflows run from GitHub; neither can deploy.
* **`production-reachability.yml`** (no credentials, read-only): push a tag `check-<n>`. It sends GET requests to the live hostname and fails if Cloudflare Access redirects it (`cloudflareaccess.com`), which would intercept the WorkOS routes.
* **`production-preflight.yml`**: push a tag `preflight-<n>`. It uploads the tagged code as an **undeployed** version of the production Worker (`wrangler versions upload`), waits for its test URL, and runs `scripts/preflight.mjs` against it. Wrangler keeps the Worker's existing
  secrets on the new version, so the production secrets never pass through GitHub. A test fails the build if the workflow ever contains a deploy, promote or rollback command. The result and the version id are in the run summary.

**One-time setup (browser only, about five minutes):**
1. Cloudflare dashboard → your profile (top right) → API Tokens → Create Token → Create Custom Token. Name it "GitHub Nexus pre-flight". Permission: **Account · Workers Scripts · Edit**. Account Resources: include only the Framework account. Create it and copy the token once.
2. GitHub → `frameworkyyc/Nexus` → Settings → Environments → New environment, named exactly `production-preflight`.
   * Deployment branches and tags → Selected branches and tags → Add rule → type **Tag**, pattern `preflight-*`.
   * Optional: Required reviewers → add yourself, so every run waits for your approval before it touches Cloudflare.
   * Environment secrets → add `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (`8d8d61851e9e56969b4a6bf9a985e9a4`).
3. Tell Claude. It pushes the tag `preflight-1`, watches the run and reports every check.

**Promotion stays manual:** after the run passes, Cloudflare dashboard → Workers & Pages → `nexus` → Deployments → find the version named "pre-flight preflight-… " → **Deploy version** → 100%. Nothing in GitHub or Cloudflare promotes it for you,
and the same page shows the previous version for rollback. After promoting, push a tag `check-<n>` for the live-host checks, or run `node scripts/preflight.mjs https://nexus.frameworktools.ca` anywhere.
Afterwards merge `staging` into `main` (the release gate keeps that merge from deploying) so `main` matches what is live.

**Dashboard-only alternative (no GitHub token):** set the production Worker's deploy command to `npx wrangler versions upload` (Settings → Build) and set `NEXUS_RELEASE_APPROVED=yes` in its build variables, then merge `staging` into `main`: the build uploads an undeployed version.
Open Deployments → that version → copy its test URL, and by hand open `/api/health` (expect `"environment":"production","auth":"workos"`), `/api/session` and `/api/state/construction` (expect a 401 JSON error, never data) and `/api/auth/login` (expect a redirect to `api.workos.com` with the Nexus client id). Then **Deploy version** → 100%.

## Rollback
* Site: Cloudflare dashboard → `nexus` → Deployments → roll back to the previous version (the old site), then remove `NEXUS_RELEASE_APPROVED`.
* Access: revoke members in Team members (immediate), or remove the `INITIAL_ADMIN_EMAIL` secret before the first sign-in.
* Database: `npx wrangler d1 time-travel restore nexus-production --bookmark=<recorded bookmark>`. Staging is never touched.

## Release log
* **2026-11-01, production database.** Time Travel bookmark taken first: `00000004-00000000-00005116-a830b642c49efc16c45b0f7946866ea1` (the database was empty). Migrations 0001–0027 applied in order with a ledger row after each.
  Verified against `nexus-staging`: ledger has 27 rows ending `0027_workos_auth.sql`; `schema_version` is `27`; 57 tables, 30 indexes and 1 trigger, with identical index and trigger SQL. The only difference is a staging-only leftover
  backup table, `odometer_readings_before_0011`, which production correctly lacks. Data: 0 projects, 0 members, 1 supplier (Nucor) and 1 preference (bolts → Nucor), module versions all 0.
  The production Worker was not touched: still on its 2026-10-23 deployment, with no secrets set yet.
* To restore the database to the empty state if ever needed: `npx wrangler d1 time-travel restore nexus-production --bookmark=00000004-00000000-00005116-a830b642c49efc16c45b0f7946866ea1`.
