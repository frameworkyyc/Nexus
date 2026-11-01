import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEMO_HOSTNAMES } from '@/app/demoConfig'
import { releaseGate } from '../../../scripts/release-gate.mjs'

/** wrangler.jsonc is JSON with comments; strip them (not inside strings) and parse. */
const jsonc = (file: string) => {
  let out = ''
  let inString = false
  const text = readFileSync(file, 'utf8')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) { out += c; if (c === '\\') out += text[++i]; else if (c === '"') inString = false; continue }
    if (c === '"') { inString = true; out += c; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue }
    out += c
  }
  return JSON.parse(out) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

const PROD_DB = 'd3f3ed8d-618b-4f00-82e3-52bfefae1245'
const STAGING_DB = '8efc35c6-e125-4c17-99b4-92ba89672150'
const WORKOS_PRODUCTION_CLIENT = 'client_01M6BZ6XSCEHJM3P69FW4C2T9S'
const WORKOS_STAGING_CLIENT = 'client_01M6BZ6XE05EJFK8663JRZ14ES'
const SECRET_NAMES = ['WORKOS_API_KEY', 'SESSION_PEPPER', 'INITIAL_ADMIN_EMAIL']

describe('production configuration (wrangler.jsonc, deployed from main)', () => {
  const cfg = jsonc('wrangler.jsonc')
  const prod = cfg.vars

  it('is the production environment, signing in with WorkOS for this hostname and nothing else', () => {
    expect(cfg.name).toBe('nexus')
    expect(prod).toMatchObject({ NEXUS_ENV: 'production', AUTH_PROVIDER: 'workos', WORKOS_CLIENT_ID: WORKOS_PRODUCTION_CLIENT, APP_BASE_URL: 'https://nexus.frameworktools.ca' })
    expect(prod.WORKOS_CLIENT_ID).not.toBe(WORKOS_STAGING_CLIENT)
    expect(Object.keys(prod).filter((k) => k.startsWith('ACCESS_') || k === 'DEV_BYPASS_AUTH' || k === 'DEV_BYPASS_ROLE')).toEqual([]) // no Cloudflare Access, no bypass
  })

  it('binds the production database and only that one', () => {
    expect(cfg.d1_databases).toEqual([expect.objectContaining({ binding: 'DB', database_name: 'nexus-production', database_id: PROD_DB })])
    expect(JSON.stringify(cfg.d1_databases)).not.toContain(STAGING_DB)
  })

  it('keeps every secret out of the repository', () => {
    const text = readFileSync('wrangler.jsonc', 'utf8')
    for (const name of SECRET_NAMES) expect(Object.keys(prod), name).not.toContain(name)
    expect(text).not.toMatch(/sk_(test|live)_/)
    expect(text).not.toMatch(/"WORKOS_API_KEY"|"SESSION_PEPPER"/)
    expect(Object.keys(cfg.previews.vars)).not.toEqual(expect.arrayContaining(['WORKOS_API_KEY', 'SESSION_PEPPER']))
  })

  it('serves only the API through the Worker, and the application as static files', () => {
    expect(cfg.assets).toMatchObject({ directory: './dist', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] })
  })
})

describe('staging configuration (previews in wrangler.jsonc)', () => {
  const cfg = jsonc('wrangler.jsonc')
  const staging = cfg.previews

  it('stays on Cloudflare Access with the staging database, and has no WorkOS settings', () => {
    expect(staging.vars).toMatchObject({ NEXUS_ENV: 'staging', AUTH_PROVIDER: 'access' })
    expect(staging.vars.ACCESS_TEAM_DOMAIN).toMatch(/^https:\/\/.+\.cloudflareaccess\.com$/)
    expect(staging.vars.ACCESS_AUD).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(staging.vars).filter((k) => k.startsWith('WORKOS_') || k === 'APP_BASE_URL')).toEqual([])
    expect(staging.d1_databases).toEqual([expect.objectContaining({ binding: 'DB', database_name: 'nexus-staging', database_id: STAGING_DB })])
    expect(JSON.stringify(staging)).not.toContain(PROD_DB)
    expect(JSON.stringify(staging)).not.toContain(WORKOS_PRODUCTION_CLIENT)
  })

  it('does not share a database id with production', () => {
    expect(PROD_DB).not.toBe(STAGING_DB)
    expect(JSON.stringify(cfg.d1_databases)).not.toContain(STAGING_DB)
  })
})

describe('there is no public demo deployment', () => {
  it('has no demo Worker configuration, script or hostname', () => {
    expect(existsSync('wrangler.demo.jsonc')).toBe(false)
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
    expect(Object.keys(scripts).filter((k) => /deploy.*demo|demo.*deploy/.test(k))).toEqual([])
    expect(readFileSync('wrangler.jsonc', 'utf8')).not.toMatch(/nexus-demo|demo\.nexus/)
    expect(DEMO_HOSTNAMES).toEqual([]) // the production host is never treated as a demo
  })

  it('deploys production only from main', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
    expect(scripts.deploy).toContain('guard-production.mjs')
    expect(scripts.build.startsWith('node scripts/release-gate.mjs')).toBe(true)
  })
})

describe('release gate: merging to main must not deploy production', () => {
  const ci = (branch: string, extra: Record<string, string> = {}) => releaseGate({ WORKERS_CI: '1', WORKERS_CI_BRANCH: branch, ...extra })

  it('stops a Cloudflare build of main until the release is approved', () => {
    expect(ci('main').ok).toBe(false)
    expect(ci('main').message).toMatch(/NEXUS_RELEASE_APPROVED=yes/)
    expect(ci('main', { NEXUS_RELEASE_APPROVED: 'true' }).ok).toBe(false) // only the exact value approves
    expect(ci('main', { NEXUS_RELEASE_APPROVED: 'yes' })).toMatchObject({ ok: true, approved: true })
  })

  it('never affects staging, other branches, local builds or GitHub Actions', () => {
    for (const branch of ['staging', 'feature/x', 'Main', '']) expect(ci(branch).ok, branch).toBe(true)
    expect(releaseGate({}).ok).toBe(true)
    expect(releaseGate({ WORKERS_CI_BRANCH: 'main' }).ok).toBe(true) // not on Cloudflare (no WORKERS_CI)
  })

  it('is what `npm run build` runs first, and exits non-zero when it stops a build', () => {
    const run = (env: Record<string, string>) => spawnSync('node', ['scripts/release-gate.mjs'], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
    expect(run({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' }).status).toBe(1)
    expect(run({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', NEXUS_RELEASE_APPROVED: 'yes' }).status).toBe(0)
    expect(run({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'staging' }).status).toBe(0)
  })
})
