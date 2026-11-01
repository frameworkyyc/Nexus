import { describe, expect, it } from 'vitest'
import { resolveBundle } from '../../../scripts/bundle-mode.mjs'

describe('which bundle a build produces', () => {
  it('is the real-data app for local builds and tests', () => {
    expect(resolveBundle({})).toBe('app')
  })

  it('on Cloudflare, only staging and main (production) build the application', () => {
    for (const branch of ['staging', 'main']) expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: branch })).toBe('app')
  })

  it('on Cloudflare, every other branch builds the public demo', () => {
    for (const branch of ['ci-probe', 'feature/x', 'Staging', 'Main', 'staging-2', 'release/public-demo', '']) expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: branch })).toBe('demo')
    expect(resolveBundle({ WORKERS_CI: '1' })).toBe('demo') // branch variable missing: fail safe
  })

  it('an explicit NEXUS_BUNDLE wins, but only for known values', () => {
    expect(resolveBundle({ NEXUS_BUNDLE: 'demo' })).toBe('demo')
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', NEXUS_BUNDLE: 'demo' })).toBe('demo') // the demo Worker builds from main with the demo bundle
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', NEXUS_BUNDLE: 'app' })).toBe('app')
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', NEXUS_BUNDLE: 'nonsense' })).toBe('app') // unknown value: the branch decides (main is production)
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature/x', NEXUS_BUNDLE: 'nonsense' })).toBe('demo')
  })
})
