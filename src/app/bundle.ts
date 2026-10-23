/** Which bundle this is (see vite.config.ts). 'demo' is the public, fictional-data build: it never contacts the API. */
export const BUNDLE: 'demo' | 'app' = typeof __NEXUS_BUNDLE__ === 'undefined' ? 'app' : __NEXUS_BUNDLE__
export const IS_PUBLIC_DEMO = BUNDLE === 'demo'
