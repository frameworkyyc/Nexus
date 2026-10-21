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
| `main`    | `npm run build`          | `npx wrangler deploy`  | nexus.frameworkco.ca         |
| `staging` | `npm run build`          | `npx wrangler preview` | staging.nexus.frameworkco.ca |

`wrangler preview` publishes an isolated Worker Preview named after the branch (`staging`); it never touches
the production deployment. `npm run deploy` (production) refuses to run from any branch except `main`.
Work happens on `staging`; production changes reach `main` only by approved merge.

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
types, catalogue, seed and pages. There is no backend, authentication or external integration yet; swap `store.ts`
for an API client later.

### Deployment notes

- One Cloudflare Worker (`nexus`). `main` is production and `staging` is the Worker Preview named `staging`, served at
  `staging.nexus.frameworkco.ca`. Production is never deployed from `staging`.
- **How to confirm a commit deployed:** the commit should show a `Workers Builds: nexus` check run (GitHub → commit → checks),
  and the Preview's newest deployment should carry the commit's short hash as its tag.
- **Repository history:** this repository (GitHub id 1424538981) was created as `Assetra` and renamed to `Nexus` on 21 Oct 2026.
  An older Cloudflare Worker named `assetra` is still connected to it and also builds every push
  (a second `Workers Builds: assetra` check). Review that connection before the first merge to `main`, because both Workers
  would otherwise build production from this repository.
- A push can be silently missed if Cloudflare's Git integration drops the event; the commit then shows a Cloudflare check
  suite that stays `queued` with no check runs. Missed events are not replayed. Re-run the build from the Cloudflare dashboard
  or push the next change.

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
