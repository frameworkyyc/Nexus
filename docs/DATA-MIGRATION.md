# Data migration: nexus-staging → nexus-production

**Status: prepared and re-validated on disposable copies of a fresh staging snapshot. Nothing has been run against either live database.** The live run needs your explicit approval (see "Approval gates").

Tool: `scripts/data-migration/` (`plan.mjs` classifies every table, `migrate.mjs` plans, rehearses, applies to a local copy and emits SQL, `import-sql.mjs` loads an export into a local copy).
It only ever INSERTs. It never connects to D1, never replaces or updates a row (except the three module counters), refuses any primary-key or unique-key conflict, refuses excluded tables, and stops on any table that is not classified.

## Decisions made (confirmed)
* **All 10 purchase orders move, with all their lines and deliveries.** Nine have no PO number, and that is intentional. A record is never treated as test data because an optional field is blank; the tool has no such rule, and a test asserts that blank-field orders move with their lines and deliveries.
* **Fleet moves** with the projects (`--groups fleet`).
* **Material audit history moves** with the materials it describes.
* **Archived records are preserved** (1 area, 1 foundation, 1 material).
* **Authentication records and the staging change log are excluded.**
* No table is classified "review" any more and no row is excluded by request. (The `--exclude-rows` mechanism remains for future use, with cascade.)

## What moves (fresh staging snapshot, 2026-11-01; staging is in active use, so the live run uses a final export after a freeze)
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
| `activities` | 749 | 749 |  |
| *Construction total* | | **979** | |
| `manual_materials` | 42 | 42 |  |
| `purchase_orders` | 10 | 10 |  |
| `purchase_order_lines` | 34 | 34 |  |
| `procurement_deliveries` | 9 | 9 |  |
| `procurement_delivery_lines` | 32 | 32 |  |
| `material_audit` | 90 | 90 |  |
| `suppliers` | 1 | 0 | identical row already in production: left alone |
| `category_suppliers` | 1 | 0 | identical row already in production: left alone |
| *Materials and procurement total* | | **217** | includes 90 history rows |
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
| *Fleet total* | | **38** | |

**Everything: 1,234 rows in 48 tables (28 of them have rows).** IDs, references and values are copied exactly (verified row by row). Empty in staging (nothing to move): foundation_units, foundation_unit_embeds, library_embed_plates, pours, pour_items, material_allocations, material_installations, manual_material_receipts, the workbook-import tables, maintenance_records, tread_measurements.

## What never moves
| Table(s) | Rows in staging | Why |
|---|---:|---|
| `user_roles`, `user_projects`, `role_audit`, `auth_sessions` | 2, 1, 3, 0 | Members, invitations, assignments, membership history and sessions are authentication records. Production members are invited in production; the first administrator bootstraps from `INITIAL_ADMIN_EMAIL`. |
| `change_log` | 1,060 | Staging command history: request ids and development activity. Production starts its own. |
| `module_versions`, `schema_info`, `d1_migrations`, `write_guard`, `sqlite_sequence` | – | Production's own bookkeeping. The tool only adds 1 to the counters of the modules it migrates, so open browsers reload. |
| `odometer_readings_before_0011` | 1 | A staging-only backup table left by an old staging migration; production does not have it. |
| Inspections flagged `demo = 1` | 0 | Demonstration records are never copied (none exist in staging). |

## What I found in staging
* **Real project data**: one organization, 2 projects, 6 areas, 50 foundations, 23 anchorage types, 7 vehicles/equipment, 5 inspections by field staff. (Names are deliberately not written in this public repository.)
* **Integrity is clean**: SQLite integrity_check ok; 0 foreign-key violations; 0 orphans across 12 references that are not declared as foreign keys; 0 duplicates on foundations, anchorage types, PO numbers and unit numbers.
* **Authors** are the administrator (same person in production) plus four field staff named as inspection submitters: attribution text, carried as written.
* **Already in production** (left alone, never overwritten): the supplier "Nucor" and the preference "bolts → Nucor", identical to staging's.
* **Staging is moving**: since the first review the activities grew from 628 to 749 and the change log by 131, which is why the live run needs a freeze and a final export.

## Decisions still needed
1. **Freeze and timing**: agree a window with no staging edits from the final export until the migration is verified. Run the migration **before** the new Worker version is promoted, so production has no other writers and a rollback loses nothing.
2. **Who runs the live apply** (needs `wrangler` signed in with D1 access): you in a terminal, or a GitHub Actions run (needs a Cloudflare token that also has D1 edit permission), or Claude in chunks through the D1 tool (about 480 KB of SQL; slow).

