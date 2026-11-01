// Production release gate. Merging to `main` must never deploy production by itself: on Cloudflare's build service a build of `main` FAILS (so nothing is deployed)
// unless the release has been explicitly approved by setting the build variable NEXUS_RELEASE_APPROVED=yes (Workers & Pages → nexus → Settings → Build → Variables) and the build is retried.
// Every other branch, and every local or GitHub Actions build, is unaffected. docs/RELEASE-v1.0.md.
export function releaseGate(env) {
  if (!env.WORKERS_CI || env.WORKERS_CI_BRANCH !== 'main') return { ok: true }
  if (env.NEXUS_RELEASE_APPROVED === 'yes') return { ok: true, approved: true }
  return { ok: false, message: 'Production release is not approved. This build of `main` was stopped on purpose so merging cannot deploy production. To release, set the build variable NEXUS_RELEASE_APPROVED=yes for the nexus Worker and retry the build (docs/RELEASE-v1.0.md).' }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = releaseGate(process.env)
  if (!r.ok) { console.error(r.message); process.exit(1) }
}
