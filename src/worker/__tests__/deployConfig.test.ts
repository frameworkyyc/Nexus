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

describe('GitHub workflows that touch production', () => {
  const pre = readFileSync('.github/workflows/production-preflight.yml', 'utf8')
  const reach = readFileSync('.github/workflows/production-reachability.yml', 'utf8')
  const code = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

  it('the pre-flight uploads an undeployed version and never deploys, promotes or rolls back', () => {
    expect(code(pre)).toMatch(/wrangler versions upload/)
    expect(code(pre)).not.toMatch(/wrangler deploy|versions deploy|wrangler rollback|--latest|deployments? create|\/deployments/)
    expect(code(pre)).toMatch(/scripts\/preflight\.mjs/)
  })

  it('runs only for pre-flight tags or the staging branch in this repository, with read-only repository permissions', () => {
    expect(pre).toMatch(/tags: \['preflight-\*'\]/)
    expect(pre).not.toMatch(/pull_request|schedule:|workflow_run/)
    expect(pre).toMatch(/branches: \['release\/preflight'\]/) // the one dedicated branch; staging and main pushes never start it
    expect(pre).toMatch(/startsWith\(github\.ref, 'refs\/tags\/preflight-'\) \|\| github\.ref == 'refs\/heads\/release\/preflight' \|\| github\.ref == 'refs\/heads\/staging'/)
    expect(pre).not.toMatch(/inputs:/) // nothing a person types reaches a command
    expect(pre).toMatch(/permissions:\n {2}contents: read/)
    expect(pre).toMatch(/github\.repository == 'frameworkyyc\/Nexus'/)
    expect(pre).toMatch(/environment: production-preflight/)
  })

  it('uses only the Cloudflare API token and account id as secrets, and only in the steps that need them', () => {
    const used = [...code(pre).matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])
    expect(new Set(used)).toEqual(new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']))
    expect(code(pre)).not.toMatch(/WORKOS_API_KEY|SESSION_PEPPER|INITIAL_ADMIN_EMAIL/) // production secrets never pass through GitHub
    expect(code(pre)).not.toMatch(/echo[^\n]*\$\{?CLOUDFLARE_API_TOKEN/)
  })

  it('the reachability check is credential-free and read-only', () => {
    expect(code(reach)).not.toMatch(/secrets\.|environment:|wrangler|-X (POST|PUT|DELETE|PATCH)|--data/)
    expect(reach).toMatch(/tags: \['check-\*'\]/)
    expect(reach).not.toMatch(/pull_request|inputs:/)
    expect(reach).toMatch(/branches: \['release\/preflight'\]/)
  })
})

describe('production launch workflow', () => {
  const wf = readFileSync('.github/workflows/production-launch.yml', 'utf8')
  const code = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

  it('starts only from the dedicated branch and only on an explicit trigger word', () => {
    expect(code).toMatch(/branches: \['release\/preflight'\]/)
    expect(code).not.toMatch(/pull_request|schedule:|workflow_run|workflow_dispatch|tags:/)
    expect(code).toMatch(/contains\(github\.event\.head_commit\.message, '\[launch-rehearsal\]'\) \|\| contains\(github\.event\.head_commit\.message, '\[launch-production\]'\)/)
  })

  it('deploys only the pinned, pre-flighted version, never a fresh build', () => {
    expect(code).not.toMatch(/wrangler deploy(?!ments)|versions upload/)
    expect(code.match(/versions deploy/g)).toHaveLength(1)
    expect(code).toMatch(/versions deploy "\$\{TARGET_VERSION\}@100%"/)
    expect(code).toMatch(/TARGET_VERSION: '21f40bde-631a-4d13-b61b-62c5bf55286d'/)
  })

  it('keeps data out of artifacts, takes a bookmark and has rollback steps', () => {
    expect(code).not.toMatch(/upload-artifact/)
    expect(code).toMatch(/time-travel info/)
    expect(code).toMatch(/time-travel restore/)
    expect(code).toMatch(/rollback\.sql/)
    expect(code).toMatch(/wrangler rollback/)
    expect(code).toMatch(/EXPECTED_ROWS: '1234'/)
  })

  it('writes to production only in the live steps', () => {
    for (const block of code.split(/\n {6}- name: /).slice(1)) {
      if (/--remote --yes --file=migration\.sql|versions deploy/.test(block)) expect(block).toMatch(/if: env\.LIVE == 'yes'/)
    }
  })
})

describe('production release workflow', () => {
  const wf = readFileSync('.github/workflows/production-release.yml', 'utf8')
  const code = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

  it('starts only from the dedicated branch and only on an explicit trigger word', () => {
    expect(code).toMatch(/branches: \['release\/preflight'\]/)
    expect(code).not.toMatch(/pull_request|schedule:|workflow_run|workflow_dispatch|tags:/)
    expect(code).toMatch(/contains\(github\.event\.head_commit\.message, '\[release-rehearsal\]'\) \|\| contains\(github\.event\.head_commit\.message, '\[release-production\]'\)/)
  })

  it('deploys only the pinned, pre-flighted version, never a fresh build, and only in the live steps', () => {
    expect(code).not.toMatch(/wrangler deploy(?!ments)|versions upload/)
    expect(code.match(/versions deploy/g)).toHaveLength(1)
    expect(code).toMatch(/versions deploy "\$\{TARGET_VERSION\}@100%"/)
    expect(code).toMatch(/TARGET_VERSION: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/)
    for (const block of code.split(/\n {6}- name: /).slice(1)) {
      if (/--file=apply\.sql|versions deploy/.test(block)) expect(block).toMatch(/if: env\.LIVE == 'yes'/)
    }
  })

  it('records a bookmark, checks the schema first, rehearses on an export, and can roll back without touching users’ data', () => {
    expect(code).toMatch(/time-travel info/)
    expect(code).toMatch(/schema-guard\.mjs" precheck/)
    expect(code).toMatch(/d1 export/)
    expect(code).toMatch(/anchorageMigration\.test\.ts/)
    expect(code).toMatch(/DROP TABLE IF EXISTS foundation_anchorages/)
    expect(code).not.toMatch(/time-travel restore/) // a restore would also discard what users saved since; the bookmark is only named as a last resort
    expect(code).toMatch(/wrangler rollback/)
    expect(code).not.toMatch(/upload-artifact/)
  })
})
