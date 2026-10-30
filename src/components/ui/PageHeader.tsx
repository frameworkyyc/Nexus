import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="t-display">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">{actions}</div>}
    </div>
  )
}
