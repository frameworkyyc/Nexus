import { constructionFromRows, constructionToRows } from './repo/construction'
import { fleetFromRows, fleetToRows } from './repo/fleet'
import { materialsFromRows, materialsToRows } from './repo/materials'
import { tablesOf, TABLES, type Row, type RowSet, type TableDef } from './db'
import type { ModuleName } from '@/shared/registry'
import type { TrackerState } from '@/domains/construction/tracker/types'

export interface WriteContext {
  prevRows: RowSet
  isImport: boolean
  importBatchId?: string
}

/** How a module's saved records map to and from tables. `state` is the shape the shared reducers and selectors use. */
export interface ModuleSpec {
  name: ModuleName
  tables: TableDef[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fromRows(rows: RowSet): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toRows(state: any, ctx: WriteContext): RowSet
}

const companies = TABLES.filter((t) => t.name === 'companies')

const prevBatches = (rows: RowSet): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const t of ['material_lines', 'workbook_summary_rows', 'anchorage_sheet_rows', 'import_flags']) for (const r of rows[t] ?? []) out[`${t}:${r.id}`] = String(r.batch_id)
  return out
}

export const MODULES: Record<ModuleName, ModuleSpec> = {
  fleet: { name: 'fleet', tables: tablesOf('fleet'), fromRows: fleetFromRows, toRows: (state) => fleetToRows(state) },
  construction: { name: 'construction', tables: [...companies, ...tablesOf('construction')], fromRows: constructionFromRows, toRows: (state) => constructionToRows(state) },
  materials: {
    name: 'materials',
    tables: tablesOf('materials'),
    fromRows: materialsFromRows,
    toRows: (state: TrackerState, ctx) => {
      const batches: Row[] = ctx.prevRows.material_import_batches ?? []
      const current = ctx.isImport ? ctx.importBatchId ?? '' : String(batches.at(-1)?.id ?? '')
      return materialsToRows(state, { batches, currentBatchId: current, isImport: ctx.isImport, prevBatch: prevBatches(ctx.prevRows) })
    },
  },
}
