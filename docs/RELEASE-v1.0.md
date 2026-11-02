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
* **`production-reachability.yml`** (no credentials, read-only): run it with `git push origin staging:release/preflight --force` (or by pushing a tag `check-<n>`). It sends GET requests to the live hostname and fails if Cloudflare Access redirects it (`cloudflareaccess.com`), which would intercept the WorkOS routes.
* **`production-preflight.yml`**: run it with the same push of the branch `release/preflight` (or push a tag `preflight-<n>`). The branch is dedicated to this: pushes to `staging` and `main` never start it. It uploads the tagged code as an **undeployed** version of the production Worker (`wrangler versions upload`), waits for its test URL, and runs `scripts/preflight.mjs` against it. Wrangler keeps the Worker's existing
  secrets on the new version, so the production secrets never pass through GitHub. A test fails the build if the workflow ever contains a deploy, promote or rollback command. The result and the version id are in the run summary.

**One-time setup (browser only, about five minutes):**
1. Cloudflare dashboard → your profile (top right) → API Tokens → Create Token → Create Custom Token. Name it "GitHub Nexus pre-flight". Permission: **Account · Workers Scripts · Edit**. Account Resources: include only the Framework account. Create it and copy the token once.
2. GitHub → `frameworkyyc/Nexus` → Settings → Environments → New environment, named exactly `production-preflight`.
   * Deployment branches and tags → Selected branches and tags → add a **Branch** rule `release/preflight` and a **Tag** rule `preflight-*`.
   * Optional: Required reviewers → add yourself, so every run waits for your approval before it touches Cloudflare.
   * Environment secrets → add `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (`8d8d61851e9e56969b4a6bf9a985e9a4`).
3. Tell Claude. It pushes `release/preflight`, watches the run and reports every check. (Cloudflare may also build a harmless Preview for that branch; it uses the staging settings and needs Cloudflare Access like any staging Preview.)

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
* **2026-11-01, production pre-flight (GitHub Actions run on `release/preflight`).** An undeployed version `21f40bde-631a-4d13-b61b-62c5bf55286d` of the production Worker was uploaded (test URL `https://21f40bde-nexus.plain-poetry-2054.workers.dev`).
  All 28 `scripts/preflight.mjs` checks passed against it: production + WorkOS, `nexus-production` bound, every protected endpoint refused an unauthenticated request, WorkOS login redirect with the Production client id and callback, forged callback refused.
  The version has the three production secrets as `secret_text` and the `nexus-production` D1 binding (`d3f3ed8d-…`). Live traffic was not changed (the live deployment is still version `d7c30510`, the old site). The staging preview (Access, `nexus-staging`) and both databases were unaffected.
  The live hostname has no Cloudflare Access in front of it (`production-reachability` run). Not done: promotion, merge, release gate, first-administrator sign-in.

## Launch workflow (GitHub Actions): `production-launch.yml`
Does the final staging export, production backup, data migration, verification and release of the pinned, pre-flighted Worker version, with rollback. It starts only from a push to `release/preflight` whose head commit message contains
`[launch-rehearsal]` (everything except production writes and deployment) or `[launch-production]` (the full launch). Start it with:
```
git checkout -B release/preflight staging && git commit --allow-empty -m "Launch [launch-production]" && git push --force origin release/preflight
```
* Needs the `production-preflight` environment's Cloudflare token to have **Account · Workers Scripts · Edit** and **Account · D1 · Edit** (a Workers-only token fails the first step with "Authentication error 10000" and changes nothing).
* Safeguards: production must still be empty (27 migrations, no data or members); a Time Travel bookmark is recorded first; staging is exported twice and must be identical; the plan must insert exactly 1,234 rows with zero problems; the SQL is rehearsed on a copy; the live apply is atomic;
  live counts and `foreign_key_check` must equal the rehearsal. On failure: unchanged check, then `rollback.sql`, then Time Travel restore. Only the pinned version is deployed (`versions deploy`, never a new build); if the live checks fail the previous deployment is restored (migrated data is kept).
