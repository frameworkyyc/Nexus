import { Link } from 'react-router-dom'
import { CARD } from '@/components/mobile/Cards'
import { Donut } from '@/components/ui/Donut'
import { useIsPhone } from '@/lib/useMedia'
import { paths } from '../paths'
import { packageProgress, type PackageIndicator } from '../packageProgress'
import type { Index } from '../selectors'
import { useTracker } from '../tracker/store'

const TAB: Record<PackageIndicator['key'], string> = { materials: 'materials', installation: 'construction', survey: 'quality', qaqc: 'quality' }

/** Four monochrome indicators at the top of an area. Each links to its detail tab; all figures come from records. */
export function PackageDashboard({ idx, projectId, areaId }: { idx: Index; projectId: string; areaId: string }) {
  const { state: tracker } = useTracker()
  const items = packageProgress(idx, areaId, tracker)
  const phone = useIsPhone()
  if (phone) {
    // Phone: one card per indicator, the ring beside its key figures, every figure and the method still one tap away.
    return (
      <section aria-label="Package progress" className="mb-8">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <li key={p.key} className={`${CARD} p-4`}>
              <Link to={paths.area(projectId, areaId, TAB[p.key])} className="flex items-center gap-4" aria-label={`${p.title} details`}>
                <div className="shrink-0"><Donut value={p.percent} label={p.title} size={112} /></div>
                <div className="min-w-0 flex-1">
                  <span className="t-label">{p.title}</span>
                  <dl className="mt-1.5 space-y-1 text-[14px]">
                    {p.rows.map((r) => <div key={r.label}><div className="flex justify-between gap-2"><dt className="text-muted">{r.label}</dt><dd className="tabular-nums">{r.value}</dd></div>{r.note && <p className="text-[12.5px] leading-snug text-muted">{r.note}</p>}</div>)}
                  </dl>
                </div>
              </Link>
              <details className="mt-1 text-[13px] text-muted"><summary className="flex cursor-pointer items-center">How this is calculated</summary><p className="pb-2">{p.basis}</p>{p.gaps.map((g) => <p key={g} className="pb-2">{g}</p>)}</details>
            </li>
          ))}
        </ul>
      </section>
    )
  }
  return (
    <section aria-label="Package progress" className="mb-10">
      <ul className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((p) => (
          <li key={p.key}>
            <Link to={paths.area(projectId, areaId, TAB[p.key])} className="group block" aria-label={`${p.title} details`}>
              <div className="flex items-center justify-between"><span className="t-label">{p.title}</span><span className="text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Details →</span></div>
              <div className="mt-4 flex justify-center"><Donut value={p.percent} label={p.title} /></div>
            </Link>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
              {p.rows.map((r) => (
                <div key={r.label}>
                  <div className="flex justify-between gap-3"><dt className="text-muted">{r.label}</dt><dd className="tabular-nums">{r.value}</dd></div>
                  {r.note && <p className="text-[11px] leading-snug text-muted">{r.note}</p>}
                </div>
              ))}
            </dl>
            <details className="mt-2 text-[11px] leading-snug text-muted">
              <summary className="cursor-pointer select-none">How this is calculated</summary>
              <p className="mt-1">{p.basis}</p>
              {p.gaps.map((g) => <p key={g} className="mt-1">{g}</p>)}
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}
