import { identity } from '@/app/identity'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs } from '@/components/ui/Tabs'
import { formatDate } from '@/lib/format'
import { useIsServer } from '@/lib/dataSource'
import { useConstruction } from '../store'
import { acknowledgeFlag, clearTracker } from './commands'
import { ImportButton } from './ImportModal'
import { useAccess } from '@/lib/access'
import { AccessBar } from './manage/AccessBar'
import { AddMaterialModal, blankMaterial } from './manage/AddMaterialModal'
import { useMaterialRefs } from './manage/useMaterialRefs'
import { resolveLines } from './catalog'
import { useParams } from 'react-router-dom'
import { MaterialsManager } from './manage/MaterialsManager'
import { MaterialsByArea } from './manage/MaterialsByArea'
import { allLines, areaSummary, distinct, linesForArea, reconcileSummary } from './selectors'
import { useTracker, useTrackerCommand } from './store'
import type { TrackerLine } from './types'

type Tab = 'overview' | 'requirements' | 'summary' | 'anchorage' | 'review' | 'activity' | 'source'

const num = (n: number | null) => (n === null ? <span className="text-muted">—</span> : <span className="tabular-nums">{n.toLocaleString('en-CA')}</span>)

/**
 * The imported REEF material tracker. Pass `areaId` to scope it to one construction area (the area Materials tab);
 * without it, every area of the project is shown. Statuses from the workbook are labelled as such; only receipts recorded
 * here are treated as verified.
 */
