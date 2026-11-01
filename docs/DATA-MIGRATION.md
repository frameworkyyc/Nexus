# Data migration: nexus-staging → nexus-production

**Status: prepared and rehearsed on disposable copies. Nothing has been run against either live database.** The live run needs your explicit approval (see "Approval gates").

Tool: `scripts/data-migration/` (`plan.mjs` classifies every table, `migrate.mjs` plans, rehearses, applies to a local copy and emits SQL, `import-sql.mjs` loads an export into a local copy).
It only ever INSERTs. It never connects to D1, never replaces or updates a row (except the three module counters), refuses any primary-key or unique-key conflict, refuses excluded tables, and stops on any table that is not classified.

## What moves (staging snapshot of 2026-11-01; staging is in active use, so the live run uses a fresh export)
| Table | Staging rows | Will be inserted | Note |
|---|---:|---:|---|
| `companies` | 1 | 1 |  |
| `projects` | 2 | 2 |  |
| `areas` | 6 | 6 |  |
| `anchorage_types` | 23 | 23 |  |
| `anchorage_components` | 16 | 16 |  |
| `foundations` | 50 | 50 |  |
| `foundation_anchorage_groups` | 50 | 50 |  |
| `foundation_bolts` | 3 | 3 |  |
| `foundation_embeds` | 1 | 1 |  |
| `plinths` | 78 | 78 |  |
| `activities` | 628 | 628 |  |
| *Construction total* | | **858** | |
| `manual_materials` | 42 | 42 |  |
| `purchase_orders` | 10 | 10 |  |
| `purchase_order_lines` | 34 | 34 |  |
| `procurement_deliveries` | 9 | 9 |  |
| `procurement_delivery_lines` | 32 | 32 |  |
| `suppliers` | 1 | 0 | identical row already in production: left alone |
| `category_suppliers` | 1 | 0 | identical row already in production: left alone |
| `material_audit` (**review**, needs `--include`) | 90 | 90 | history of material changes |
| *Materials total (without `material_audit`)* | | **127** | |
| `fleet_categories` | 1 | 1 |  |
| `vehicles` | 7 | 7 |  |
| `vehicle_assignments` | 7 | 7 |  |
| `odometer_readings` | 5 | 5 |  |
| `service_targets` | 5 | 5 |  |
| `tire_sets` | 1 | 1 |  |
| `accessory_types` | 1 | 1 |  |
| `accessories` | 1 | 1 |  |
| `accessory_placements` | 1 | 1 |  |
| `inspections` | 5 | 5 |  |
| `inspection_defects` | 4 | 4 |  |
| *Fleet total (**review**, needs `--groups fleet`)* | | **38** | |

Empty in staging (nothing to move): foundation_units, foundation_unit_embeds, library_embed_plates, pours, pour_items, material_allocations, material_installations, manual_material_receipts, the workbook-import tables, maintenance_records, tread_measurements.
Everything selected: **1,113 rows** in 48 tables (28 of them have rows). IDs, references and values are copied exactly (verified row by row).

## What never moves
| Table(s) | Rows in staging | Why |
|---|---:|---|
| `user_roles`, `user_projects`, `role_audit`, `auth_sessions` | 2, 1, 3, 0 | Members, invitations, assignments, history and sessions are authentication records. Production members are invited in production; the first administrator bootstraps from `INITIAL_ADMIN_EMAIL`. |
| `change_log` | 929 | Staging command history: request ids and development activity (all by the administrator). Production starts its own. |
| `module_versions`, `schema_info`, `d1_migrations`, `write_guard`, `sqlite_sequence` | – | Production's own bookkeeping. The tool only adds 1 to the counters of the modules it migrates, so open browsers reload. |
| `odometer_readings_before_0011` | 1 | A staging-only backup table left by an old staging migration; production does not have it. |
| Inspections flagged `demo = 1` | 0 | Demonstration records are never copied (none exist in staging). |

