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

## Anchor bolt installation (migration 0029)
Anchor bolts have an **installation method**: *wet-set* (cast into the concrete as it is poured) or *post-installed* (set into hardened concrete afterwards). It is set per individual-bolt entry (`foundation_bolts.install_method`) and per anchorage group,
for the bolts of its library type (`foundation_anchorages.install_method`); the default is wet-set.

* Wherever anchor bolts are required, the footing or plinth gets an **Anchor bolts installed** construction activity per method present there: `anchorBoltsWetSet` and `anchorBoltsPostInstalled`. Where no bolts are required there is no such activity.
  Required means an anchorage group whose type contains a bolt component, or an individual-bolt entry, mounted on that footing or plinth (`boltOwners` in `anchorageMounts.ts`).
* They are construction activities, tracked independently of forming, rebar and pouring. Wet-set installation is a prerequisite of the pour (shown as waiting, never blocking the record); post-installed installation follows the pour and never holds it up.
* Progress: installation is a further equal stage of a footing or plinth that needs bolts (its two methods split the stage evenly, like built/installed rebar), so outstanding bolts keep the foundation below 100% and out of the Complete state, under every completion basis.
  Foundations that need no bolts have exactly the figures they had.
* The activities are generated from the configuration, not stored as rows; recorded status, dates and notes are stored like any other activity and kept when groups or bolts are added or edited. Changing an item's method moves its work to the other activity; removing all bolts of a method removes that activity.
* Migration 0029 is additive: existing bolts and groups become wet-set, no row is rewritten, and existing activity records and material quantities are untouched. **Existing foundations that need bolts will show the new activity as not started**, so their progress drops until installation is recorded (OP1-01-06: 100% → 75%).
  Where bolts are really post-installed, set the method in Foundation Setup.
* The construction panel lists the bolts each activity covers (source, count, specification) and, at the top, which are outstanding by method.
