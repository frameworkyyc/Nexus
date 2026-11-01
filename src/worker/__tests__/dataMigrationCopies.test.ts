import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { checkIntegrity, readModule } from '../service'
import { MODULE_NAMES } from '@/shared/registry'
import { d1Over } from './sqliteD1'

/**
 * Application-level check of a REAL migration rehearsal. Skipped unless MIGRATION_SOURCE_DB and MIGRATION_TARGET_DB point at local SQLite copies (never at live databases):
 *   MIGRATION_SOURCE_DB=/tmp/mig/staging.sqlite MIGRATION_TARGET_DB=/tmp/mig/prod-a.sqlite npx vitest run src/worker/__tests__/dataMigrationCopies.test.ts
 * It loads each module with the application's own readers and runs its integrity check on the migrated copy. Set MIGRATION_EXPECT_EQUAL=construction,materials,fleet (the migrated
 * modules, with no rows excluded by request) to also require the state to equal the source's state.
 */
const SOURCE = process.env.MIGRATION_SOURCE_DB
const TARGET = process.env.MIGRATION_TARGET_DB
const EQUAL = (process.env.MIGRATION_EXPECT_EQUAL ?? '').split(',').filter(Boolean)

describe.skipIf(!SOURCE || !TARGET)('a migrated copy, read by the application', () => {
  const src = () => d1Over(new DatabaseSync(SOURCE as string, { readOnly: true }))
  const tgt = () => d1Over(new DatabaseSync(TARGET as string, { readOnly: true }))

  it('passes the application integrity check', async () => {
    const report = await checkIntegrity(tgt())
    expect(report.checks.filter((c) => !c.ok), JSON.stringify(report.checks.filter((c) => !c.ok))).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('every module loads', async () => {
    for (const m of MODULE_NAMES) expect((await readModule(tgt(), m)).state, m).toBeTruthy()
  })

  it('the migrated modules read exactly as they did on the source', async () => {
    for (const m of EQUAL) {
      const a = (await readModule(src(), m as never)).state
      const b = (await readModule(tgt(), m as never)).state
      expect(b, `${m} state differs from the source`).toEqual(a)
    }
  })
})
