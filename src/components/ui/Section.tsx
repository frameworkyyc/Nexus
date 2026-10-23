import type { ReactNode } from 'react'

export function Section({ title, description, actions, children, className = '' }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-12 ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="t-title">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-xs leading-snug text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
