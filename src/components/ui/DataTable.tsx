import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  /** Hide below the `md` breakpoint to keep mobile tables readable. */
  hideOnMobile?: boolean
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  getKey: (row: T) => string
  onRowClick?: (row: T) => void
}

export function DataTable<T>({ columns, rows, getKey, onRowClick }: Props<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="card-table w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} className={`t-label py-3 pr-6 font-medium ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line transition-colors ${onRowClick ? 'cursor-pointer hover:bg-hover' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`py-4 pr-6 align-middle text-[13px] ${c.hideOnMobile ? 'hidden md:table-cell' : ''} ${c.className ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
