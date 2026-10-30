# Materials management and access control

The Materials dashboard lives at **Projects → Construction → Materials** (and each area's Materials tab). It replaces the Excel tracker
for day-to-day work while keeping the workbook as the reference: imported lines are never edited, replaced or duplicated.

## Data model

| Kind | Where | Editable in Nexus |
|---|---|---|
| Workbook lines (`material_lines`) | imported verbatim, with sheet + row | No — area, foundation, description and quantity change by re-importing. Supplier, PO, expected date, unit, notes, ordered qty, receipts and archive state can be set (`material_line_ops`). |
| Materials entered in Nexus (`manual_materials`, ids `mm-…`) | Add Material / Quick Add / Duplicate | Yes, all fields. |
| Receipts (`material_receipts`, `manual_material_receipts`) | one row per delivery: qty, date, reference, note, `recorded_by` | Added by Editors; voided by Admins (history keeps it). |
| History (`material_audit`) | append-only; written by the server in the same transaction as the change | Never from the UI; a database trigger blocks updates. |
| Roles (`user_roles`, `role_audit`) | explicit assignments | Admins only. |

**Outstanding = required − total verified received.** It is unknown (shown "—") until a receipt is recorded or "nothing received" is
confirmed. A "Delivered" status (workbook or entered) is a note, never a receipt; no migration or import creates receipts.

## Roles

| | Viewer | Editor | Admin |
|---|---|---|---|
| View, search, filter, open details and history | ✔ | ✔ | ✔ |
| Add, edit, duplicate, Quick Add, bulk edit, notes, record deliveries, import workbook | | ✔ | ✔ |
| Archive/restore, void receipts, configuration, manage access, backups/migration endpoints | | | ✔ |

Rules live in `src/shared/rbac.ts` and are enforced in the Worker (`src/worker/roles.ts`, `runCommand`) on **every** mutation. The browser
only uses them to hide controls. A command that is not in the permission map needs Admin; other modules' commands need Editor.

## Identity and the first administrator

* Identity is the Cloudflare Access JWT verified in the Worker. The role is looked up in `user_roles` for that verified email.
* Being signed in grants **no** role. No role means no read and no write (HTTP 403). If `user_roles` is missing or unreadable, the result is the same.
* First administrator: set the Worker variable `INITIAL_ADMIN_EMAIL`. While the table holds no administrator, a request verified for exactly that
  email is made Admin and the event is logged. After that the variable does nothing. Alternatively insert the row yourself:
  `INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES ('you@company.com', 'admin', 'manual', datetime('now'));`
* The last administrator cannot be removed or demoted. Role changes are logged in `role_audit`.
* `DEV_BYPASS_AUTH` (localhost only) uses `DEV_BYPASS_ROLE` (default `admin`, `none` to test no access).

## Public demo

No login, no API, no database. Materials are fictional (`demoSeed.ts`), stored in this browser, restored by **Reset Demo**. The role control
there is labelled *Simulated role (demo only)*: it changes what the page shows and grants access to nothing.

## Staging checklist (what is required for real, saved data)

1. Create the staging D1 database `nexus-staging` (never the production one) and add it under `previews.d1_databases`.
2. Apply migrations `0001`–`0005` to it (`npm run db:migrate:local` locally; `wrangler d1 migrations apply` remotely).
3. Create the Cloudflare Access application for the staging hostname; set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
4. Set `INITIAL_ADMIN_EMAIL` (or insert the first admin), sign in once, then assign Editors/Viewers under **Manage access**.

Until then staging serves the browser-only view and the server paths are covered by tests only (`src/worker/__tests__/rbac.test.ts`).

## Material entry uses project records (migration 0006)

Area, foundation, anchorage type and supplier are chosen from existing records in searchable lists; typing only filters, so a value can never
be invented in the Materials form. Materials store **ids** (`area_id`, `foundation_id`, `anchorage_type_id`, `supplier_id`) and the names shown
are looked up, so renaming an area, foundation or supplier never breaks an association. The old text columns stay as the value as entered
(legacy values and a display fallback).

| List | Source of truth | Who changes it |
|---|---|---|
| Area | `areas` (construction) | Admin (Add area, with its foundations) |
| Foundation (filtered by area) | `foundations` (construction); stable id, `archived` flag | Admin: add, rename, edit, archive (Foundation Register → Add foundation / Manage) |
| Anchorage type (foundation's types first) | project anchorage library; workbook codes (`wb:<code>`) when the library has none | existing anchorage interface |
| Supplier | `suppliers` directory (unique normalised name) | Editors add; Admins rename/archive |
| Preferred supplier per category | `category_suppliers` | Admin only (Materials → Suppliers & defaults) |

* **Preferred suppliers** only pre-fill a new material. The only configured preference is Anchor bolts → Nucor (seeded by migration 0006,
  only if nothing is set). A supplier the person picks (or clears) is never replaced when the category or another field changes; a category
  with no preference leaves the field empty. Changing a preference never edits existing materials.
* **Quick Add** shares area, foundation, anchorage type and default supplier; each row may use its own category, anchorage type or supplier,
  and changing a shared default never overwrites a row's own choice. **Add & add another** keeps the shared choices.
* **Foundations**: duplicate numbers (even archived) are refused; a renamed foundation keeps its id, plinths, activities and materials;
  archiving is refused while active materials use it and hides it from pickers and the default register view without deleting anything.
* **Server checks**: `addMaterials`/`editMaterial`/`bulkEditMaterials` are validated against the server's own construction records
  (ids exist, foundation belongs to the area, not archived, supplier in the directory). `archiveFoundation` checks materials from the database.
  Foundation/area commands need Admin; adding a supplier needs Editor; preferred-supplier and directory changes need Admin.
* **Legacy values** are never rewritten. Unlinked text keeps showing; Materials shows "values not linked to project records → Review", where an
  exact, unambiguous match can be linked (one by one or "Link all exact matches") and anything else needs a record chosen.
* **Limitation**: the construction anchorage library is not stored on the server yet, so with saved data the anchorage list is the project
  library (when present) plus the workbook's anchorage codes. Editing anchorage types stays in the existing anchorage page.
* Staging checklist addition: apply migration `0006` after `0005`.