* Exports and SQL never leave the runner (the repository is public): no artifacts are uploaded and logs show counts only.
* The pinned version (`TARGET_VERSION`) and the pre-flighted commit are set at the top of the workflow; a changed application file since that commit stops the run.
* Release log, 2026-11-01: the first rehearsal run stopped at the permission check (token lacked D1 access). Production was not touched.
* **2026-11-01, production launch (GitHub Actions `production-launch.yml`, third live attempt, run on commit `b1e9d8b`).**
  * Attempts 1 and 2 applied the data, failed their own verification (a mis-read of the foreign-key result block, then `d1 execute --file` returning no rows) and were rolled back automatically by `rollback.sql`; production was verified empty again each time and nothing was deployed. Fixed in the workflow (verification now uses single-row `--command` queries, validated read-only against production before any write).
  * Attempt 3: recovery bookmark `00000010-00000000-00005116-1ac12ce2c4fc2a47dded67cb2f934ad7` taken first; staging identical across two exports; 1,234 rows in 28 tables inserted atomically; live counts equal the rehearsal in all 48 tables and `foreign_key_check` empty; module counters fleet/materials/construction = 1; 10 purchase orders, 34 lines, 9 deliveries, 90 material history rows, 7 vehicles; members, sessions and change log still 0.
  * Version `21f40bde-631a-4d13-b61b-62c5bf55286d` (the pre-flighted one) deployed at 100% (previous version `d7c30510-be08-4fea-9d1c-c8516bcc8c35`, available for rollback). All 28 `scripts/preflight.mjs` checks passed against `https://nexus.frameworktools.ca`.
  * Not done: the first administrator's invitation and sign-in (needs the administrator's own email and verification code), merging `staging` into `main`.
* **2026-11-01, production release 2** (`production-release.yml`; details in `docs/ANCHORAGE-MOUNTS.md`). Version `db06d5fd-90b9-4edd-b098-a59197a53f40` live at 100% (previous `21f40bde`), built from `ca0d118`. Contents: anchorage mounts (migration 0028: anchorage groups, individual bolts and embed plates on footings or plinths),
  Completion Basis (Foundation Type counts each designation once; Foundation Count; Concrete Volume), percentages that never show 100% unless complete, and the Anchorage Library warning-icon alignment. Production database at schema 28; recovery bookmark `0000002b-00000000-00005116-b1a1609244f6c689c39bc1c5c7be464f`.
  Production checks: 28 live pre-flight checks, schema/ledger/anchorage verification, foreign-key and application integrity checks, before/after comparison of quantities, anchorage totals, requirements and progress, members/project assignments/role history identical.
* **2026-11-01, production release 3** (`production-release.yml`, run on `73005f5`; details in `docs/ANCHORAGE-MOUNTS.md`). Version `15426fe7-5bd9-4ede-a118-a238458e2625` live at 100% (previous `db06d5fd`), built from staging `1f1f84c`. Contents: migration 0029 (install method on bolts and anchorage groups) and 0030 (on embed plates), the Post-Install checkbox
  on anchorage groups, individual anchor bolts and embed plates, separate construction activities for post-installed anchor bolts and embed plates counted in progress and every completion basis, and the redesigned Foundation Add/Edit form.
  Production database at schema 30 (30 ledger rows); recovery bookmarks `00000030-00000028-00005116-6229333d606244aeead6efcee57a383c` (taken before the release) and `00000034-00000000-00005116-300d273b9103c406c313567b52eba4c6` (rehearsal run).
  The workflow now applies a list of migrations in order, rehearses them and their additive rollback (DROP COLUMN) on an export of production, and verifies schema, ledger, the three columns and `foreign_key_check`. Every existing setting is wet-set (installed with the pour), so no progress changed; OP1-01-06 reads 100% until Post-Install is ticked in Foundation Setup.
  Checks: 28 live pre-flight checks; every row of every table equal before and after the migrations (new columns aside); calculations re-verified on a post-release copy of production's data (52 designations).
* **2026-11-02, production release 4** (`production-release.yml`, run on `e15edfe`; details in `docs/PROJECT-CONFIGURATION.md`). Version `c7fdf98d-0175-4ac1-919a-520c7dda0993` live at 100% (previous `15426fe7`), built from staging `a03ac70`. Contents: migration 0031 (project configuration), Projects Dashboard, Project Settings, project templates and creation workflow, optional areas, per-project modules and construction scope (equipment setting, grouting), archive/restore/delete, and the "As-built survey" label.
  Production database at schema 31 (31 ledger rows); recovery bookmarks `0000003e-00000006-00005117-586209fde58d981bdefd4c9dbbbf0ea5` (taken before the release) and the workflow's own, recorded in its run. Every existing project reads as before (areas on, all modules on, new scope items off): projects 2, areas 7, foundations 56, activities 879, purchase orders 21 — all unchanged; `foreign_key_check` empty.
  The release workflow now takes a list of migrations and its rollback (dropping the new columns and table) is rehearsed on a copy of production before any live write.
