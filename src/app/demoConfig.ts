/**
 * Public-demo configuration, in one place so the demo can move to its own hostname without touching the app.
 *
 * The public demo is its own Worker (`nexus-demo`, wrangler.demo.jsonc) on `demo.nexus.frameworktools.ca`. The production application
 * (`nexus`, nexus.frameworktools.ca) is a different Worker, bundle and database and must never be listed here.
 * Nothing else in the app refers to a hostname.
 */
export const DEMO_HOSTNAMES = ['demo.nexus.frameworktools.ca']

export const DEMO_LABEL = 'Demo Environment'
export const DEMO_DESCRIPTION = 'Sample data only. Everything you change is kept in this browser and never shared or saved on a server.'

/** True on the public demo bundle (always) or whenever the page is served from a listed demo hostname. */
export function isDemoHost(hostname: string): boolean {
  return DEMO_HOSTNAMES.includes(hostname.toLowerCase())
}
