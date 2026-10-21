# Nexus

Modular project and operations management platform by Framework.

Active development happens on `staging`. `main` is the stable production branch.

## Development

```
npm install
npm run dev         # local dev server
npm run typecheck && npm run lint && npm run build
npm run deploy   # manual deploy to the "nexus" Worker; needs Cloudflare credentials
```

Stack: React, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide, Cloudflare Workers (static assets).
All data is fictional demonstration data kept in `src/features/projects/store.ts` (localStorage).
Navigation modules are declared in `src/app/modules.ts`.
