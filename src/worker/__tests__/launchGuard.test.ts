import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'guard-'))
const run = (live: unknown, fk: unknown = [{ success: true, results: [] }]) => {
  writeFileSync(join(dir, 'live.json'), JSON.stringify(live))
  writeFileSync(join(dir, 'fk.json'), JSON.stringify(fk))
  writeFileSync(join(dir, 'want.json'), JSON.stringify({ companies: 1, projects: 2 }))
  return spawnSync('node', ['scripts/launch-guard.mjs', 'compare', join(dir, 'live.json'), join(dir, 'want.json'), join(dir, 'fk.json')], { encoding: 'utf8' })
}
const count = (t: string, n: number) => ({ success: true, results: [{ t, n }] })
const union = (c: number, p: number) => [{ success: true, results: [{ t: 'companies', n: c }, { t: 'projects', n: p }] }]

describe('launch guard: live verification', () => {
  it('passes with one UNION result block and an empty foreign_key_check', () => {
    expect(run(union(1, 2)).status).toBe(0)
    expect(run([count('companies', 1), count('projects', 2)]).status).toBe(0)
  })
  it('fails on a real foreign-key violation and names the table only', () => {
    const r = run(union(1, 2), [{ success: true, results: [{ table: 'foundations', rowid: 3, parent: 'areas', fkid: 0 }] }])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/1 foreign-key violation.*foundations/)
  })
  it('fails on a count mismatch', () => {
    const r = run(union(1, 3))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/projects \(live 3, expected 2\)/)
  })
  it('builds one UNION query from the expected counts', () => {
    writeFileSync(join(dir, 'want.json'), JSON.stringify({ companies: {}, projects: {} }))
    const r = spawnSync('node', ['scripts/launch-guard.mjs', 'verify-sql', join(dir, 'want.json')], { encoding: 'utf8' })
    expect(r.stdout.trim()).toBe(`SELECT 'companies' AS t, count(*) AS n FROM "companies" UNION ALL SELECT 'projects' AS t, count(*) AS n FROM "projects"`)
  })
})
