# Operating Nexus saved data

## 0. What must be true before real data is entered

Do **not** import the workbook, migrate browser data or type real records on any environment until all of these hold:

1. The environment has its **own** D1 database (staging ≠ production).
2. Cloudflare Access protects its hostname **and** its Preview/workers.dev URL.
3. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, and an unauthenticated request to `/api/state/fleet` is refused.
4. `Data & backups` shows "Server database" and your email.

## 1. Cloudflare steps for staging (you do these)

### Step 1 — Create the staging database

Dashboard → **Storage & databases → D1 SQL database → Create database**. Name it `nexus-staging`. Copy the **Database ID**.
(Terminal alternative: `npx wrangler d1 create nexus-staging`.)

> Never reuse this database for production, and never put a production database id in staging config.

### Step 2 — Tell the repository about it

Either send me the Database ID (I will commit it to `wrangler.jsonc` on `staging`), or edit `wrangler.jsonc` on `staging` and
uncomment/fill the line under `previews`:

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "nexus-staging", "database_id": "<STAGING_DATABASE_ID>" }]
```

Copy `wrangler.preview-migrations.example.jsonc` to `wrangler.preview-migrations.jsonc` (git-ignored) and put the same id in it.

### Step 3 — Apply the migrations

```sh
npx wrangler login            # once
npx wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc
```

Expected: `0001_core_schema.sql`, `0002_seed_reef_and_fleet.sql`, `0003_tire_thresholds.sql` and `0004_vehicle_planning_and_demo_inspections.sql` applied. (`0003`/`0004` only add nullable columns and a defaulted flag; apply them before the staging code that reads them runs against the database. `0004` also fills T6010’s configured lifespan/oil-change/tire figures **only where still empty**, and adds four labelled demo inspections **only if T6010 has no inspection yet**; remove the demos from the vehicle page with “Remove demonstration records”.) (No terminal? In the dashboard open the database →
**Console** and run the two files' contents in order. The migration tool is preferred because it records what was applied.)

### Step 4 — Put Cloudflare Access in front of staging

1. Dashboard → **Zero Trust → Access controls → Applications → Add an application → Self-hosted**.
2. Name `Nexus staging`. Add public hostname `staging.nexus.frameworktools.ca`.
3. Policy: **Allow**, selector **Emails** = your email address. (Nobody else.)
4. Save. Open the application and copy the **Application Audience (AUD) tag**.
5. Note your Zero Trust **team domain**: `https://<team>.cloudflareaccess.com` (Settings → Custom pages / Team name).
6. Protect the Preview URL too: **Workers & Pages → nexus → Settings → Domains & Routes** → under *Preview URLs* (and workers.dev)
   click **Enable Cloudflare Access**. (The Worker rejects API calls without a valid token anyway, but static files should not
   be public either.)

### Step 5 — Give the Worker the Access settings

In `wrangler.jsonc` on `staging`, set under `previews.vars`:

```jsonc
"ACCESS_TEAM_DOMAIN": "https://<team>.cloudflareaccess.com",
"ACCESS_AUD": "<the AUD tag>"
```

Optional second lock: `"ALLOWED_EMAILS": "you@example.com"`. Commit and push `staging`; Cloudflare's build deploys the Preview.
(Send me the two values and I will commit them. They are identifiers, not secrets.)

### Step 6 — Verify it is closed

```sh
curl -i https://staging.nexus.frameworktools.ca/api/state/fleet     # expect a redirect to the Access login, or 401 — never JSON
curl -i https://staging.nexus.frameworktools.ca/api/health          # public: {"ok":true,...,"database":true,"access":true}
```

Then open the site in a browser, sign in through Access, and confirm the top bar says **Saved data · staging** and
**Data & backups** lists your email.

### Step 7 — Bring your data across (in this order)

1. **Data & backups → Download browser backup** (keep the file).
2. **Move browser data to the server → Preview import.** Read the table. Tick "real project data" only if it is.
3. **Import to server.** Check Fleet and Materials on a second device.
4. Import the REEF workbook from **Projects → REEF → Materials → Import workbook** (read in your browser; never uploaded as a file,
   never stored in Git).
5. **Download backup** (server). Only then use **Remove browser copy**.

## 2. Backups and recovery

