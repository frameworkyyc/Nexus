# Anchorage mounts: footings, plinths and what is mounted on them

The physical structure and the anchorage on it are separate records.

| | Footing (pad) | Plinths |
| --- | --- | --- |
| How many | one per physical foundation: the foundation **quantity** | the plinth records: a **set** of identical plinths has a count and default dimensions (`foundation_anchorage_groups`, the older name for a plinth set) |
| Anchorage groups | `foundation_anchorages` with `mount_group_id` NULL | `foundation_anchorages` with `mount_group_id` = the set |
| Individual anchor bolts | `foundation_bolts.mount_group_id` NULL | `mount_group_id` = the set (quantity per plinth) |
| Embed plates | `foundation_embeds.mount_group_id` NULL | `mount_group_id` = the set (quantity per plinth) |
| Work and concrete | footing activities, footing volume, footing pours | plinth activities, plinth volumes and pours, **only for plinths that exist** |

* An **anchorage group** is `qty` anchorages of one Anchorage Library type. A footing or a set can carry several, of different types (or the same type twice).
  Bolt, nut, washer, template, sole-plate and plate totals come from the type's components × `qty` × the footings or plinths carrying it × the foundation quantity.
* Changing an anchorage quantity never changes footings, plinths or their activities; changing a plinth count never changes the footing's anchorage. Anchorage on a footing creates no plinths and no plinth work.
* Removing a set of plinths removes what was mounted on it (its anchorage groups, bolts and embed plates), never the footing's.
* `plinths.anchorage_type_id` and `foundation_anchorage_groups.anchorage_type_id` remain as "the first anchorage type on the set" for the older per-plinth views. They are kept in step by the configuration actions.
* The calculation lives in `anchorageMounts.ts` (`resolveAnchorages`, `mountCount`) and is used by the requirements engine, the consolidated takeoff and the independent re-check (`expectedTotals`), so they cannot disagree.
  Data with no stored anchorage groups is read the old way (each plinth with a type is one anchorage), which is also how plinths that belong to no set are always read.

## Migration 0028 (additive)
Creates `foundation_anchorages`, adds `mount_group_id` to `foundation_bolts` and `foundation_embeds`, and maps existing plinth-mounted anchorage: every plinth set with an anchorage type gets one
anchorage group of quantity 1 on its plinths (so counts are unchanged: plinths of the type × quantity). Footing bolts and embed plates stay on the footing. Plinths, activities, groups and every other row are untouched.
Checked on a copy of the real staging data: 47 anchorage groups from 50 plinth sets, all 46 (foundation, type) totals identical, integrity check passing
(`ANCHORAGE_MIGRATION_DB=<copy at schema 27> npx vitest run src/worker/__tests__/anchorageMigration.test.ts`).

Rollout: take a D1 Time Travel bookmark and record it, apply 0028 to the database (staging first), then deploy the code that reads the new table. Code deployed before the migration fails to read `foundation_anchorages`.
Production is at schema 27 and needs 0028 too, before it receives the new code.

## Rollout log
* **2026-11-01, staging.** Time Travel bookmark taken first: `000000e6-00000000-00005116-29028a7e062ef3755c766b1373eaa3fe`. Migration 0028 applied to `nexus-staging` in one call with its `d1_migrations` ledger row (28 rows, schema_version 28);
  47 anchorage groups created from the 47 typed plinth sets; every other table's row count unchanged; `foreign_key_check` empty. Code deployed to the staging preview (deployment 113) after the migration.
  Before/after checked on read-only copies of the real staging database: 50 designations, 136 physical foundations, 187 anchorages, 40 calculated requirements and the progress figures under all three completion bases are identical,
  and OP1-21-29 saved through the real server write path with two OP1-A11 groups on its footing gives 24 bolts, 2 templates, no plinths and no plinth activities.
  Restore if ever needed: `npx wrangler d1 time-travel restore nexus-staging --bookmark=000000e6-00000000-00005116-29028a7e062ef3755c766b1373eaa3fe` (this also discards later staging edits).
