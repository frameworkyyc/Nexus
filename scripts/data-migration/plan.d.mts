export interface TableClass { action: 'migrate' | 'review' | 'exclude'; group?: string; reason: string; merge?: string; filter?: string; viaGroup?: boolean }
export const GROUPS: Record<string, string>
export const GROUP_MODULE: Record<string, string>
export const TABLES: Record<string, TableClass>
export const LOGICAL_REFS: { table: string; column: string; parent: string; alsoIn?: string[]; skip?: (v: unknown) => boolean }[]
