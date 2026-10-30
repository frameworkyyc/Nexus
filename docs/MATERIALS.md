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
