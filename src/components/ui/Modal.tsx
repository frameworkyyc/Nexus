import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsPhone } from '@/lib/useMedia'
import { BottomSheet, useScrollLock } from './BottomSheet'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** A form panel capped at a comfortable reading width (about 880px) however large the screen. */
  form?: boolean
}

/**
 * Form panel. On desktop and tablet it is the right-hand panel; on a phone it becomes a full-screen sheet with a large close button,
 * safe-area padding and a floating primary action, so long forms are comfortable one-handed. Same content, same callbacks.
 */
export function Modal({ title, onClose, children, wide, form }: Props) {
  const phone = useIsPhone()
  // Rendered at the end of <body>, not where it was opened: a form opened from inside a table cell must not inherit that cell's alignment,
  // truncation or width rules.
  const panel = phone ? <BottomSheet title={title} onClose={onClose} full>{children}</BottomSheet> : <SidePanel title={title} onClose={onClose} wide={wide} form={form}>{children}</SidePanel>
  return createPortal(panel, document.body)
}

function SidePanel({ title, onClose, children, wide, form }: Props) {
  useScrollLock(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className={`relative flex h-full w-full ${form ? 'max-w-[880px]' : wide ? 'max-w-3xl' : 'max-w-lg'} flex-col bg-surface`}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
          <h2 className="t-title">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
