# Nexus

Modular project and operations management platform by Framework.

Active development happens on `staging`. `main` is the stable production branch.

## Development

```
npm install
npm run dev
npm run typecheck && npm run lint && npm test && npm run build
```

## Environments

One Cloudflare Worker (`nexus`), two branches — the same setup as Studio29 and LaNoir.

| Branch    | Cloudflare build command | Deploy command         | URL                          |
|-----------|--------------------------|------------------------|------------------------------|
| `main`    | `npm run build`          | `npx wrangler deploy`  | nexus.frameworktools.ca (public demo, fictional data) |
| `staging` | `npm run build`          | `npx wrangler preview` | staging.nexus.frameworktools.ca |

`wrangler preview` publishes an isolated Worker Preview named after the branch (`staging`); it never touches
the production deployment. `npm run deploy` (production) refuses to run from any branch except `main`.
Work happens on `staging`; production changes reach `main` only by approved merge.

`main` is currently the **public interactive demo** (fictional data kept in each visitor's browser, no server, no login). How that is
kept free of real data, how staging must be protected, and how the demo moves to `demo.nexus.frameworktools.ca` are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Architecture

Nexus is a reusable platform with industry packs layered on top.

```
src/
  app/                  router, module registry, tenant config        (platform)
  layout/               app shell, sidebar, top bar with route crumbs (platform)
  components/ui/        buttons, fields, tables, tabs, modal, toast   (platform)
  lib/                  dates, formatting, persisted-store factory    (platform)
  domains/construction/ the REEF construction pack
    types.ts            Company → Project → Area → Foundation → Plinth, materials, procurement, fabrication, handover
    config.ts           activity catalogue, status sets, vocabularies, default handover checklist
    seed.ts             fictional demonstration data (built relative to today)
    selectors.ts        derived state: rollups, readiness, material tables, issues, handover evaluation
    actions.ts          pure reducers that enforce the business rules
    store.ts            browser-local persistence + hooks
    pages/              dashboard, register, area, foundation, materials, fabrication, anchorage, handover
```

The platform never imports from `domains/*` except through the router. A different industry pack can supply its own
types, catalogue, seed and pages.

### Saved data (Cloudflare D1)

Fleet, Materials and Construction records are saved in a Cloudflare D1 database through the Worker in `src/worker/`, so they
persist across refreshes and devices. The browser sends each change as a tagged call of the same reducer the server re-runs
(`lib/commandTag.ts`, `shared/registry.ts`); the UI shows "saved" only once the server confirms. Cloudflare Access gates the site and
the Worker verifies its token itself, failing closed. Schema is in `migrations/`; backups, restore and the one-off browser-data
migration are in **Data & backups**. Without a configured server the app falls back to browser-local demonstration data and says so.

* Architecture, schema and the migration sequence: [docs/PERSISTENCE.md](docs/PERSISTENCE.md)
* Cloudflare setup (database, Access), backups, recovery, migrations: [docs/OPERATIONS.md](docs/OPERATIONS.md)
* Local full stack: `npm run dev:full`; tests run the real migrations on SQLite: `npm test`

There are still no user roles: whoever Cloudflare Access admits can change everything.

### Deployment notes

- One Cloudflare Worker (`nexus`). `main` is production and `staging` is the Worker Preview named `staging`, served at
  `staging.nexus.frameworktools.ca`. Production is never deployed from `staging`.
- **How to confirm a commit deployed:** the commit should show a `Workers Builds: nexus` check run (GitHub → commit → checks),
  and the Preview's newest deployment should carry the commit's short hash as its tag.
- **Repository history:** this repository (GitHub id 1424538981) was created as `Assetra` and renamed to `Nexus` on 21 Oct 2026.
  An older Cloudflare Worker named `assetra` is still connected to it and also builds every push
  (a second `Workers Builds: assetra` check). Review that connection before the first merge to `main`, because both Workers
  would otherwise build production from this repository.
- A push can be silently missed if Cloudflare's Git integration drops the event; the commit then shows a Cloudflare check
  suite that stays `queued` with no check runs. Missed events are not replayed. Re-run the build from the Cloudflare dashboard
  or push the next change.

### Fleet module

`src/domains/fleet` is a separate, organization-level pack. Vehicles are not owned by a project: each assignment stores only a
project id, so a vehicle can be reassigned or unassigned and its history is kept. Names are resolved through one adapter
(`useProjectRegistry` in `domains/fleet/store.ts`).

Two views read and write the **same records** (`nexus.demo.fleet`), through the same selectors (`fleetRow`) and reducers:

- `/fleet` — organization view for office fleet management: every vehicle, filter by project, reassign between projects.
- `/projects/:projectId/fleet` (and `/fleet/:vehicleId`) — project view for site supervisors: the vehicles currently assigned
  to that project, with quick actions. Nothing is copied; an update in one view appears in the other.

Weekly tracking (all in kilometres):

- **Odometer** readings are dated and append-only. Impossible values (zero, negative, fractional, future-dated, duplicates) are
  refused. A reading lower than an earlier one, higher than a later one, or stated as a correction is saved but **held for
  review** and does not change the current mileage until a person accepts it; a rejected reading stays in the history.
- **Service**: the next service mileage is entered by a person (history kept). KM remaining = next service − latest valid
  reading, and is blank rather than estimated when either is missing. Past due shows as overdue.
- **Weekly inspections**: a submission records that the inspection happened. It never implies the vehicle is sound: condition
  stays "Not assessed" until a reviewer states one. Submitted, reviewed and outstanding defects are shown separately; a review
  does not close defects. An inspection is flagged when none is recorded or the last is more than 7 days old.
- Seed: the four REEF vehicles. VINs, plates, mileage, schedules, inspections and maintenance are not invented.

Vehicle dashboard (`pages/VehicleDashboard.tsx`): every row in either Fleet list opens it, at `/fleet/:vehicleId` or
`/projects/:projectId/fleet/:vehicleId` (a vehicle not currently assigned to that project is not shown there). Both routes render
one component against the one record in `nexus.demo.fleet`; only the back link and breadcrumbs differ. Sections: overview and
specifications (editable), odometer, maintenance, tires, modifications and accessories, weekly inspections and defects, history.

- **T6010** carries only the supplied facts: 11,856 km (undated), next service 13,551 km (1,695 km remaining), original
  Bridgestone Dueler A/T tires installed at 0 km, and a 750 L Tidy Tank. Last oil change, tire installation date, size, tread,
  condition, studded status, accessory date/cost/warranty are shown as "Not recorded"/"Unknown". The next service is **not**
  assumed to be an oil change (its type is blank unless entered).
- **Maintenance**: a service threshold is not a completed service; only recorded maintenance counts as done. "Due soon" is
  highlighted only when a warning window has been recorded; overdue (negative KM remaining) always is. No intervals are invented.
- **Tires**: any number of sets per vehicle, one active. Classification can combine (e.g. winter + all-terrain); studded is
  yes/no/unknown; condition is "Not assessed" until set. Km on the active set = latest valid odometer − installation odometer
  (a held reading is ignored); a replaced set keeps its removal date/odometer and its frozen distance.
- **Accessories**: one record per accessory for its whole life, with placements per vehicle. Removing or transferring closes a
  placement and (for transfers) opens one on the receiving vehicle, so both vehicles keep the history.
- Saved data upgrades from v1/v2 to v3 without losing records; T6010's verified entries are added only where that part is empty.

Access rules (`domains/fleet/access.ts`) model fleet managers (all vehicles), project supervisors (update vehicles assigned
to their projects) and project users (view only, configurable later). **They are not enforced**: every
signed-in visitor acts as the fleet manager. With saved data, Cloudflare Access limits who can reach the site and the Worker
verifies its token, but nothing distinguishes one admitted person from another. Without a server (demonstration mode) there is no
sign-in at all and the data lives in this browser only. Do not describe these roles as secure until per-user authorization exists.

### Material tracker import

The REEF material tracker workbook (Material List + Anchorage Type sheets) is imported **in the browser** from
Projects → REEF → Materials (and each area's Materials tab). The file is read locally by `src/lib/xlsx.ts` and only the parsed
records are sent to the saved-data API (the workbook file itself is never uploaded). Without a server they stay in this browser
(`nexus.reef.materialTracker`, separate from the demonstration data and untouched by "Reset demo data"). The file is never bundled into the app. Workbooks are git-ignored (`*.xlsx`); keep project files out of the repository and
out of public deployments until sign-in exists.

- **Detailed requirements** (Material List A:I) become material lines, each keeping its sheet and row, verbatim component
  description, footing type, anchorage type, counts, status and cell comments. Descriptions are never renamed or merged.
- **Area summary** (K:N) is the workbook's own roll-up. It is kept only to check the totals Nexus rebuilds from the detail,
  and is never added to requirements. The Anchorage Type sheet is reference data (no area, different codes) and is also not
  counted.
- **Quantity logic**: each formula is kept and re-evaluated (`# Ftngs × # Plinths × # Bolts`, nuts/washers as a multiple of
  the bolt row, typed values). Required quantity is the workbook's value; any disagreement is flagged, not corrected.
- **Delivery**: "Delivered"/"Pending" are preserved as the workbook's claim. Received quantity is only the sum of receipts
  recorded in Nexus (partial deliveries supported). Remaining = required − received and is shown only once receipts exist or
  "nothing received" is confirmed. Ordered quantity is optional and never raises progress.
- **Materials indicator**: verified received ÷ required per line, averaged across the area's lines. It is "Not tracked" until
  a receipt is verified; "Delivered" lines without receipts count as zero and are listed separately. Fictional demo materials
  are not included.
- Ambiguous records (transposed nut/washer multipliers, embed plates multiplied by bolt count, "N/A" footing types, typed-in
  quantities, workbook comments such as "ordered as…") are flagged for review. Re-importing carries Nexus entries over.

### Information hierarchy

Company → Project → Area → Foundation. Each level shows only what belongs to it; detail is one click deeper.

| Level | Route | Shows |
|---|---|---|
| Company | `/` | Active / at-risk / delayed counts, searchable and sortable project list, significant project issues |
| Project | `/projects/:id` | Overall progress, recorded status, progress and status per area, significant issues |
| Area | `/projects/:id/areas/:area` | Construction progress vs. foundations complete, foundation breakdown and tiles, area issues; tabs for detail |
| Foundation | `.../foundations/:id` | Footing and plinth progress (editable), materials and readiness, survey, QA/QC, documents, deficiencies |

- **Project status is recorded, never inferred.** Planning / Active / At risk / Delayed / On hold / Complete is chosen by a person
  (with a reason for at risk, delayed and on hold). Without schedule baselines, completion percentage never changes a status.
- **Completion percentage:** derived from activity records for projects with detailed tracking (REEF); for summary-tracked
  demo projects it is a reported figure, labelled as such. Company issues come from recorded status notes, recorded
  project issues, and critical items derived from a detailed project's own records.
- **A completed foundation** has every rebar, forming and pouring activity complete for its footing and all plinths. This one
  definition drives the area counts, the register filter and handover. "Closed out" (survey and QA/QC complete) and
  handover are separate, later steps.
- Saved local data from earlier versions is migrated, not discarded.

### Progress calculation

- Each footing and each plinth is an element with three construction stages: rebar, forming and pouring.
  The stages count equally, and the rebar stage is split evenly between "built" and "installed" (so rebar is not
  counted twice as heavily as forming or pouring).
- Area progress = average across all elements in the area. Overall progress = average across every element
  (not an average of the area percentages), so areas with more foundations carry proportionally more weight.
- There are no quantities, hours or costs in the demo data, so there is no effort weighting. Replace this with
  quantity-based earned value when real data exists.
- Survey, QA/QC and handover are tracked separately and never change the figure.
- Handover phases: construction in progress → construction complete → handover preparation → ready for review →
  handed over. Only the last step (recorded acceptance) hands an area over.

### Key rules (covered by `npm test`)

- Progress is derived from activity records (see above); survey and QA/QC are separate measures.
- Anchor bolt, nut, washer and plywood-template statuses are derived from allocation and fabrication records.
- Receiving stock and allocating it to plinths are separate steps. Allocation cannot exceed received stock or a
  plinth's requirement, so the same inventory cannot be allocated twice.
- Fabrication enforces the workflow order (approval and authorization → cutting → pickup → site receipt).
- Handover acceptance is always a deliberate action and never follows automatically from construction completion.

### Demonstration data

Everything is fictional. From the brief: Mole Sieve foundations 21-01, 21-03 and 21-05 (plinth 1) use anchorage type
OP1-02, OP1-01 exists, and 700 × 3/4" nuts is shown as a sample requirement. All other foundations, plinths, anchorage
specifications, quantities, suppliers, purchase orders and dates are invented. Document records are placeholders and
are not approved for construction. Use **Reset demo data** to restore the seed.

## Stack

React, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide, Cloudflare Workers (static assets).
All data is fictional demonstration data kept in `src/features/projects/store.ts` (localStorage).
Navigation modules are declared in `src/app/modules.ts`.
