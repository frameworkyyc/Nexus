import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { foundationTotals } from '../foundationQuantity'
import { paths } from '../paths'
import { basisFigures, basisWarning, completionOf } from '../completionBasis'
import { foundationsOf } from '../selectors'
import { useConstruction } from '../store'
import { AddAreaButton, ManageAreaButton } from './AddFoundation'
import { CompletionBasisSelector, useCompletionBasis } from './CompletionBasis'

const n = (v: number) => v.toLocaleString('en-CA')

/**
 * All of a project's areas as summary cards: footings, plinths and overall construction progress. A card opens the area's own page; areas
 * added or renamed here appear everywhere else (Foundations, Materials, Procurement, the sidebar) because those read the same area records.
 */
export function AreasPage() {
  const { projectId = '' } = useParams()
  const { state, idx } = useConstruction()
  const [showArchived, setShowArchived] = useState(false)
  const [basis] = useCompletionBasis()
  const all = state.areas.filter((a) => a.projectId === projectId).sort((a, b) => a.sequence - b.sequence)
  const archived = all.filter((a) => a.archived).length
  const areas = all.filter((a) => showArchived || !a.archived)
  const cards = areas.map((a) => {
    const foundations = foundationsOf(idx, a.id)
    const totals = foundationTotals(foundations, foundations.flatMap((f) => idx.plinthsByFoundation.get(f.id) ?? []))
    return { a, totals, progress: foundations.length ? completionOf(idx, foundations, basis) : null }
  })
  return (
    <>
      <PageHeader title="Areas" description="Every area of this project at a glance. Open an area for its foundations, construction, materials and handover." actions={<AddAreaButton projectId={projectId} prominent />} />
      {cards.length > 0 && <CompletionBasisSelector className="mb-4" />}
      {archived > 0 && <label className="mb-4 flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show {archived} archived area{archived === 1 ? '' : 's'}</label>}
      {cards.length === 0 ? (
        <EmptyState title="No areas yet" description="An area is a part of the site, such as a building or a pipe rack, that holds foundations. Add the first area to start tracking foundations, materials and procurement." action={<AddAreaButton projectId={projectId} prominent />} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Areas">
          {cards.map(({ a, totals, progress }) => (
            <li key={a.id} className={`relative rounded-nx border border-line bg-surface transition-colors hover:border-ink ${a.archived ? 'opacity-60' : ''}`}>
              <Link to={paths.area(projectId, a.id)} className="block p-5 pr-24 phone:pr-5" aria-label={`Open ${a.name}`}>
                <h2 className="truncate text-[17px] font-medium" title={a.name}>{a.name}</h2>
                <p className="mt-0.5 truncate text-xs text-muted" title={[a.identifier, a.description].filter(Boolean).join(' · ')}>{[a.identifier, a.description, a.archived ? 'Archived' : ''].filter(Boolean).join(' · ') || ' '}</p>
                <dl className="mt-5 grid grid-cols-2 gap-4">
                  <div><dt className="t-label">Footings</dt><dd className="mt-1 text-2xl font-light tabular-nums">{n(totals.physical)}</dd></div>
                  <div><dt className="t-label">Plinths</dt><dd className="mt-1 text-2xl font-light tabular-nums">{n(totals.knownPlinths)}{totals.unknownDesignations > 0 && <span className="ml-1 align-middle text-xs text-muted" title={`${totals.unknownDesignations} foundation name${totals.unknownDesignations === 1 ? ' has' : 's have'} no plinth count yet`}>+ not known</span>}</dd></div>
                </dl>
                <div className="mt-5">
                  <div className="mb-1.5 flex items-baseline justify-between text-xs"><span className="t-label">Construction progress</span><span className="tabular-nums" title={progress ? basisWarning(progress) ?? undefined : undefined}>{progress === null ? 'No foundations' : progress.percent === null ? '—' : `${progress.percent}%`}{progress?.missing && ' *'}</span></div>
                  <div className="[&>div]:w-full"><ProgressBar value={progress?.percent ?? 0} width="w-full" showValue={false} /></div>
                  {progress && <p className="mt-1.5 text-xs tabular-nums text-muted">{basisFigures(progress)}</p>}
                </div>
              </Link>
              <div className="absolute right-3 top-3 phone:static phone:px-5 phone:pb-4"><ManageAreaButton areaId={a.id} label="Edit" variant="ghost" className="!h-8 phone:!h-11" /></div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