## What I found in staging
* **Looks like real project data**, not test data: one organization, 2 projects (with real job numbers and client), 6 areas, 50 foundations, 23 anchorage types, 7 vehicles/equipment, 5 inspections by field staff. (Names are deliberately not written in this public repository.) No value in any migratable table looks like test text (checked for test, dummy, sample, staging, lorem, asdf, todo).
* **Integrity is clean**: SQLite integrity_check ok; 0 foreign-key violations; 0 orphans across 12 references that are not declared as foreign keys; 0 duplicates on foundations, anchorage types, PO numbers and unit numbers.
* **Staging-specific references**: authors are all `hello@frameworkco.ca` (the same administrator as production) plus four field staff named as submitters on inspections. They are attribution text, not links, and carry over as written.
* **Already in production** (left alone, never overwritten): the supplier "Nucor" and the preference "bolts → Nucor" (identical to staging's).
* **Needs your eye**: 5 purchase orders created within a minute of each other on 2026-11-01 (14:54 to 14:55) with no number, supplier or name, but with 16 lines, 5 deliveries and 16 delivery lines. They may be test entries (see decision 3).

## Decisions I need from you
1. **Fleet** (7 vehicles/equipment, assignments to the first project, 5 inspections, readings, a tire set, an accessory): move with the projects (`--groups fleet`)? Fleet is organization-level, so it is your call. Recommended: yes, it looks real.
2. **`material_audit`** (90 rows): the history of who changed which material and when (52 have no named actor). Moves with the materials it describes (`--include material_audit`) but names staging users. Recommended: yes, for traceability.
3. **The 5 unnamed purchase orders**: include, or exclude them together with their 16 lines, 5 deliveries and 16 delivery lines (`--exclude-rows`, rehearsed: removes exactly those 42 rows)?
4. **Archived records** (1 area with no foundations, 1 foundation, 1 material): keep as history (recommended) or drop?
5. **History**: confirm production starts a fresh change history (`change_log` is not copied).
6. **Timing**: staging is being used (its construction counter rose from 774 to 870 during this review). Agree a freeze (no staging edits) from the final export until the migration is verified. Run the migration **before** the new Worker version is promoted, so production has no other writers and a rollback loses nothing.
7. **Who runs the live apply** (needs `wrangler` signed in with D1 access): you in a terminal, or a GitHub Actions run (needs a Cloudflare token that also has D1 edit permission), or Claude in chunks through the D1 tool (about 400 KB of SQL; slow).

## Procedure (every step is repeatable; steps 1 to 6 touch no live data except reads and a bookmark)
Run from the repo with `wrangler` signed in. `work/` and `backups/` hold real data and are git-ignored.
```
# 1. Freeze staging edits (decision 6). Then record the production recovery point and keep a full backup of both databases.
npx wrangler d1 time-travel info nexus-production                  # write the bookmark down
mkdir -p backups work
npx wrangler d1 export nexus-production --remote --output backups/production-before.sql
npx wrangler d1 export nexus-staging    --remote --output backups/staging-source.sql

# 2. Load both into disposable local copies
node scripts/data-migration/import-sql.mjs backups/production-before.sql work/production.sqlite
node scripts/data-migration/import-sql.mjs backups/staging-source.sql    work/staging.sqlite

# 3. DRY RUN (writes nothing anywhere; rehearses on an in-memory copy and runs 90+ checks). Add your decisions:
node scripts/data-migration/migrate.mjs --source work/staging.sqlite --target work/production.sqlite \
  --groups construction,materials,fleet --include material_audit [--exclude-rows work/exclude-rows.json] --dry-run --report work/dry-run.json
#    expected: 0 problems, "all checks passed", 1,113 rows in 48 tables (fewer if you exclude records or fleet)

# 4. Rehearse for real on a disposable copy and generate the live SQL, rollback SQL and verification SQL
cp work/production.sqlite work/production-rehearsal.sqlite
node scripts/data-migration/migrate.mjs --source work/staging.sqlite --target work/production-rehearsal.sqlite \
  --groups construction,materials,fleet --include material_audit --apply \
  --emit-sql work/migration.sql --emit-rollback work/rollback.sql --emit-verify work/verify.sql
MIGRATION_SOURCE_DB=work/staging.sqlite MIGRATION_TARGET_DB=work/production-rehearsal.sqlite MIGRATION_EXPECT_EQUAL=construction,materials,fleet \
  npx vitest run src/worker/__tests__/dataMigrationCopies.test.ts      # the application's own loaders and integrity check on the migrated copy

# 5. REVIEW work/migration.sql (INSERT only) and send it for approval together with work/dry-run.json
# 6. STOP: approval gate. Nothing below runs without your explicit go-ahead.

# 7. LIVE APPLY (atomic: if it fails, the database returns to its original state and it can be retried)
npx wrangler d1 time-travel info nexus-production                  # a fresh bookmark immediately before
npx wrangler d1 execute nexus-production --remote --file=work/migration.sql

# 8. VERIFY on the live database and compare with work/verify.sql.expected.json
npx wrangler d1 execute nexus-production --remote --file=work/verify.sql   # PRAGMA foreign_key_check returns nothing; each count matches
```
Expected after step 7: the counts in the tables above; `module_versions` = construction 1, materials 1, fleet 1; `user_roles`, `user_projects`, `auth_sessions`, `role_audit`, `change_log` still 0; `PRAGMA foreign_key_check` empty.
Then run the live pre-flight and sign in as the first administrator (they see all projects); Edit and View Only members are assigned to projects in Setup → Team members.

## Backup and rollback
* **Before**: a Time Travel bookmark (30-day window) and a full export of both databases (step 1). Staging is only ever read.
* **If the apply itself fails**: D1 returns the database to its original state; fix the cause and retry.
* **If the data is wrong after a successful apply**: (a) if nothing else has been written to production, run `work/rollback.sql` (deletes exactly the rows the migration inserted, children first, and lowers the three counters); (b) otherwise restore the bookmark: `npx wrangler d1 time-travel restore nexus-production --bookmark=<id>` (this also discards any later writes, which is why the migration runs before anyone uses production).
* Both rollback routes were rehearsed on copies: the rollback script returned the copy to byte-identical original content.

## Rehearsal results (disposable copies, 2026-11-01)
* Dry run: 0 problems, 92 checks passed (48 tables, 1,113 rows, fleet and `material_audit` included).
* Applied to a copy: every migrated row identical to its source (hash per table), integrity_check ok, 0 foreign-key violations, 0 orphans, authentication tables untouched.
* The emitted SQL replayed on a second copy gave a database identical to the first in all 57 tables; the rollback script then restored the original exactly.
* The application's own readers loaded the migrated copy; the construction, materials and fleet states equal the source's; the application integrity check passes.
* Failure paths: a second run on a migrated copy is refused (1,113 conflicts) and writes nothing; selecting `user_roles` is refused; excluding the five unnamed purchase orders cascades to exactly their 16 lines, 5 deliveries and 16 delivery lines and the rest validates (66 checks).

## Risks
* **Staging changes after the export**: a fresh export and a freeze solve it; the plan always runs against the latest export.
* **A new migration adding a table**: the tool stops until the table is classified in `plan.mjs` (a test enforces this).
* **Attribution text names people** (the administrator's address, inspection submitters): carried as written.
* **Ids are kept**, so staging and production share ids until staging is reset; nothing links them.
* **The `wrangler d1 export` format** was not run against a real export in this review (the rehearsal copies were built from read-only queries of both databases); `import-sql.mjs` is tested on an export-shaped file. If an export does not load, use the same read-only copies approach and tell me.
* **After the migration**, production has data but no members until the first administrator signs in.
