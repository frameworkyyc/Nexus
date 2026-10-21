import { STATUS_LABEL, type ProjectStatus } from '@/features/projects/types'

// Semantic colour is used only for the dot; the label stays neutral.
const dot: Record<ProjectStatus, string> = {
  planning: 'bg-info',
  active: 'bg-ok',
  'on-hold': 'bg-warn',
  completed: 'bg-neutral-400',
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px w-24 bg-line sm:w-32" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="-mt-px h-0.5 bg-ink" style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 text-[13px] tabular-nums text-muted">{value}%</span>
    </div>
  )
}
