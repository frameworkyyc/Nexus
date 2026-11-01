/**
 * Public-demo configuration. v1.0 has no public demo deployment: nexus.frameworktools.ca is the authenticated production application and no demo Worker or hostname exists.
 * The demo bundle remains only for local development (`npm run dev:demo`) and as the fail-safe build for unknown branches (scripts/bundle-mode.mjs).
 */
export const DEMO_HOSTNAMES: string[] = []

export const DEMO_LABEL = 'Demo Environment'
export const DEMO_DESCRIPTION = 'Sample data only. Everything you change is kept in this browser and never shared or saved on a server.'

/** True on the public demo bundle (always) or whenever the page is served from a listed demo hostname. */
export function isDemoHost(hostname: string): boolean {
  return DEMO_HOSTNAMES.includes(hostname.toLowerCase())
}