## Procedure (every step is repeatable; steps 1 to 6 touch no live data except reads and a bookmark)
Run from the repo with `wrangler` signed in. `work/` and `backups/` hold real data and are git-ignored.
```
# 1. Freeze staging edits. Then record the production recovery point and keep a full backup of both databases.
npx wrangler d1 time-travel info nexus-production                  # write the bookmark down
mkdir -p backups work
npx wrangler d1 export nexus-production --remote --output backups/production-before.sql
npx wrangler d1 export nexus-staging    --remote --output backups/staging-source.sql

# 2. Load both into disposable local copies
node scripts/data-migration/import-sql.mjs backups/production-before.sql work/production.sqlite
node scripts/data-migration/import-sql.mjs backups/staging-source.sql    work/staging.sqlite

# 3. DRY RUN (writes nothing anywhere; rehearses on an in-memory copy and runs 90+ checks)
node scripts/data-migration/migrate.mjs --source work/staging.sqlite --target work/production.sqlite \
  --groups construction,materials,fleet --dry-run --report work/dry-run.json
#    expected: 0 problems, "all checks passed", every source row planned for insert (nothing excluded, filtered or cascaded)

# 4. Rehearse for real on a disposable copy and generate the live SQL, rollback SQL and verification SQL
cp work/production.sqlite work/production-rehearsal.sqlite
node scripts/data-migration/migrate.mjs --source work/staging.sqlite --target work/production-rehearsal.sqlite \
  --groups construction,materials,fleet --apply \
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
Expected after step 7 (with the freeze, the counts are those of the final export; today's snapshot gives the numbers above): `module_versions` = construction 1, materials 1, fleet 1; `user_roles`, `user_projects`, `auth_sessions`, `role_audit`, `change_log` still 0; `PRAGMA foreign_key_check` empty; 10 purchase orders (9 without a number), 34 lines, 9 deliveries, 32 delivery lines.
Then run the live pre-flight and sign in as the first administrator (they see all projects); Edit and View Only members are assigned to projects in Setup → Team members.

## Backup and rollback
* **Before**: a Time Travel bookmark (30-day window) and a full export of both databases (step 1). Staging is only ever read.
* **If the apply itself fails**: D1 returns the database to its original state (Cloudflare's documented behaviour for `d1 execute --file`); fix the cause and retry.
* **If the data is wrong after a successful apply**: (a) if nothing else has been written to production, run `work/rollback.sql` (deletes exactly the rows the migration inserted, children first, and lowers the three counters); (b) otherwise restore the bookmark: `npx wrangler d1 time-travel restore nexus-production --bookmark=<id>` (this also discards any later writes, which is why the migration runs before anyone uses production).
* Both rollback routes were rehearsed on copies: the rollback script returned the copy to byte-identical original content.

## Re-validation results (disposable copies of the fresh snapshot, 2026-11-01)
* Dry run: 0 problems, 92 checks passed; 1,234 rows in 48 tables; nothing excluded, filtered or cascaded.
* Applied to a copy: every migrated row identical to its source (hash per table), integrity_check ok, 0 foreign-key violations, 0 orphans, authentication tables untouched, module counters 1/1/1.
* The emitted SQL replayed on a second copy gave a database identical to the first in all 57 tables; the rollback script then restored the original exactly.
* The application's own readers loaded the migrated copy; the construction, materials (including history) and fleet states equal the source's; the application integrity check passes.
* Retained as confirmed: all 10 purchase orders (9 without a number), 34 lines, 9 deliveries, 32 delivery lines; the archived area, foundation and material; 90 material history rows; all fleet records.
* Failure paths (earlier rehearsal, still covered by tests): a second run on a migrated copy is refused and writes nothing; selecting `user_roles` is refused; excluding records cascades to their dependents only.

## Risks
* **Staging changes after the export**: a freeze and a final export solve it; the plan always runs against the latest export.
* **A new migration adding a table**: the tool stops until the table is classified in `plan.mjs` (a test enforces this).
* **Attribution text names people**: carried as written.
* **Ids are kept**, so staging and production share ids until staging is reset; nothing links them.
* **The `wrangler d1 export` format** was not run against a real export in this review (the rehearsal copies were built from read-only queries of both databases); `import-sql.mjs` is tested on an export-shaped file. If an export does not load, use the same read-only copies approach and tell me.
* **After the migration**, production has data but no members until the first administrator signs in.
