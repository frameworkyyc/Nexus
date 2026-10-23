#!/usr/bin/env node
// Usage: node scripts/backup-to-sql.mjs backup.json [--wipe] > restore.sql
// Verifies the backup's checksum, then prints SQL for `npx wrangler d1 execute <database> --remote --file restore.sql`.
// Needs Node 22.18+ (runs the TypeScript helper directly). See docs/OPERATIONS.md.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { backupToSql } from '../src/worker/restoreSql.ts'

const [file, ...flags] = process.argv.slice(2)
if (!file) { console.error('Usage: node scripts/backup-to-sql.mjs backup.json [--wipe] > restore.sql'); process.exit(2) }
const backup = JSON.parse(readFileSync(file, 'utf8'))
if (backup.format !== 'nexus-backup') { console.error('Not a Nexus backup file.'); process.exit(1) }
const checksum = createHash('sha256').update(JSON.stringify(backup.tables)).digest('hex')
if (checksum !== backup.checksum) { console.error('Checksum mismatch: the backup file was changed or damaged. Nothing generated.'); process.exit(1) }
process.stdout.write(backupToSql(backup, { wipe: flags.includes('--wipe') }))
