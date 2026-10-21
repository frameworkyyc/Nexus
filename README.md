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

| Environment | Branch    | Worker          | Domain                       | Deploy command                       |
|-------------|-----------|-----------------|------------------------------|--------------------------------------|
| Staging     | `staging` | `nexus-staging` | staging.nexus.frameworkco.ca | `npx wrangler deploy --env staging`  |
| Production  | `main`    | `nexus`         | nexus.frameworkco.ca         | `npx wrangler deploy --env production` |

Build command for both: `npm run build`. Custom domains are managed in the Cloudflare dashboard.
Production changes reach `main` only by approved merge from `staging`.

Stack: React, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide, Cloudflare Workers (static assets).
All data is fictional demonstration data kept in `src/features/projects/store.ts` (localStorage).
Navigation modules are declared in `src/app/modules.ts`.
