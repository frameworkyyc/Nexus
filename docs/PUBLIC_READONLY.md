# Public view-only Nexus (production)

Status: **implemented and tested on the `public-readonly` branch; not deployed.** Production (`main`, nexus.frameworktools.ca) still serves the demo.

## What it is
The same Worker code, started with `NEXUS_ENV=public`. It shows the live project data held in the staging database, to anyone, read-only.

- `src/worker/publicApi.ts` — the only API in this mode. It answers `GET`/`HEAD` for `/api/health`, `/api/session` and `/api/state/<module>`; everything else is 404, every other method is 405. It never reads credentials, cookies or Access headers and shares no code path with the editing API (no roles, commands, backup, integrity or migration endpoints exist).
- `readOnlyDb` — the database handed to that API can only prepare a single `SELECT`. `run()` is refused, `batch()` accepts only statements prepared through it, and nothing else (`exec`, `dump`) is exposed.
- `src/worker/publicView.ts` — the public policy, applied to rows *before* they become application state: hidden tables (suppliers, change history), hidden columns (who did what, notes, contacts, VIN/plate, supplier and PO number, delivery references, job number, import file details), plus a last pass that removes any e-mail address in any text. A test requires every sensitive-looking column to be classified.
- The browser is told by the server (`readOnly: true`): it shows a **View only** badge, hides editing controls, the sign-in/role bar and the Data & backups tools, refuses to send commands, and re-reads the data every minute and when the tab regains focus.

## Local test
`npm run build && npm run db:migrate:local`, then `npx wrangler dev --config wrangler.public.jsonc --port 8788`.

## Going live (not done)
See `wrangler.production-public.example.jsonc` and the report that accompanied this branch.
