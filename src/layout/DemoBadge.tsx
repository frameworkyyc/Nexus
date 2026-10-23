import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEMO_DESCRIPTION, DEMO_LABEL } from '@/app/demoConfig'
import { resetDemoData } from '@/domains/construction/store'
import { resetTrackerData } from '@/domains/construction/tracker/store'
import { resetFleetDemoData } from '@/domains/fleet/store'

/** Restores every module to its original sample data. Only touches this browser's own copy. */
export function resetWholeDemo() {
  resetDemoData()
  resetFleetDemoData()
  resetTrackerData()
}

/** A quiet "Demo Environment" marker with a Reset Demo action. Shown wherever the app is running on sample data. */
export function DemoBadge() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const reset = () => {
    if (!window.confirm('Reset the demo? All sample data returns to its original state and your changes are lost.')) return
    resetWholeDemo()
    setOpen(false)
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-ink hover:text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--nx-info)]" aria-hidden="true" />
        {DEMO_LABEL}
      </button>
      {open && (
        <div role="dialog" aria-label={DEMO_LABEL} className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-surface p-4 shadow-lg">
          <p className="text-[13px] font-medium">{DEMO_LABEL}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{DEMO_DESCRIPTION}</p>
          <button type="button" onClick={reset} className="mt-3 inline-flex h-8 items-center gap-2 rounded-nx border border-line px-3 text-[13px] font-medium transition-colors hover:border-ink">
            <RotateCcw size={13} strokeWidth={1.5} />Reset Demo
          </button>
        </div>
      )}
    </div>
  )
}
