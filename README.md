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

### Key rules (covered by `npm test`)

- Progress is derived from activity records. Physical progress counts forming, pouring and rebar activities equally;
  survey and QA/QC are separate measures.
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
