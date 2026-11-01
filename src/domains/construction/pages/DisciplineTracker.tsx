import { AlertTriangle, CheckCircle2, ChevronRight, Circle, CircleDashed, Clock } from 'lucide-react'
import { useState } from 'react'
import { CARD } from '@/components/mobile/Cards'
import { pct } from '@/lib/format'
import { Donut } from '@/components/ui/Donut'
import { EmptyState } from '@/components/ui/EmptyState'
import { GAUGE_GRID } from '@/components/ui/ProgressGauge'
import { Modal } from '@/components/ui/Modal'
import { ProgressBar } from '@/components/ui/Progress'
import type { Status } from '@/components/viz/status'
import { ViewToggle } from '@/components/ui/Toolbar'
import { useAccess } from '@/lib/access'
import { usePersistentChoice } from '@/lib/usePersistentChoice'
import { formatShortDate } from '@/lib/format'
import { useIsPhone } from '@/lib/useMedia'
import { updateActivity } from '../commands'
import { areaTracks, DISCIPLINES, doneStatus, isLate, projectTracks, matchesFilter, trackLabel, type Discipline, type FoundationTrack, type TrackFilter, type TrackState } from '../constructionProgress'
import { effectiveStatus } from '../selectors'
import { useConstruction, useConstructionCommand } from '../store'
import type { Activity, ActivityStatus } from '../types'

const STATE_META: Record<TrackState, { label: string; icon: typeof Circle; ring: Status; text: string; bar: string }> = {
  'not-started': { label: 'Not started', icon: CircleDashed, ring: 'unknown', text: 'text-muted', bar: 'bg-neutral-300' },
  'in-progress': { label: 'In progress', icon: Clock, ring: 'info', text: 'text-[var(--nx-info)]', bar: 'bg-[var(--nx-info)]' },
  completed: { label: 'Completed', icon: CheckCircle2, ring: 'ok', text: 'text-[var(--nx-ok)]', bar: 'bg-[var(--nx-ok)]' },
}

