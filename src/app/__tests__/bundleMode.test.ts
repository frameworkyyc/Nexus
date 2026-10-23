import { describe, expect, it } from 'vitest'
import { resolveBundle } from '../../../scripts/bundle-mode.mjs'

describe('which bundle a build produces', () => {
  it('is the real-data app for local builds and tests', () => {
    expect(resolveBundle({})).toBe('app')
  })

  it('on Cloudflare, only the staging branch builds the real-data app', () => {
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'staging' })).toBe('app')
  })

  it('on Cloudflare, main and every other branch build the public demo', () => {
    for (const branch of ['main', 'ci-probe', 'feature/x', 'Staging', 'staging-2', '']) expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: branch })).toBe('demo')
    expect(resolveBundle({ WORKERS_CI: '1' })).toBe('demo') // branch variable missing: fail safe
  })

  it('an explicit NEXUS_BUNDLE wins, but only for known values', () => {
    expect(resolveBundle({ NEXUS_BUNDLE: 'demo' })).toBe('demo')
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', NEXUS_BUNDLE: 'app' })).toBe('app')
    expect(resolveBundle({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', NEXUS_BUNDLE: 'nonsense' })).toBe('demo')
  })
})
