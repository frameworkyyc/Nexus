# Nexus

Modular project and operations management platform by Framework.

Active development happens on `staging`. `main` is the stable production branch.

## Development

```
npm install
npm run dev
npm run typecheck && npm run lint && npm run build
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

Stack: React, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide, Cloudflare Workers (static assets).
All data is fictional demonstration data kept in `src/features/projects/store.ts` (localStorage).
Navigation modules are declared in `src/app/modules.ts`.
