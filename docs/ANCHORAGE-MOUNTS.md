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