* **2026-11-01, production** (GitHub Actions `production-release.yml`, run on commit `6294b0e`). Rehearsed first on an export of production's own data (52 designations, 140 physical foundations, 190 anchorages, 81 calculated requirements and the 21 progress figures identical before and after; OP1-21-29 with two OP1-A11 groups gives 24 bolts, 2 templates, no plinths, no plinth activities).
  Time Travel bookmark taken before any write: `0000002b-00000000-00005116-b1a1609244f6c689c39bc1c5c7be464f`. Migration 0028 applied atomically (schema 28, 28 ledger rows, 49 anchorage groups = the 49 typed plinth sets, `foreign_key_check` empty), then the pre-flighted version `db06d5fd-90b9-4edd-b098-a59197a53f40` was deployed at 100% (previous: `21f40bde-631a-4d13-b61b-62c5bf55286d`).
  All 28 `scripts/preflight.mjs` checks passed on `https://nexus.frameworktools.ca`. Rollback of the schema, if ever needed: drop `foundation_anchorages`, set `schema_version` to 27 and delete the ledger row (the empty `mount_group_id` columns stay); do not restore the bookmark, which would also discard what users saved since.

## Post-Install: anchor bolts and embed plates (migrations 0029, 0030)
Foundation Setup has one **Post-Install** checkbox on each anchorage group, each individual anchor-bolt entry and each embed-plate entry (footing or plinth set). It is stored as `install_method`
(`foundation_anchorages`, `foundation_bolts`, `foundation_embeds`): `'wet-set'` = unchecked (default), `'post-installed'` = checked. The column values are unchanged from 0029, so settings already saved are kept as they are.

* **Unchecked:** installed as part of the pour. No installation activity; it never holds up the pour or completion.
* **Checked:** the footing or plinth gets an installation activity in Construction: `anchorBoltsPostInstalled` (anchor bolts, including those of an anchorage group's library type) and/or `embedsPostInstalled` (embed plates, including those of a group's type).
  A group's checkbox covers both its bolts and its embed plates. Where nothing is post-installed there is no such activity (`installOwners` in `anchorageMounts.ts`).
* Mixed methods on one footing or plinth are supported: only the checked parts are tracked; each activity keeps its recorded status, dates and notes when other items are added, edited or removed.
* Post-install activities follow the pour (`after: ['poured']`) and never hold it up: concrete can be marked poured while they are outstanding.
* Progress: installation is a further equal stage of a footing or plinth that has post-installed items (the bolt and embed activities split the stage evenly, like built/installed rebar), so outstanding items keep the foundation below 100% and out of the Complete state, under every completion basis. Foundations with none have exactly the figures they had.
* Material quantities are independent of the method.
* The activities are generated from the configuration, not stored as rows; recorded status is stored like any other activity. The construction panel lists what each activity covers and which post-installed items are outstanding.
* Migration 0030 is additive (`foundation_embeds.install_method`, default `'wet-set'`); no row is rewritten. The earlier wet-set activity (`anchorBoltsWetSet`, 0029) no longer exists: wet-set means "installed with the pour". A recorded wet-set activity row, if any, is ignored.

### Rollout log (anchor bolt installation)
* **2026-11-02, staging.** Time Travel bookmark taken first: `000000e9-00000000-00005116-808bb11749bc8bac003b3b214a7165c3`. Migration 0029 applied to `nexus-staging` (schema 29, 29 ledger rows); every existing bolt and anchorage group is wet-set; counts unchanged (749 activity rows, 50 foundations, 78 plinths); `foreign_key_check` empty.
  Code deployed to the staging preview (deployment 117) after the migration. On the staging data, 21 of 50 designations need bolts and drop until installation is recorded (OP1-01-06 100% → 75%; OP1-21-03 to -08 from 100% to 80–88%); foundations without bolts are unchanged.
* **Production** is at schema 28 on version `db06d5fd` and has not received this change. On a copy of the production data, 36 of 52 designations need bolts; OP1-01-06 goes 100% → 75% and, once set to post-installed, stays at 75% with the pour complete until the bolts are recorded.
* **Post-Install checkbox (0030), staging.** Time Travel bookmark taken first: `000000ec-00000000-00005116-b90613bfe9f1f8870918d3c23d8c5247`. Migration 0030 applied to `nexus-staging` (schema 30, ledger row 30); the one embed plate is wet-set (installed with the pour); the post-installed bolt already saved is kept; 749 activity rows unchanged (none were wet-set records); `foreign_key_check` empty. Production stays at schema 28.
* **Production release 3, 2026-11-01.** Migrations 0029 and 0030 applied to `nexus-production` (schema 30), version `15426fe7`. All existing bolts, anchorage groups and embed plates are wet-set (installed with the pour), so no construction progress changed. Tick Post-Install in Foundation Setup where components are really post-installed (for example OP1-01-06's bolts).
