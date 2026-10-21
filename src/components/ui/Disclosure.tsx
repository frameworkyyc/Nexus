import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/** Progressive disclosure: summary always visible, detail on demand. */
export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 py-4 text-left">
        <ChevronRight size={14} strokeWidth={1.5} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <div className="min-w-0 flex-1">{summary}</div>
      </button>
      {open && <div className="pb-6 pl-7">{children}</div>}
    </div>
  )
}
