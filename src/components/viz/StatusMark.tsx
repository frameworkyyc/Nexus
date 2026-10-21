import { AlertTriangle, CheckCircle2, HelpCircle, Info, XOctagon } from 'lucide-react'
import { STATUS_COLOR, type Status } from './status'

const ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XOctagon, unknown: HelpCircle, info: Info } as const

/** Status glyph + text. The glyph shape differs per status so it reads without colour. */
export function StatusMark({ status, label, size = 15, className = '' }: { status: Status; label: string; size?: number; className?: string }) {
  const Icon = ICON[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${className}`} style={{ color: STATUS_COLOR[status] }} data-status={status}>
      <Icon size={size} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span>{label}</span>
    </span>
  )
}
