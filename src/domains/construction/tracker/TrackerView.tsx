import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { Stat } from '@/components/ui/Stat'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { formatDate } from '@/lib/format'
import { useConstruction } from '../store'
import { acknowledgeFlag, clearTracker } from './commands'
import { ImportButton } from './ImportModal'
import { LineModal } from './LineModal'
import {
  areaSummary, CATEGORY_LABEL, CATEGORY_ORDER, DELIVERY_LABEL, deliveryState, distinct, filterLines, isVerified, linesForArea, receivedOf, reconcileSummary, remainingOf,
  type DeliveryState, type LineFilter,
} from './selectors'
import { useTracker, useTrackerCommand } from './store'
import type { ComponentCategory } from './types'
import type { TrackerLine } from './types'

type Tab = 'requirements' | 'summary' | 'anchorage' | 'review' | 'source'

const TONE: Record<DeliveryState, Tone> = { received: 'ok', 'over-received': 'warn', partial: 'warn', 'none-received': 'muted', 'unverified-delivered': 'info', 'unverified-pending': 'muted' }
const num = (n: number | null) => (n === null ? <span className="text-muted">—</span> : <span className="tabular-nums">{n.toLocaleString('en-CA')}</span>)
const DELIVERY_FILTER: DeliveryState[] = ['unverified-delivered', 'unverified-pending', 'received', 'partial', 'none-received', 'over-received']

/**
 * The imported REEF material tracker. Pass `areaId` to scope it to one construction area (the area Materials tab);
 * without it, every area of the project is shown. Statuses from the workbook are labelled as such; only receipts recorded
 * here are treated as verified.
 */