export function MaterialTracker({ areaId, records = false }: { areaId?: string; records?: boolean }) {
  const { state } = useTracker()
  const { state: construction } = useConstruction()
  const { run } = useTrackerCommand()
  const { today } = useTracker()
  const access = useAccess()
  const { projectId } = useParams()
  const refs = useMaterialRefs(projectId)
  const [tab, setTab] = useState<Tab>(records ? 'requirements' : 'overview')
  const [adding, setAdding] = useState<false | 'one' | 'quick'>(false)

  // Names come from the linked project records, so a renamed area, foundation or supplier shows everywhere without touching the materials.
  const all = useMemo(() => resolveLines(areaId ? linesForArea(state, construction.areas, areaId) : allLines(state), refs.catalog, refs.suppliers), [state, construction.areas, areaId, refs])
  const scope = useMemo(() => all.filter((l) => !l.archived), [all])

  if (!state.meta && all.length === 0) {
    return (
      <>
        <AccessBar />
        <EmptyState
          title="No materials yet"
          description={`Nothing has been added for this ${identity.trackerName} yet. Add materials one at a time, add several for a foundation in one go, or import an existing Excel material tracker. Areas, foundations, anchorage types and suppliers come from what you have set up.`}
          action={<div className="flex flex-wrap justify-center gap-2">{access.can('materials.add') && <Button variant="primary" onClick={() => setAdding('one')}>Add material</Button>}{access.can('materials.add') && <Button onClick={() => setAdding('quick')}>Quick add several</Button>}{access.can('materials.import') && <ImportButton />}</div>}
        />
        {adding && <AddMaterialModal projectId={projectId} startQuick={adding === 'quick'} initial={blankMaterial({ areaId: areaId ?? '' })} onClose={() => setAdding(false)} />}
      </>
    )
  }
  const flags = state.flags.filter((f) => !areaId || scope.some((l) => l.id === f.lineId) || !f.lineId)
  const pending = flags.filter((f) => f.severity === 'review' && !state.acknowledged[f.id])
  const history = (state.history ?? []).filter((h) => !areaId || !h.materialId || all.some((l) => l.id === h.materialId))

  return (
    <div className="[font-feature-settings:'calt'_0]">
      <AccessBar />
      <div><Tabs<Tab> value={tab} onChange={setTab} items={[
        ...(records ? [] : [{ id: 'overview' as Tab, label: 'By area' }]), { id: 'requirements', label: 'Line items', count: scope.length }, { id: 'summary', label: 'Area summary' },
        { id: 'anchorage', label: 'Anchorage types' }, { id: 'review', label: 'Review', count: pending.length }, { id: 'activity', label: 'Activity', count: history.length }, { id: 'source', label: 'Source' },
      ]} /></div>

      <div className="pt-6">
        {tab === 'overview' && <MaterialsByArea areaId={areaId} />}

        {tab === 'requirements' && (
          <>
            <MaterialsManager lines={all} scopeName={areaId ? 'This area' : 'All areas'} hideArea={!!areaId} projectId={projectId} defaultAreaId={areaId} />
            <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted">A delivery counts once the material has been physically received, checked and confirmed here: confirm all of it, or part of it for a partial delivery. Outstanding = required − delivered. A status in the workbook is shown for reference but is not a delivery.</p>
          </>
        )}

        {tab === 'summary' && <AreaSummary lines={scope} />}

        {tab === 'anchorage' && <AnchorageTypes lines={scope.filter((l) => l.origin !== 'manual')} />}

        {tab === 'review' && (
          <>
            <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">Records the importer could not confirm. Nothing was changed: quantities and descriptions are exactly as the workbook has them. Acknowledging a flag only records that you have looked at it.</p>
            {flags.length === 0 ? <EmptyState title="Nothing flagged" /> : (
              <ul className="border-t border-line">
                {flags.map((f) => {
                  const ack = state.acknowledged[f.id]
                  return (
                    <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3 text-[13px]">
                      <div className="min-w-0 flex-1">
                        <p>{f.message}</p>
                        <p className="text-xs text-muted">{f.source.sheet}, row {f.source.row} · {f.severity === 'review' ? 'Needs review' : 'For information'}{ack && ` · acknowledged ${formatDate(ack.date)}`}</p>
                      </div>
                      {f.severity === 'review' && access.can('materials.edit') && <Button variant="ghost" className="h-8 px-2" onClick={() => run(acknowledgeFlag(f.id, '', today, !ack))}>{ack ? 'Undo acknowledge' : 'Acknowledge'}</Button>}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {tab === 'activity' && (
          <>
            <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">Every addition, edit, quantity change, delivery, status change and archive, newest first. The history is append-only: it cannot be edited from here. With saved data each entry carries the signed-in user and server time.</p>
            {history.length === 0 ? <EmptyState title="No activity yet" /> : (
              <ul className="border-t border-line text-[13px]">
                {history.slice().reverse().slice(0, 300).map((h) => (
                  <li key={h.id} className="border-b border-line py-2.5">
                    <p><span className="font-medium">{h.label}</span> — {h.summary}</p>
                    <p className="text-xs text-muted">{new Date(h.at).toLocaleString('en-CA')} · {h.by || 'user not recorded'}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'source' && <Source />}
      </div>
    </div>
  )
}

function AreaSummary({ lines }: { lines: TrackerLine[] }) {
  const groups = areaSummary(lines)
  const areas = distinct(groups.map((g) => g.area))
  return (
    <>
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">Built automatically from the detailed requirements, one row per area and component description. It summarises the lines above; it is never an additional requirement. Delivered counts confirmed deliveries only.</p>
      {areas.map((area) => (
        <section key={area} className="mb-8">
          <h3 className="t-title mb-2">{area}</h3>
          <div className="overflow-x-auto">
            <table className="card-table w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line">{['Component', 'Required', 'Delivered', 'Remaining', 'Workbook status'].map((h, i) => <th key={h} className={`t-label py-3 pr-6 font-medium ${i && i < 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {groups.filter((g) => g.area === area).map((g) => (
                  <tr key={g.component} className="border-b border-line">
                    <td className="py-3 pr-6">{g.component}<span className="block text-xs text-muted">{g.lines} line{g.lines === 1 ? '' : 's'}</span></td>
                    <td className="py-3 pr-6 text-right tabular-nums">{g.required.toLocaleString('en-CA')}</td>
                    <td className="py-3 pr-6 text-right tabular-nums">{g.received.toLocaleString('en-CA')}</td>
                    <td className="py-3 pr-6 text-right">{num(g.remaining)}</td>
                    <td className="py-3 pr-6 text-muted">{g.pendingPerWorkbook === 0 ? 'Delivered' : g.deliveredPerWorkbook === 0 ? 'Pending' : `${g.deliveredPerWorkbook} delivered · ${g.pendingPerWorkbook} pending`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}

function AnchorageTypes({ lines }: { lines: TrackerLine[] }) {
  const { state } = useTracker()
  const codes = distinct(lines.map((l) => l.anchorageType))
  return (
    <>
      <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">Anchorage types as used on the Material List, with the footing types and components that reference them.</p>
      <ul className="border-t border-line text-[13px]">
        {codes.map((code) => {
          const mine = lines.filter((l) => l.anchorageType === code)
          return (
            <li key={code || 'none'} className="border-b border-line py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{code || '(none)'}</span><span className="text-xs text-muted">{distinct(mine.map((l) => l.area)).join(', ')} · footing types {distinct(mine.map((l) => l.footingType)).join(', ')}</span></div>
              <p className="mt-1 text-xs text-muted">{distinct(mine.map((l) => l.component)).join(' · ')}</p>
            </li>
          )
        })}
      </ul>
      <h3 className="t-title mb-1 mt-10">Anchorage Type sheet</h3>
      <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">Reference rows exactly as they appear on the workbook’s “Anchorage Type” sheet. They have no area and use different codes from the Material List, so they are not counted in any requirement or total.</p>
      <div className="overflow-x-auto">
        <table className="card-table w-full min-w-[760px] border-collapse text-left text-[13px]">
          <thead><tr className="border-b border-line">{['Row', 'Footing', 'Type', 'Ftngs', 'Plinths', 'Bolts', 'Component', 'Qty', 'Grade', 'Status'].map((h) => <th key={h} className="t-label py-3 pr-4 font-medium">{h}</th>)}</tr></thead>
          <tbody>{state.anchorage.map((a) => (
            <tr key={a.id} className="border-b border-line text-muted">
              <td className="py-2 pr-4 tabular-nums">{a.source.row}</td><td className="py-2 pr-4">{a.footingType || '—'}</td><td className="py-2 pr-4">{a.anchorageType}</td>
              <td className="py-2 pr-4 tabular-nums">{a.footings ?? '—'}</td><td className="py-2 pr-4 tabular-nums">{a.plinths ?? '—'}</td><td className="py-2 pr-4 tabular-nums">{a.bolts ?? '—'}</td>
              <td className="py-2 pr-4 text-ink">{a.component}</td><td className="py-2 pr-4 tabular-nums">{a.requiredQty ?? '—'}</td><td className="py-2 pr-4 tabular-nums">{a.grade ?? '—'}</td><td className="py-2 pr-4">{a.sourceStatus}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  )
}

function Source() {
  const { state } = useTracker()
  const access = useAccess()
  const server = useIsServer()
  const { run } = useTrackerCommand()
  const m = state.meta!
  const rec = reconcileSummary(state)
  return (
    <div className="max-w-2xl text-[13px]">
      <dl className="border-t border-line">
        {[
          ['Workbook', m.fileName], ['Imported', new Date(m.importedAt).toLocaleString('en-CA')], ['File fingerprint (SHA-256)', m.sha256 ? <span className="break-all font-mono text-xs">{m.sha256}</span> : 'Not available'],
          ['Material List rows imported', m.counts.materialRows], ['Workbook area summary rows', `${m.counts.summaryRows} (${rec.matched} of ${rec.total} match totals rebuilt from the detail rows)`],
          ['Anchorage Type sheet rows', `${m.counts.anchorageRows} (reference only)`], ['Cell comments kept', m.counts.commentsRead], ['Blank formula rows skipped', m.counts.blankRowsSkipped],
        ].map(([k, v]) => <div key={String(k)} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 border-b border-line py-2.5"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <h3 className="t-title mb-2 mt-8">How quantities work</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-muted">
        <li>Required quantity is the workbook’s calculated value. Its formula is kept and re-evaluated; any disagreement is flagged, not corrected.</li>
        <li>Area summary rows are rebuilt from the detailed lines. The workbook’s own summary is kept only to check them.</li>
        <li>Delivered quantity is the sum of deliveries confirmed in Nexus (who confirmed each, and when, is kept). Remaining = required − delivered.</li>
        <li>The Materials percentage counts confirmed deliveries only; a “Delivered” status in the workbook is shown for reference and counts as zero until the delivery is confirmed here.</li>
      </ul>
      <p className="mb-4 mt-8 text-xs text-muted">{server ? 'Saved on the server and shared by everyone with access.' : 'Stored in this browser only. Other users cannot see it and clearing site data removes it.'}</p>
      <div className="flex gap-2">
        {access.can('materials.import') && <ImportButton label="Re-import workbook" />}
        {!server && access.can('materials.configure') && <Button variant="ghost" onClick={() => window.confirm('Remove the imported workbook lines and every receipt, ordered quantity and note entered on them? Materials added in Nexus are kept. This cannot be undone.') && run(clearTracker())}>Remove imported data</Button>}
      </div>
    </div>
  )
}