/** The four gauges, in the Procurement design: a ring per status, with its icon and count. Each is a button that filters the foundations below. */
function Gauges({ counts, total, scheduled, active, onPick }: { counts: ReturnType<typeof areaTracks>['counts']; total: number; scheduled: boolean; active: TrackFilter | ''; onPick: (f: TrackFilter) => void }) {
  const phone = useIsPhone()
  const items: { key: TrackFilter; title: string; icon: typeof Circle; ring: Status; text: string; n: number; value: number | null; note: string }[] = [
    { key: 'not-started', title: 'Not started', icon: CircleDashed, ring: 'unknown', text: 'text-muted', n: counts['not-started'], value: pct(counts['not-started'], total), note: '' },
    { key: 'in-progress', title: 'In progress', icon: Clock, ring: 'info', text: 'text-[var(--nx-info)]', n: counts['in-progress'], value: pct(counts['in-progress'], total), note: '' },
    { key: 'completed', title: 'Completed', icon: CheckCircle2, ring: 'ok', text: 'text-[var(--nx-ok)]', n: counts.completed, value: pct(counts.completed, total), note: '' },
    { key: 'overdue', title: 'Overdue', icon: AlertTriangle, ring: 'bad', text: 'text-[var(--nx-bad)]', n: counts.overdue, value: scheduled ? (pct(counts.overdue, total)) : null, note: scheduled ? '' : 'No planned dates yet' },
  ]
  return (
    <section aria-label="Progress" className="mb-8">
      <ul className={phone ? 'grid grid-cols-2 gap-3' : GAUGE_GRID}>
        {items.map((i) => {
          const Icon = i.icon
          const foot = <p className="mt-3 border-t border-line pt-3 text-xs tabular-nums"><span className="font-medium">{i.n}</span><span className="text-muted"> of {total}{i.note ? ` · ${i.note}` : ''}</span></p>
          return (
            <li key={i.key}>
              <button type="button" onClick={() => onPick(i.key)} aria-pressed={active === i.key} aria-label={`${i.title}: ${i.n} of ${total} foundations. Show them.`} className="block w-full text-left hover:opacity-90">
                {phone ? (
                  <div className={`${CARD} p-3 ${active === i.key ? 'ring-2 ring-ink' : ''}`}>
                    <div className="flex items-center justify-between"><span className="t-label">{i.title}</span><Icon size={16} strokeWidth={1.75} className={i.text} aria-hidden="true" /></div>
                    <div className="mt-3 flex justify-center"><Donut value={i.value} label={i.title} size={96} status={i.ring} /></div>
                    {foot}
                  </div>
                ) : (
                  <div className={active === i.key ? 'border-b-2 border-ink pb-2' : 'pb-2'}>
                    <div className="flex items-center justify-between"><span className="t-label">{i.title}</span><Icon size={16} strokeWidth={1.75} className={i.text} aria-hidden="true" /></div>
                    <div className="mt-4 flex justify-center"><Donut value={i.value} label={i.title} status={i.ring} /></div>
                    {foot}
                  </div>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One activity: its status as an icon, and three buttons (not started, in progress, completed) to update it in place. Choosing Completed again marks it incomplete. */
function ActivityRow({ a, canEdit }: { a: Activity; canEdit: boolean }) {
  const { idx, today } = useConstruction()
  const { run, saving } = useConstructionCommand()
  const status = effectiveStatus(idx, a)
  const late = isLate(idx, a, today)
  const set = (s: ActivityStatus) => run(updateActivity(a.id, { status: s === 'complete' ? doneStatus(a) : s }, today))
  const done = status === 'complete' || status === 'approved'
  const opts: { s: ActivityStatus; label: string; icon: typeof Circle; on: string }[] = [
    { s: 'not-started', label: 'Not started', icon: CircleDashed, on: 'bg-neutral-200 text-ink' },
    { s: 'in-progress', label: 'In progress', icon: Clock, on: 'bg-[var(--nx-info)] text-white' },
    { s: 'complete', label: 'Completed', icon: CheckCircle2, on: 'bg-[var(--nx-ok)] text-white' },
  ]
  const current = done ? 'complete' : status === 'pending-review' ? 'in-progress' : status
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        {status === 'blocked' ? <AlertTriangle size={18} className="shrink-0 text-[var(--nx-bad)]" aria-label="Blocked" /> : done ? <CheckCircle2 size={18} className="shrink-0 text-[var(--nx-ok)]" aria-hidden="true" /> : status === 'in-progress' ? <Clock size={18} className="shrink-0 text-[var(--nx-info)]" aria-hidden="true" /> : <CircleDashed size={18} className="shrink-0 text-muted" aria-hidden="true" />}
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{trackLabel(a)}</span>
          {(a.actualDate && done) || a.plannedDate ? <span className={`block text-xs ${late ? 'text-[var(--nx-bad)]' : 'text-muted'}`}>{done && a.actualDate ? `Done ${formatShortDate(a.actualDate)}` : a.plannedDate ? `${late ? 'Late · ' : ''}Planned ${formatShortDate(a.plannedDate)}` : ''}</span> : null}
        </span>
      </span>
      <span role="group" aria-label={`Status of ${trackLabel(a)}`} className="flex shrink-0 gap-1">
        {opts.map(({ s, label, icon: Icon, on }) => (
          <button key={s} type="button" disabled={!canEdit || saving} aria-pressed={current === s} aria-label={`${label}: ${trackLabel(a)}`} title={label}
            onClick={() => set(s === 'complete' && done ? 'not-started' : s)}
            className={`grid h-9 w-9 place-items-center rounded-nx border transition-colors disabled:opacity-40 phone:h-11 phone:w-11 ${current === s ? `${on} border-transparent` : 'border-line text-muted hover:border-ink hover:text-ink'}`}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ))}
      </span>
    </li>
  )
}

/** The foundation's construction activities grouped by footing and plinth, with its progress, in the standard side panel (a full-screen sheet on a phone). */
function FoundationPanel({ id, discipline, onClose }: { id: string; discipline: Discipline; onClose: () => void }) {
  const { idx, today } = useConstruction()
  const access = useAccess()
  const f = idx.foundation.get(id)
  if (!f) return null
  const t = areaTracks(idx, f.areaId, today, discipline).tracks.find((x) => x.foundation.id === id)
  if (!t) return null
  const meta = STATE_META[t.state]
  const groups = [{ key: 'footing', title: 'Footing', acts: t.acts.filter((a) => a.scope === 'footing') }, ...(idx.plinthsByFoundation.get(f.id) ?? []).map((p) => ({ key: p.id, title: `Plinth ${p.index}`, acts: t.acts.filter((a) => a.plinthId === p.id) }))].filter((g) => g.acts.length > 0)
  const qty = f.quantity ?? 1
  const order = DISCIPLINES[discipline].order // in the order the work happens on site
  const ordered = (acts: Activity[]) => acts.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return (
    <Modal title={f.number} onClose={onClose} wide>
      <div className="space-y-5 p-6 text-[13px]">
        <div>
          <div className="flex items-center justify-between gap-3"><span className={`inline-flex items-center gap-1.5 font-medium ${meta.text}`}><meta.icon size={16} aria-hidden="true" />{meta.label}{t.overdue && <AlertTriangle size={15} className="text-[var(--nx-bad)]" aria-label="Overdue" />}</span><span className="tabular-nums text-muted">{t.percent}%</span></div>
          <div className="mt-2"><ProgressBar value={t.percent} width="100%" showValue={false} /></div>
          {(f.description || qty > 1) && <p className="mt-2 text-xs text-muted">{f.description}{qty > 1 ? `${f.description ? ' · ' : ''}${qty} footings, tracked together as one designation` : ''}</p>}
        </div>
        {!access.can('data.edit') && <p role="status" className="border-l-2 border-line pl-3 text-muted">You can view progress. Updating it needs an editor or admin role.</p>}
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title}>
            <h3 className="t-label mb-1">{g.title}</h3>
            <ul className="divide-y divide-line border-y border-line">{ordered(g.acts).map((a) => <ActivityRow key={a.id} a={a} canEdit={access.can('data.edit')} />)}</ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}

function Card({ t, area, onOpen }: { t: FoundationTrack; area?: string; onOpen: () => void }) {
  const meta = STATE_META[t.state]
  const Icon = meta.icon
  const qty = t.foundation.quantity ?? 1
  return (
    <li className="h-full">
      <button type="button" onClick={onOpen} aria-label={`${t.foundation.number}: ${meta.label}, ${t.percent}%${t.overdue ? ', overdue' : ''}. Open`} className={`flex h-full min-h-[5.75rem] w-full flex-col border bg-surface p-3 text-left transition-colors hover:border-ink ${t.overdue ? 'border-[var(--nx-bad)]' : 'border-line'}`}>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{t.foundation.number}</span>
          <span className="flex shrink-0 items-center gap-1">
            {t.overdue && <AlertTriangle size={14} className="text-[var(--nx-bad)]" aria-label="Overdue" />}
            {t.blocked && <span className="h-1.5 w-1.5 rounded-full bg-[var(--nx-bad)]" title="Blocked" />}
            <Icon size={16} strokeWidth={1.75} className={meta.text} aria-hidden="true" />
          </span>
        </span>
        <span className="mt-0.5 flex h-5 items-center justify-between gap-2 text-xs text-muted"><span className="min-w-0 truncate">{t.foundation.description || '\u00a0'}</span>{qty > 1 && <span title={`${qty} footings tracked as one designation`} className="shrink-0 rounded-full border border-line px-1.5 leading-4 tabular-nums">×{qty}</span>}</span>
        <span className="mt-auto block h-1 bg-line"><span className={`block h-full ${meta.bar}`} style={{ width: `${t.percent}%` }} /></span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted"><span className="min-w-0 truncate">{area ?? '\u00a0'}</span><span className="shrink-0">{t.done}/{t.total} · {t.percent}%</span></span>
      </button>
    </li>
  )
}

/** The compact table view: one row per foundation, opening the same activity panel as a card. On a phone each row is a card, like the other tables. */
export function DisciplineList({ tracks, areaName, onOpen }: { tracks: FoundationTrack[]; areaName: (id: string) => string; onOpen: (id: string) => void }) {
  return (
    <table className="card-table w-full text-left text-[13px]" aria-label="Foundations">
      <thead><tr className="border-b border-line">
        <th scope="col" className="t-label font-medium">Foundation</th><th scope="col" className="t-label font-medium">Area</th><th scope="col" className="t-label text-right font-medium">Footings</th>
        <th scope="col" className="t-label font-medium">Progress</th><th scope="col" className="t-label font-medium">Status</th>
      </tr></thead>
      <tbody>
        {tracks.map((t) => {
          const meta = STATE_META[t.state]
          const Icon = meta.icon
          return (
            <tr key={t.foundation.id} className="cursor-pointer border-b border-line transition-colors hover:bg-hover" onClick={() => onOpen(t.foundation.id)}>
              <td data-wrap><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(t.foundation.id) }} aria-label={`${t.foundation.number}: ${meta.label}, ${t.percent}%${t.overdue ? ', overdue' : ''}. Open`} className="text-left font-medium underline-offset-4 hover:underline">{t.foundation.number}</button>{t.foundation.description && <span className="block truncate text-xs text-muted">{t.foundation.description}</span>}</td>
              <td className="text-muted">{areaName(t.foundation.areaId)}</td>
              <td className="text-right tabular-nums">{t.foundation.quantity ?? 1}</td>
              <td><span className="flex items-center gap-2"><span className="block h-1 w-20 bg-line"><span className={`block h-full ${meta.bar}`} style={{ width: `${t.percent}%` }} /></span><span className="tabular-nums text-muted">{t.percent}%</span></span></td>
              <td><span className={`inline-flex items-center gap-1.5 ${meta.text}`}><Icon size={15} strokeWidth={1.75} aria-hidden="true" />{meta.label}{t.overdue && <AlertTriangle size={14} className="text-[var(--nx-bad)]" aria-label="Overdue" />}</span></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export type TrackerLayout = 'grid' | 'list'

/**
 * The tracker page shared by Construction, Survey, QA/QC and Civil / Earthworks: gauges for the selected area (or every area, with `areaId` "all"), the
 * foundations as cards or a compact list you can filter by tapping a gauge, and a panel to update each foundation's activities in that discipline.
 * It reads and writes the existing activity records only.
 */
export function DisciplineTracker({ discipline, areaId, areaIds = [] }: { discipline: Discipline; areaId: string; areaIds?: string[] }) {
  const { idx, today, state } = useConstruction()
  const [filter, setFilter] = useState<TrackFilter | ''>('')
  const [open, setOpen] = useState<string | null>(null)
  // the chosen layout is remembered, so it stays as you switch areas
  const [layout, setLayout] = usePersistentChoice<TrackerLayout>('nexus.construction.view', ['grid', 'list'], 'grid')
  const all = areaId === 'all'
  const { tracks, counts, scheduled } = all ? projectTracks(idx, areaIds, today, discipline) : areaTracks(idx, areaId, today, discipline)
  const areaName = (id: string) => state.areas.find((a) => a.id === id)?.name ?? ''
  if (tracks.length === 0) return <EmptyState title="No foundations in this area yet" description="Add foundations in Setup to track their work here." />
  const shown = tracks.filter((t) => matchesFilter(t, filter))
  return (
    <>
      <Gauges counts={counts} total={tracks.length} scheduled={scheduled} active={filter} onPick={(k) => setFilter(filter === k ? '' : k)} />
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{filter ? `${shown.length} of ${tracks.length} foundations` : `${tracks.length} foundations`}{filter && <> · <button type="button" className="underline underline-offset-4" onClick={() => setFilter('')}>Show all</button></>}</span>
        <ViewToggle label="Foundations view" value={layout} onChange={setLayout} items={[{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }]} />
      </div>
      {shown.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">No foundations match.</p> : layout === 'list' ? (
        <DisciplineList tracks={shown} areaName={areaName} onOpen={setOpen} />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" aria-label="Foundations">
          {shown.map((t) => <Card key={t.foundation.id} t={t} area={all ? areaName(t.foundation.areaId) : undefined} onOpen={() => setOpen(t.foundation.id)} />)}
        </ul>
      )}
      <p className="mt-6 flex items-center gap-1 text-xs text-muted"><ChevronRight size={12} aria-hidden="true" />Tap a foundation to update its activities. Updates appear in Project Status and Foundation Overview.</p>
      {open && <FoundationPanel id={open} discipline={discipline} onClose={() => setOpen(null)} />}
    </>
  )
}