| Need | Use |
|---|---|
| Copy of everything, outside Cloudflare | **Data & backups → Download backup** (JSON, checksummed). Do this weekly and before any big change. |
| "Undo the last hour/day" | D1 **Time Travel**: `npx wrangler d1 time-travel info nexus-staging` then `npx wrangler d1 time-travel restore nexus-staging --timestamp=<ISO time>` (check Cloudflare's current retention for your plan). |
| Restore from a downloaded backup | See below. |
| Is the data internally consistent? | **Data & backups → Check data integrity** (or `GET /api/integrity`). Run after imports and restores. |

### Restoring from a backup file

Restoring replaces data, so it is an operator step and never an API call.

```sh
node scripts/backup-to-sql.mjs nexus-backup-2026-10-21.json > restore.sql          # verifies the checksum first; Node 22.18+
less restore.sql                                                                    # review it
npx wrangler d1 execute nexus-staging --remote --file restore.sql                   # INSERT OR REPLACE over existing rows
```

Add `--wipe` to the first command to empty every table before inserting (use when the database holds newer data you want gone).
Take a fresh backup (or note a Time Travel timestamp) first. Run **Check data integrity** afterwards.

### Interrupted imports

* **Workbook import:** one transaction. If it fails, nothing changed; import again. Importing the same file twice is a no-op.
* **Browser-data migration:** one transaction. If the page closes mid-way, open **Data & backups → Preview import** again; rows
  already imported show as "same". The request id is derived from the data, so a retry cannot double-import.
* **Unsure whether a save landed?** Reload. The record is either there or it is not; saves are never half-applied.

## 3. Schema migrations

* Add `migrations/000N_description.sql`; never edit an applied file.
* Test locally: `npm run db:migrate:local` (applies to a local SQLite-backed D1 under `.wrangler/`).
* Staging: `npx wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc`, **before** deploying code that needs it.
* Download a backup first. Migrations are forward-only; recovery from a bad one is Time Travel or a backup restore.
* Keep migrations additive (new tables/columns). Destructive changes need a backup and explicit approval.

## 4. Local full-stack development

```sh
npm run dev:full      # builds, applies migrations to a local database, serves http://localhost:8787
```

This runs the real Worker and a local D1 with an auth bypass that works **only** for `localhost`. `npm run dev` (Vite only) has no
server, so the app shows demonstration data.

## 5. Production (later, with approval)

Production must get its own D1 database, its own Access application and its own bindings (`d1_databases` and `ACCESS_*` at the
top level of `wrangler.jsonc`). Do that on the promotion branch, never by pointing production at the staging database.

## Fresh installation (staging) — what a new customer sees

Staging is a blank installation. Nothing is seeded: the migrations create the schema and nothing else (the only rows are the supplier
directory entry and preference **Anchor bolts → Nucor**). The first screen is *Welcome to Nexus → Create organization*; then the first
project, its areas and foundations, the anchorage library, materials and fleet are all created by people, in the database.

* **Database**: `nexus-staging` is bound to the staging preview as `DB` (`wrangler.jsonc` → `previews.d1_databases`). Production
  (`nexus-production`) is not referenced anywhere in the config. Migrations `0001`–`0007` are applied; `schema_version` is `7`.
  Apply future ones with `npx wrangler d1 migrations apply nexus-staging --remote` (the *staging* database only); never run a migration or
  seed against production by hand.
* **Reference data** that used to be in migrations (the sample organization, project, areas and vehicles) now lives in `seeds/reef/` and
  is applied only by the automated tests. Never apply it to a real database.
* **No browser-held records**: the application bundle never stores operational data in the browser and never falls back to it. If the
  database or Cloudflare Access is missing it shows "Saved data isn't set up yet" and says which. Old browser keys from earlier staging
  builds (`nexus.demo.*`, `nexus.reef.*`) are neither read nor deleted.
* **First administrator**: set `INITIAL_ADMIN_EMAIL` on the staging preview (or insert the first row of `user_roles`). That verified identity
  becomes Admin and can create the organization; nobody else gains a role by signing in.
* **Still required for real sign-in**: a Cloudflare Access application for `staging.nexus.frameworktools.ca`, then `ACCESS_TEAM_DOMAIN` and
  `ACCESS_AUD` in `previews.vars`. Until then the API refuses every request (fail closed).
* **Local full-stack run** (real Worker, local SQLite D1): `npm run build && npx wrangler d1 migrations apply DB --local --config wrangler.dev.jsonc && npx wrangler dev --config wrangler.dev.jsonc`.

## Team members, project access and production locks (v1.0)

* **Team members** (Setup → Team members, administrators only): invitations are manual (no email). Status is Invited → Active on the person's first
  verified sign-in, or Revoked. A revoked person is refused on their very next request even though Cloudflare Access still signs them in
  (`user_roles.status`, checked on every request). Cloudflare Access must also allow an invited person's email.
* **Permissions**: Admin (everything, every project), Edit (`editor`: update Procurement, Construction and Survey; no project setup, no user management),
  View Only (`viewer`: read only). Enforced by the Worker (`src/shared/rbac.ts`, `src/worker/roles.ts`).
* **Project access** (`user_projects`, migration 0026): non-administrators see and change only their assigned projects. The Worker filters what they
  read and refuses a change that touches another project (`src/worker/scope.ts`). Records that belong to no project stay shared. Importing a
  workbook needs access to every project.
* **Production locks** (`NEXUS_ENV=production`; `src/shared/lock.ts`): QA/QC, Civil / Earthworks, Foundation Overview, Issues, Fleet on this project, All projects,
  Company overview, Crew and Safety show a lock and "Coming Soon", their routes show a Coming Soon page, and the Worker refuses QA/QC and Civil
  activity updates and project fleet assignment. Staging keeps every module.
