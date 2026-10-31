# Public view-only Nexus (production)

Status: **implemented and tested on the `public-readonly` branch; not deployed.** Production (`main`, nexus.frameworktools.ca) still serves the demo.

## Architecture

```
 staging (editable, behind Cloudflare Access)            private R2 bucket                 production (public, view only)
 ┌──────────────────────────────────────┐   put    ┌──────────────────────────┐   get   ┌──────────────────────────────┐
 │ Worker `nexus` preview + D1 staging  │ ───────► │ nexus-public-snapshot    │ ◄────── │ Worker `nexus`, NEXUS_ENV=   │
 │ after every successful change        │          │  └ snapshot.json (1 file)│         │ public: R2 read + assets only│
 └──────────────────────────────────────┘          └──────────────────────────┘         └──────────────────────────────┘
        ▲ scheduled fallback (every 5 min)                    ▲
 ┌──────┴───────────────────────────────┐   put               │
 │ Worker `nexus-publisher` (no address)│ ───────────────────┘
 │ D1 staging (SELECT only) + R2 write  │
 └──────────────────────────────────────┘
```

- **Staging is the only editable source of truth.** Nothing writes to its database except staging's own signed-in API.
- **The snapshot** (`src/worker/snapshot.ts`) is one JSON document holding the three modules, built through the public policy (`publicView.ts`) and checked before it is written (well formed, no e-mail address). One object, replaced in a single write, so readers never see a half-updated set.
- **Immediate refresh:** after every successful command or migration, staging publishes in the background (`waitUntil`). A failure there never affects the change.
- **Fallback for missed updates:** the `nexus-publisher` Worker runs every 5 minutes. It compares the database's module versions with those recorded on the snapshot object and republishes if they differ, if there is no snapshot, or if the snapshot is older than 30 minutes (which also catches edits made outside Nexus's commands). When nothing changed it costs a handful of reads and writes nothing.
- **Production has no database binding.** Its only data source is the read side of the bucket. Its only bindings are `PUBLIC_SNAPSHOT` (R2) and `ASSETS`; it has no Access, admin or credential settings. The public API is `src/worker/publicApi.ts`: GET/HEAD only, three routes (`/api/health`, `/api/session`, `/api/state/<module>`), no sign-in, no roles, no commands, no backup/integrity/migration endpoints.
- **Noindex:** every public API response and every page carries `X-Robots-Tag: noindex, nofollow, noarchive` and the security headers; `/robots.txt` disallows everything. Setting `PUBLIC_INDEXABLE=true` later lifts both. Pages get the headers because production routes every request through the Worker (`assets.run_worker_first: true`).
- **The public demo** is a separate build (`NEXUS_ENV=demo`): its API is switched off before any binding is considered.

## What is excluded from the snapshot
Suppliers and the change history (tables), who created/recorded/received/reviewed anything, all notes and free-text reasons, contacts, VIN and licence plate, supplier and PO number, delivery references, job number, import file details, and any e-mail address anywhere. `public.test.ts` fails if a new column that looks sensitive is not classified.

## Local test
`npm run build && npm run db:migrate:local`; run the editable app (`npx wrangler dev --config wrangler.dev.jsonc --port 8787`) and make any change; then stop it and run the public site (`npx wrangler dev --config wrangler.public.jsonc --port 8788`). The local public Worker lists no D1 binding.

## Deployment (not done) — see the report that accompanied this branch
Config files: `wrangler.production-public.example.jsonc` (what main's config becomes), `wrangler.publisher.jsonc` (the fallback publisher), and the `previews` addition for staging described in the example file.
