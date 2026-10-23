# Nexus saved data: architecture and migration sequence

Nexus started as a browser-only prototype (`localStorage`). This document describes how it now saves real operational records
in Cloudflare D1, what is deliberately **not** built, and the order in which things are switched on.

## Shape of the solution

```
Browser (React)                       Cloudflare Worker `nexus`                  D1 database
───────────────                       ─────────────────────────                  ───────────
domain action creators  ──tagged──▶   POST /api/commands                         tables (migrations/*.sql)
(same reducers, same rules)           1. verify Cloudflare Access token
                                      2. read module rows ─────────────────────▶ SELECT (one snapshot)
                                      3. run the SAME reducer on them
                                      4. diff → upsert/delete + change_log ────▶ one transaction (batch)
                                      5. reply with the saved records
UI shows "saved" only after step 5.
```

* **One Worker, existing deployment.** The Worker (`src/worker/`) serves only `/api/*`; static files are served by Cloudflare's
  asset layer (`assets.run_worker_first: ["/api/*"]`). No new Worker, route or domain.
* **Same business rules in browser and server.** Each domain's pure reducers (`domains/*/actions.ts`) are the single source of
  truth. The browser tags each call (`lib/commandTag.ts`); the server re-runs it against the stored records
  (`shared/registry.ts` lists the only commands it accepts). Calculations (odometer review, tire kilometres, progress,
  material totals) therefore cannot differ between client and server.
* **Relational schema, not JSON blobs.** `migrations/0001_core_schema.sql`. Stable text ids, foreign keys (enforced by D1),
  CHECK constraints, and partial unique indexes for rules such as "one active tire set per vehicle".
* **Source facts and operational edits are separate tables.** Workbook rows are `material_lines` (plus summary, anchorage-sheet
  rows and review flags, each tied to an `material_import_batches` row); what people entered is `material_line_ops`,
  `material_receipts` and `flag_acknowledgements`. Re-importing a workbook never touches the second group.
* **Migrations, not startup DDL.** Schema changes are numbered SQL files applied with `wrangler d1 migrations apply`.
* **Audit trail.** Every accepted change is appended to `change_log` (module, command, arguments, who, when) in the same
  transaction as the change. It also lets a retried request be answered instead of applied twice.

## Modules and what is saved

| Module | Saved in D1 | Not saved (still demonstration only) |
|---|---|---|
| Fleet | vehicles, assignments, odometer readings (with review state), service targets, maintenance, tire sets and tread measurements, accessories and placements, weekly inspections and defects | — |
| Materials | import batches, source requirement lines (formula, comments, status), workbook summary rows, anchorage-sheet rows, review flags, ordered quantity, receipts, “nothing received” confirmations, flag acknowledgements | — |
| Construction | project, areas, foundations, plinths, recorded activity statuses (construction, survey, QA/QC), project status | procurement, fabrication, anchorage library, handover, documents, crews (hidden in saved-data mode) |

An activity with no stored row is **not started**. Adding a foundation records that it exists and creates no completed work.

## Demonstration data stays separate

* The server holds no fictional data: the real REEF project and five areas, the four supplied vehicles, and T6010's verified values
  (`0002_seed_reef_and_fleet.sql`, `INSERT … WHERE NOT EXISTS`, so newer information is never overwritten).
* Without a server (local development, or while Access/D1 are not configured) the app shows the browser-held demonstration data
  and says so on every screen. It never mixes the two: a screen reads either the server or the browser copy.
* The browser-data migration tool never imports construction records (they are fictional) and requires you to confirm the Fleet and
  Materials data you are importing is real.

## Safety properties

* **Never "saved" before the server confirms.** The save indicator and forms wait for the response. A failed save keeps the form
  open with its input.
* **No duplicates from retries.** Each command carries a request id; the server answers a repeated id from `change_log`. If the
  connection drops with the outcome unknown, the browser retries with the same id.
* **No duplicates from double clicks.** Identical in-flight commands are one request; forms disable while saving.
* **No lost updates.** Writes include a version guard; if another device wrote first, the command is re-evaluated against the
  newer records (up to 4 times), not blindly applied.
* **Server-side validation** by the same reducers, plus structural checks on imports, plus database constraints.
* **History is preserved.** Odometer readings, tire sets, accessory placements, inspections and import batches are append-only;
  `change_log` records every change.

## Access control (not a login system)

Cloudflare Access sits in front of the site. The Worker additionally **verifies the Access token itself** (signature, expiry,
issuer, audience, optional email allow-list), so the API stays closed even if the Access policy is wrong, bypassed through another
hostname, or removed. With no Access settings the API refuses to serve data (fail closed). Writes also reject cross-origin
requests; no CORS headers are sent. `GET /api/health` is public and reveals only whether the backend is configured.

There are still no per-person roles: whoever Access admits can change everything. Do not describe the Fleet role model as
enforced.

## Exact sequence

| # | Step | Where | Status |
|---|---|---|---|
| 1 | Schema and seed migrations | repo | done |
| 2 | Worker API (commands, state, backup, integrity, migration) | repo | done |
| 3 | Access token verification, fail-closed | repo | done |
| 4 | Browser stores switch to the API; demo fallback; save status | repo | done |
| 5 | Fleet, Materials, Construction on saved data; backups; browser-data migration tool | repo | done |
| 6 | Tests (SQLite-backed, real migrations) and local full-stack check (`npm run dev:full`) | repo | done |
| 7 | Create the **staging** D1 database and bind it to Previews | Cloudflare — **you** | pending |
| 8 | Apply migrations to the staging database | your terminal or dashboard console | pending |
| 9 | Create the Cloudflare Access application; set `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | Cloudflare — **you** | pending |
| 10 | Verify staging is closed to the public | you | pending |
| 11 | Download a browser backup; preview, then run the browser-data migration; import the workbook | the app | pending |
| 12 | Production: its own database, Access application and bindings, on promotion | later, with approval | not started |

Steps 7–10 are listed with exact instructions in [OPERATIONS.md](./OPERATIONS.md). Nothing real is stored on staging until they
are done: until then the API refuses requests and the app shows demonstration data.

## Known limitations

* Single user. No roles, memberships, billing or multi-tenancy (by design for this phase).
* Last-writer-wins applies only to free-text edits made from two devices at once; structured records are validated against the
  latest stored state, and the version guard prevents blind overwrites.
* Procurement, fabrication, handover and documents have no saved records yet.
* Cloudflare Access protects the site; anyone it admits can edit. Cloudflare Access sessions expire — the app then asks you to sign in again.
* The browser keeps a copy of nothing in saved-data mode; there is no offline editing. A failed save asks you to retry.
