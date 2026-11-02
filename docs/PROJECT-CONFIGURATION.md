# Project configuration (migration 0031)

Projects differ in scope, so what a project includes is a **setting of the project**, not an assumption of the application. REEF and a grouting-only project are the same application with different settings.

## Settings
Stored on the project (`projects.use_areas`, `archived`, `template`) and in `project_settings` (explicit module / scope switches). **A missing switch means the default**: everything that existed before 0031 is on; the new
*Equipment setting* and *Grouting* scope items are off. No existing project gains work it never had, and no row is rewritten (0031 only adds columns and a table). Templates (Full concrete foundations, Grouting only, Custom) only pre-fill the switches.

* **Modules** (`progress`, `survey`, `procurement`, `qaqc`, `civil`, `fleet`, `safety`): off = hidden from the navigation, dashboards, trackers and progress; the routes show "not enabled for this project". Records are kept.
* **Construction scope** (`rebarBuilt`, `rebarInstalled`, `formed`, `poured`, `anchorBolts`, `embeds`, `equipmentSet`, `grouted`): the activities that count toward construction completion.
  Grouting is a scope item of Construction Progress, not a separate module.
* **Use Project Areas**: off = foundations belong directly to the project.

## How it is enforced
* `activityApplicable(project, scope, key)` (`projectSettings.ts`) is the single rule. `getIndex` builds `idx.activities` and `activitiesByOwner` from applicable activities only, so every tracker, dashboard, exception and progress figure follows it. Inapplicable activities **stay in `state.activities`** (and the database): they are hidden, never deleted, and return when switched on.
* `elementStages` averages only the stages that exist for a footing or plinth (rebar, forming, concrete, post-install, equipment, grouting). For every existing project the stages are the same four as before, so the figures are unchanged. An element with no stage in scope is left out of every completion basis (type, count, volume).
* `updateActivity` refuses an activity outside the project's scope, server-side (same reducer as the browser). `updateProjectSettings`, `archiveProject`, `deleteProject` are Admin commands (`structure.manage`); project data isolation is the existing row scoping (`scope.ts`, `project_settings` belongs to its project).
* Project switching is unchanged: records are reached through area → project, so nothing crosses projects.

## Areas
A project that does not use areas has **one hidden implicit area** (`areas.implicit = 1`). It carries the foundations (and keeps the area-based project isolation and procurement references working) but is never listed or selectable; `createFoundation` accepts the project id and uses it.
Turning areas off on a project that already has foundations needs them all in at most one area (that area becomes the hidden one, nothing moves); with several it is refused with the reason. Turning areas on shows the hidden area again as "General" (or its own name).

## Lifecycle
* **Archive / restore**: hides the project from the lists and the switcher; nothing is deleted.
* **Delete**: Admin only, archived projects only, the exact name typed, refused while any procurement record belongs to one of its areas (procurement cannot be checked from the browser alone: the server supplies it), and the database refuses it while fleet assignments still point at the project.

## Not changed
Existing REEF data, settings and calculations. Disabled-module enforcement on the *materials* commands is by project scoping (Admin and assignment), not by the module switch: the module switch hides and excludes, it is not an access control.
