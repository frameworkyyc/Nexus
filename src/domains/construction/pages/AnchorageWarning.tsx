import { AlertCircle } from 'lucide-react'
import { useState } from 'react'

/** A small red icon that explains what is missing on hover, keyboard focus or tap. Renders nothing when there is nothing to say. */
export function AnchorageWarning({ issues, label = 'Anchorage not fully configured', align = 'left' }: { issues: string[]; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  if (issues.length === 0) return null
  const text = `${label}: ${issues.join('; ')}`
  return (
    <span className="relative inline-flex shrink-0">
      <button type="button" title={text} aria-label={text} aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }} onBlur={() => setOpen(false)} className="grid h-5 w-5 place-items-center text-[var(--nx-bad)]">
        <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && <span role="status" className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-6 z-20 w-64 border border-line bg-surface p-2 text-xs font-normal text-ink shadow-sm`}>{text}</span>}
    </span>
  )
}
