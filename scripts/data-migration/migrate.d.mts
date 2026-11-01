import type { DatabaseSync } from 'node:sqlite'
export interface PlanTable { table: string; pk: string; group: string; action: string; sourceRows: number; filteredOut: number; excludedByRequest: number; cascaded: number; skippedIdentical: number; insert: Record<string, unknown>[]; conflicts: string[] }
export interface Plan { order: string[]; tables: PlanTable[]; problems: string[]; groups: string[]; include: string[]; ok: boolean }
export interface PlanOptions { groups?: string[]; include?: string[]; excludeRows?: Record<string, string[]> }
export function open(path: string, opts?: { readOnly?: boolean }): DatabaseSync
export function cloneInMemory(src: DatabaseSync): DatabaseSync
export function selectTables(source: DatabaseSync, target: DatabaseSync, opts?: PlanOptions): string[]
export function buildPlan(source: DatabaseSync, target: DatabaseSync, opts?: PlanOptions): Plan
export function applyPlan(target: DatabaseSync, plan: Plan, opts?: { bumpVersions?: boolean }): void
export function verify(target: DatabaseSync, plan: Plan): { ok: boolean; checks: { ok: boolean; label: string; detail: string }[] }
export function emitSql(plan: Plan, opts?: { bumpVersions?: boolean }): string
export function emitRollbackSql(plan: Plan, opts?: { bumpVersions?: boolean }): string
export function emitVerifySql(plan: Plan): { sql: string; expected: Record<string, { rowsMigrated: number; skippedIdentical: number }> }
export function describe(plan: Plan): Record<string, unknown>[]
export function main(argv: string[]): Promise<{ plan: Plan }>
