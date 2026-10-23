/**
 * Patterns that identify the real organization, project, client, site, fleet or people. None may appear anywhere in the public
 * demo bundle. Used by the build (vite.config.ts) and by tests. Add a pattern here whenever real data gains a new identifier.
 */
export const DEMO_FORBIDDEN = [
  /\bREEF\b/i, /ridley/i, /altagas/i, /\bprogressive\b(?! disclosure)/i, /frameworkco\.ca/i, /hello@/i,
  /\bT60(10|05)\b/, /\bLV1(67|74)\b/, /\bMole[ -]?Sieve\b/i, /Propane BOG/i, /Locomotive Shelter/i, /\bE-House\b/i, /Piperack/i,
  /\bOP[123]-0[1-3]\b/, /\bPO-928\b/, /\bFAB-928\b/, /Dueler/i, /Bridgestone/i, /750 L/i, /\bJob 928\b/i, /nexus\.reef/i,
  /frameworkyyc/i, /11[ ,]?856/, /13[ ,]?551/,
]

export const findForbidden = (text) => DEMO_FORBIDDEN.filter((re) => re.test(text)).map((re) => re.toString())
