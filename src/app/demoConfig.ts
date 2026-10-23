/**
 * Public-demo configuration, in one place so the demo can move to its own hostname without touching the app.
 *
 * Today the whole site is the demo (hostname below). When the main domain becomes the authenticated production application:
 *   1. Attach `demo.nexus.frameworktools.ca` to the demo deployment and list it in `DEMO_HOSTNAMES`.
 *   2. Build the authenticated site WITHOUT the demo bundle (see docs/DEPLOYMENT.md) and put Cloudflare Access in front of it.
 *   3. Change the Worker variable NEXUS_ENV for the demo deployment to "demo" and for production back to "production".
 * Nothing else in the app refers to a hostname.
 */
export const DEMO_HOSTNAMES = ['nexus.frameworktools.ca']

export const DEMO_LABEL = 'Demo Environment'
export const DEMO_DESCRIPTION = 'Sample data only. Everything you change is kept in this browser and never shared or saved on a server.'

/** True on the public demo bundle (always) or whenever the page is served from a listed demo hostname. */
export function isDemoHost(hostname: string): boolean {
  return DEMO_HOSTNAMES.includes(hostname.toLowerCase())
}
