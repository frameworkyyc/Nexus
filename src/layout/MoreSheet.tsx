import { ChevronRight, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { DEMO_DESCRIPTION, DEMO_LABEL } from '@/app/demoConfig'
import { moreItems } from '@/app/moreItems'
import { useProjectContext } from '@/app/projectContext'
import { useTenant } from '@/app/tenant'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useBackend } from '@/lib/dataSource'
import { resetWholeDemo } from './DemoBadge'

const row = 'flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-4 text-[16px]'

/** Phone menu: everything that is not one of the four sections in the bottom bar, the demo controls and where the data lives. Primary destinations are in the bottom bar. */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const tenant = useTenant()
  const { mode, environment } = useBackend()
  const { projectId } = useProjectContext()
  const items = moreItems(projectId, mode === 'server')
  const reset = () => {
    if (!window.confirm('Reset the demo? All sample data returns to its original state and your changes are lost.')) return
    resetWholeDemo()
    onClose()
  }
  return (
    <BottomSheet title="Menu" onClose={onClose}>
      {IS_PUBLIC_DEMO && (
        <section className="border-b border-line px-4 py-4" aria-label={DEMO_LABEL}>
          <p className="flex items-center gap-2 text-[16px] font-medium"><span className="h-2 w-2 rounded-full bg-[var(--nx-info)]" aria-hidden="true" />{DEMO_LABEL}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{DEMO_DESCRIPTION}</p>
          <button type="button" onClick={reset} className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-nx border border-line text-[16px] font-medium hover:border-ink"><RotateCcw size={16} strokeWidth={1.5} />Reset Demo</button>
        </section>
      )}
      <ul>
        {items.map(({ id, label, icon: Icon, to }) => (
          <li key={id}><Link to={to} onClick={onClose} className={row}><span className="flex items-center gap-3"><Icon size={20} strokeWidth={1.5} />{label}</span><ChevronRight size={18} strokeWidth={1.5} className="text-muted" /></Link></li>
        ))}
      </ul>
      <div className="px-4 py-5 text-[14px] text-muted">
        <p className="font-medium text-ink">{tenant.organization || 'Nexus'}</p>
        <p className="mt-0.5">{mode === 'server' ? `Saved project data${environment ? ` · ${environment}` : ''}` : IS_PUBLIC_DEMO ? 'Sample data kept in this browser only' : 'Demonstration data · fictional records'}</p>
      </div>
    </BottomSheet>
  )
}
