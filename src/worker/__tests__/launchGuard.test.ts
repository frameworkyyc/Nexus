import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'guard-'))
const run = (live: unknown) => {
  writeFileSync(join(dir, 'live.json'), JSON.stringify(live))
  writeFileSync(join(dir, 'want.json'), JSON.stringify({ companies: 1, projects: 2 }))
  return spawnSync('node', ['scripts/launch-guard.mjs', 'compare', join(dir, 'live.json'), join(dir, 'want.json')], { encoding: 'utf8' })
}
const count = (t: string, n: number) => ({ success: true, results: [{ t, n }] })

describe('launch guard: live verification', () => {
  it('passes with the empty foreign_key_check block present or omitted', () => {
    expect(run([{ success: true, results: [] }, count('companies', 1), count('projects', 2)]).status).toBe(0)
    expect(run([count('companies', 1), count('projects', 2)]).status).toBe(0) // block omitted by D1: no false violation
  })
  it('fails on a real foreign-key violation and names the table only', () => {
    const r = run([{ success: true, results: [{ table: 'foundations', rowid: 3, parent: 'areas', fkid: 0 }] }, count('companies', 1), count('projects', 2)])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/1 foreign-key violation.*foundations/)
  })
  it('fails on a count mismatch', () => {
    const r = run([{ success: true, results: [] }, count('companies', 1), count('projects', 3)])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/projects \(live 3, expected 2\)/)
  })
})
