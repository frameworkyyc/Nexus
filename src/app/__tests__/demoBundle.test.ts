import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findForbidden } from '../../../scripts/demo-forbidden.mjs'

/** Builds a real bundle into a temp directory (a few seconds) and returns all text files in it. */
function build(bundle: 'demo' | 'app'): { ok: boolean; files: Record<string, string>; out: string } {
  const outDir = mkdtempSync(join(tmpdir(), `nexus-${bundle}-`))
  let ok = true
  let out: string
  try {
    out = execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { env: { ...process.env, NEXUS_BUNDLE: bundle }, encoding: 'utf8', stdio: 'pipe' })
  } catch (e) { ok = false; out = String((e as { stdout?: string; stderr?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '') }
  const files: Record<string, string> = {}
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name))
      else files[join(d, f.name)] = readFileSync(join(d, f.name), 'utf8')
    }
  }
  try { walk(outDir) } catch { /* nothing emitted */ }
  rmSync(outDir, { recursive: true, force: true })
  return { ok, files, out }
}

describe('public demo bundle', () => {
  it('builds, and contains nothing that identifies the real organization, project, client, site, fleet or people', () => {
    const { ok, files, out } = build('demo')
    expect(ok, out).toBe(true)
    const all = Object.values(files).join('\n')
    expect(all.length).toBeGreaterThan(100_000) // the real app, not an empty shell
    expect(findForbidden(all)).toEqual([])
    expect(all).toContain('Demo Construction Co.')
    expect(all).toContain('Demo Environment')
    expect(all).toContain('Reset Demo')
    expect(all).toContain('nexus.public-demo.') // browser-local storage, namespaced to the demo
  })

  it('has no server calls: the API client refuses and the saved-data tools are not offered', () => {
    const { files } = build('demo')
    const all = Object.values(files).join('\n')
    expect(all).toContain('The public demo does not use a server.')
    expect(all).not.toContain('Data & backups')
  })

  it('the guard has teeth: the real-data bundle trips it', () => {
    const { files } = build('app')
    expect(findForbidden(Object.values(files).join('\n')).length).toBeGreaterThan(10)
  })
}, 120_000)
