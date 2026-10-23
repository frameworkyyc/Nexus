import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

/** Stops the page behind a sheet from scrolling while it is open (and restores it afterwards). */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [active])
}

/**
 * A mobile bottom sheet: slides up from the bottom, scrolls internally, respects the home-indicator safe area and closes on backdrop
 * tap, the close button or Escape. `full` makes it fill the screen (used for long forms).
 */
export function BottomSheet({ title, onClose, children, full = false, footer }: { title: string; onClose: () => void; children: ReactNode; full?: boolean; footer?: ReactNode }) {
  useScrollLock()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="nx-fade absolute inset-0 bg-ink/45" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={`nx-sheet relative flex w-full flex-col bg-surface outline-none ${full ? 'h-[100dvh]' : 'max-h-[88dvh] rounded-t-2xl'}`}>
        {!full && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-neutral-300" aria-hidden="true" />}
        <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 ${full ? 'pt-safe min-h-14' : 'min-h-14'}`}>
          <h2 className="t-title min-w-0 truncate">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid h-11 w-11 shrink-0 place-items-center text-muted hover:text-ink"><X size={22} strokeWidth={1.5} /></button>
        </div>
        <div data-sheet-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer ? <div className="pb-safe shrink-0 border-t border-line bg-surface px-4 py-3">{footer}</div> : <div className="pb-safe" />}
      </div>
    </div>
  )
}
