import { ChevronRight, Lock, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { DEMO_DESCRIPTION, DEMO_LABEL } from '@/app/demoConfig'
import { useModules } from '@/app/modules'
import { useTenant } from '@/app/tenant'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useBackend } from '@/lib/dataSource'
import { resetWholeDemo } from './DemoBadge'

const PRIMARY_IDS = new Set(['dashboard', 'projects', 'fleet'])

const row = 'flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-4 text-[16px]'

/** Phone menu: secondary navigation, the demo controls and where the data lives. Primary destinations are in the bottom bar. */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const tenant = useTenant()
  const { mode, environment, readOnly } = useBackend()
  const modules = useModules()
  const secondary = modules.filter((m) => m.path && !PRIMARY_IDS.has(m.id))
  const planned = modules.filter((m) => !m.path)
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
        {secondary.map(({ id, label, icon: Icon, path }) => (
          <li key={id}><Link to={path!} onClick={onClose} className={row}><span className="flex items-center gap-3"><Icon size={20} strokeWidth={1.5} />{label}</span><ChevronRight size={18} strokeWidth={1.5} className="text-muted" /></Link></li>
        ))}
      </ul>
      <p className="t-label px-4 pb-1 pt-5">Planned modules</p>
      <ul>
        {planned.map(({ id, label, icon: Icon }) => (
          <li key={id} className={`${row} text-muted`}><span className="flex items-center gap-3"><Icon size={20} strokeWidth={1.5} />{label}</span><span className="flex items-center gap-1.5 text-[13px]"><Lock size={13} strokeWidth={1.5} />Coming soon</span></li>
        ))}
      </ul>
      <div className="px-4 py-5 text-[14px] text-muted">
        <p className="font-medium text-ink">{tenant.organization || 'Nexus'}</p>
        <p className="mt-0.5">{readOnly ? 'View only · live project data' : mode === 'server' ? `Saved project data${environment ? ` · ${environment}` : ''}` : IS_PUBLIC_DEMO ? 'Sample data kept in this browser only' : 'Demonstration data · fictional records'}</p>
      </div>
    </BottomSheet>
  )
}