export function MaterialTracker({ areaId }: { areaId?: string }) {
  const { state } = useTracker()
  const { state: construction } = useConstruction()
  const { run } = useTrackerCommand()
  const { today } = useTracker()
  const [tab, setTab] = useState<Tab>('requirements')
  const [filter, setFilter] = useState<LineFilter>({})
  const [open, setOpen] = useState<string | null>(null)

  const scope = useMemo(() => (areaId ? linesForArea(state, construction.areas, areaId) : state.lines), [state, construction.areas, areaId])
  const rows = useMemo(() => filterLines(scope, filter), [scope, filter])
  const set = (patch: Partial<LineFilter>) => setFilter((f) => ({ ...f, ...patch }))

  if (!state.meta) {
    return (
      <EmptyState
        title="No material tracker imported"
        description="Import the REEF material tracker workbook to track requirements, deliveries and receipts. It is read in this browser and stored on this device only."
        action={<ImportButton />}
      />
    )
  }
  const flags = state.flags.filter((f) => !areaId || scope.some((l) => l.id === f.lineId) || !f.lineId)
  const pending = flags.filter((f) => f.severity === 'review' && !state.acknowledged[f.id])
  const verified = scope.filter(isVerified).length
  const deliveredUnverified = scope.filter((l) => deliveryState(l) === 'unverified-delivered').length

  const columns: Column<TrackerLine>[] = [
    { key: 'component', header: 'Component', render: (l) => (
      <>
        <span className="font-medium">{l.component}</span>
        <span className="block text-xs text-muted">{CATEGORY_LABEL[l.category]} · {l.source.sheet} row {l.source.row}{l.sourceNotes.length ? ' · has workbook comment' : ''}</span>
      </>
    ) },
    ...(areaId ? [] : [{ key: 'area', header: 'Area', hideOnMobile: true, render: (l: TrackerLine) => l.area }]),
    { key: 'footing', header: 'Footing type', hideOnMobile: true, render: (l) => l.footingType || '—' },
    { key: 'anchorage', header: 'Anchorage', hideOnMobile: true, render: (l) => l.anchorageType || '—' },
    { key: 'required', header: 'Required', render: (l) => num(l.requiredQty), className: 'text-right' },
    { key: 'ordered', header: 'Ordered', hideOnMobile: true, render: (l) => num(l.orderedQty), className: 'text-right' },
    { key: 'received', header: 'Received', hideOnMobile: true, render: (l) => (isVerified(l) ? num(receivedOf(l)) : <span className="text-muted">Not verified</span>), className: 'text-right' },
    { key: 'remaining', header: 'Remaining', hideOnMobile: true, render: (l) => num(remainingOf(l)), className: 'text-right' },
    { key: 'status', header: 'Delivery', render: (l) => { const d = deliveryState(l); return <StatusBadge tone={TONE[d]} label={DELIVERY_LABEL[d]} /> } },
  ]

  return (
    <div className="[font-feature-settings:'calt'_0]">
      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        <Stat label="Material lines" value={scope.length} />
        <Stat label="Receipts verified" value={verified} sub={`of ${scope.length} lines`} />
        <Stat label="Delivered, unverified" value={deliveredUnverified} sub="Per workbook status" />
        <Stat label="To review" value={pending.length} sub="Flagged records" />
      </dl>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">Delivered and Pending are the workbook’s statuses. A line counts as received only when a receipt is recorded here; “Delivered” may mean part of the quantity.</p>

      <div className="mt-8"><Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: 'requirements', label: 'Requirements', count: scope.length }, { id: 'summary', label: 'Area summary' },
        { id: 'anchorage', label: 'Anchorage types' }, { id: 'review', label: 'Review', count: pending.length }, { id: 'source', label: 'Source' },
      ]} /></div>

      <div className="pt-6">
        {tab === 'requirements' && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="col-span-2 md:col-span-3 xl:col-span-2"><Input type="search" aria-label="Search materials" placeholder="Search component, footing, anchorage, notes…" value={filter.search ?? ''} onChange={(e) => set({ search: e.target.value })} /></div>
              {!areaId && <Select aria-label="Area" value={filter.area ?? ''} onChange={(e) => set({ area: e.target.value })}><option value="">All areas</option>{distinct(scope.map((l) => l.area)).map((a) => <option key={a}>{a}</option>)}</Select>}
              <Select aria-label="Component type" value={filter.category ?? ''} onChange={(e) => set({ category: e.target.value as ComponentCategory | '' })}><option value="">All components</option>{CATEGORY_ORDER.filter((c) => scope.some((l) => l.category === c)).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>
              <Select aria-label="Footing type" value={filter.footingType ?? ''} onChange={(e) => set({ footingType: e.target.value })}><option value="">All footing types</option>{distinct(scope.map((l) => l.footingType)).map((a) => <option key={a}>{a}</option>)}</Select>
              <Select aria-label="Anchorage type" value={filter.anchorageType ?? ''} onChange={(e) => set({ anchorageType: e.target.value })}><option value="">All anchorage types</option>{distinct(scope.map((l) => l.anchorageType)).map((a) => <option key={a}>{a}</option>)}</Select>
              <Select aria-label="Delivery status" value={filter.delivery ?? ''} onChange={(e) => set({ delivery: e.target.value as DeliveryState | '' })}><option value="">Any delivery status</option>{DELIVERY_FILTER.map((d) => <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}</Select>
            </div>
            <p className="mb-2 text-xs text-muted" aria-live="polite">{rows.length} of {scope.length} lines{Object.values(filter).some(Boolean) && <> · <button className="underline underline-offset-4" onClick={() => setFilter({})}>Clear filters</button></>}</p>
            {rows.length ? <DataTable columns={columns} rows={rows} getKey={(l) => l.id} onRowClick={(l) => setOpen(l.id)} /> : <EmptyState title="No lines match these filters" />}
          </>
        )}

        {tab === 'summary' && <AreaSummary lines={scope} />}

        {tab === 'anchorage' && <AnchorageTypes lines={scope} />}

        {tab === 'review' && (
          <>
            <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">Records the importer could not confirm. Nothing was changed: quantities and descriptions are exactly as the workbook has them. Acknowledging a flag only records that someone has looked at it.</p>
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
                      {f.severity === 'review' && <Button variant="ghost" className="h-8 px-2" onClick={() => run(acknowledgeFlag(f.id, '', today, !ack))}>{ack ? 'Undo acknowledge' : 'Acknowledge'}</Button>}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {tab === 'source' && <Source />}
      </div>
      {open && <LineModal lineId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function AreaSummary({ lines }: { lines: TrackerLine[] }) {
  const groups = areaSummary(lines)
  const areas = distinct(groups.map((g) => g.area))
  return (
    <>
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted">Built automatically from the detailed requirements, one row per area and component description. It summarises the lines above; it is never an additional requirement. Remaining is shown only where every line in the group has verified receipts.</p>
      {areas.map((area) => (
        <section key={area} className="mb-8">
          <h3 className="t-title mb-2">{area}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line">{['Component', 'Required', 'Received (verified)', 'Remaining', 'Workbook status'].map((h, i) => <th key={h} className={`t-label py-3 pr-6 font-medium ${i && i < 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {groups.filter((g) => g.area === area).map((g) => (
                  <tr key={g.component} className="border-b border-line">
                    <td className="py-3 pr-6">{g.component}<span className="block text-xs text-muted">{g.lines} line{g.lines === 1 ? '' : 's'}</span></td>
                    <td className="py-3 pr-6 text-right tabular-nums">{g.required.toLocaleString('en-CA')}</td>
                    <td className="py-3 pr-6 text-right">{g.verifiedLines ? <span className="tabular-nums">{g.received.toLocaleString('en-CA')}{g.verifiedLines < g.lines && <span className="text-muted"> ({g.verifiedLines}/{g.lines} lines)</span>}</span> : <span className="text-muted">Not verified</span>}</td>
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
        <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
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
        <li>Received quantity is the sum of receipts recorded in Nexus. Remaining = required − received, shown only once receipts are verified.</li>
        <li>The Materials percentage counts verified receipts only; “Delivered” lines without receipts count as zero and are listed separately.</li>
      </ul>
      <p className="mb-4 mt-8 text-xs text-muted">Stored in this browser only. Other users cannot see it and clearing site data removes it.</p>
      <div className="flex gap-2">
        <ImportButton label="Re-import workbook" />
        <Button variant="ghost" onClick={() => window.confirm('Remove the imported tracker and every receipt, ordered quantity and note entered on it? This cannot be undone.') && run(clearTracker())}>Remove imported data</Button>
      </div>
    </div>
  )
}
