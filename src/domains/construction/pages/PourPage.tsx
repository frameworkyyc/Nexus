import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAccess } from '@/lib/access'
import { formatDate } from '@/lib/format'
import { volumeLabel } from '../concrete'
import { addPourItems, cancelPour, completePour, recordPour, recordPourOverride, removePourItem, setPourActual, updatePour } from '../commands'
import { paths } from '../paths'
import { componentInfo, footingDone, isOpen, PLAN_LABEL, pourBreakdown, pourTotals, remainingM3 } from '../pours'
import { constructionStore, useConstruction } from '../store'
import type { ConstructionState, Pour, PourItem } from '../types'
import { POUR_TONE, PourLegend } from './PoursPage'

/** Runs a command, tracks "busy" and keeps the error to show beside the control that caused it. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async (r: Parameters<typeof constructionStore.run>[0], done?: () => void) => {
    setBusy(true); setError('')
    const e = await constructionStore.run(r)
    setBusy(false)
    if (e) setError(e); else done?.()
    return e
  }
  return { busy, error, go, setError }
}

const codeOf = (state: ConstructionState, id: string | null) => (id ? state.anchorageTypes.find((t) => t.id === id)?.code ?? id : 'Not assigned')
const m3 = (n: number | null) => (n === null ? '—' : volumeLabel(n))

/** One pour: what is in it, how much concrete that is, and what has actually been poured. */
export function PourPage() {
  const { projectId = '', pourId = '' } = useParams()
  const { state, today } = useConstruction()
  const access = useAccess()
  const [editing, setEditing] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [recording, setRecording] = useState<PourItem | null>(null)
  const act = useAction()
  const pour = (state.pours ?? []).find((p) => p.id === pourId && p.projectId === projectId)
  const items = useMemo(() => (state.pourItems ?? []).filter((i) => i.pourId === pourId), [state.pourItems, pourId])
  if (!pour) return <EmptyState title="Pour not found" action={<Link to={paths.pours(projectId)} className="text-[13px] underline underline-offset-4">Back to pours</Link>} />

  const open = isOpen(pour)
  const canEdit = access.can('data.edit') && open
  const t = pourTotals(pour, state.pourItems ?? [])
  const remaining = items.reduce((n, i) => n + (remainingM3(i) ?? 0), 0)
  const rows = pourBreakdown(state, pour)
  const sorted = [...items].sort((a, b) => (state.foundations.find((f) => f.id === a.foundationId)?.number ?? '').localeCompare(state.foundations.find((f) => f.id === b.foundationId)?.number ?? '', undefined, { numeric: true }) || a.unit - b.unit || (a.component === b.component ? (state.plinths.find((p) => p.id === a.plinthId)?.index ?? 0) - (state.plinths.find((p) => p.id === b.plinthId)?.index ?? 0) : a.component === 'footing' ? -1 : 1))
  const fnum = (id: string) => state.foundations.find((f) => f.id === id)?.number ?? id

  return (
    <>
      <Link to={paths.pours(projectId)} className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink phone:hidden"><ArrowLeft size={14} strokeWidth={1.5} />Concrete pours</Link>
      <PageHeader title={pour.name} description={<span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1"><StatusBadge tone={POUR_TONE[pour.status]} label={PLAN_LABEL[pour.status]} /><span>{pour.date ? `Date ${formatDate(pour.date)}` : 'No date set'}</span>{pour.completedDate && <span>Completed {formatDate(pour.completedDate)}</span>}</span> }
        actions={access.can('data.edit') && (open || pour.status === 'completed') ? <>
          <Button onClick={() => setEditing(true)}>Edit details</Button>
          {open && <Button variant="primary" onClick={() => setCompleting(true)}>Complete pour</Button>}
          {open && <Button onClick={() => { if (window.confirm('Cancel this pour? Its components go back to not poured.')) void act.go(cancelPour(pour.id)) }}>Cancel pour</Button>}
        </> : undefined} />
      <PourLegend />
      {act.error && <p role="alert" className="mt-3 border-l-2 border-bad pl-3 text-[13px]">{act.error}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-5">
        <Stat label="Footings" value={m3(t.footing)} sub={`${items.filter((i) => i.component === 'footing').length} footing${items.filter((i) => i.component === 'footing').length === 1 ? '' : 's'}`} />
        <Stat label="Plinths" value={m3(t.plinths)} sub={`${items.filter((i) => i.component === 'plinth').length} plinth${items.filter((i) => i.component === 'plinth').length === 1 ? '' : 's'}`} />
        <Stat label="Concrete needed" value={<>{t.unknownItems ? '≥ ' : ''}{volumeLabel(t.planned)}</>} sub={t.unknownItems ? `${t.unknownItems} component${t.unknownItems === 1 ? '' : 's'} without dimensions are not included` : 'Footings plus plinths'} />
        <Stat label={`With ${pour.wastePct}% waste`} value={<>{t.unknownItems ? '≥ ' : ''}{volumeLabel(t.withWaste)}</>} sub="Volume to order" />
        <Stat label="Poured so far" value={m3(t.poured)} sub={`${t.completedItems} of ${t.items} completed${open && remaining > 0 ? ` · ${volumeLabel(remaining)} remaining` : ''}`} />
      </dl>

      {canEdit && <PourPicker pour={pour} />}

      <Section title="In this pour" description="Each row is one footing or one plinth of one physical foundation. Record what was poured; partial amounts are kept and the rest stays remaining.">
        {sorted.length === 0 ? <p className="py-3 text-[13px] text-muted">Nothing added yet.</p> : (
          <div className="overflow-x-auto">
            <table className="card-table w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line">{['Foundation', 'Component', 'Planned', 'Poured', 'Status', ''].map((h, i) => <th key={i} className="t-label py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {sorted.map((i) => {
                  const p = i.plinthId ? state.plinths.find((x) => x.id === i.plinthId) : undefined
                  const rem = remainingM3(i)
                  return (
                    <tr key={i.id} className="border-b border-line">
                      <td className="py-2.5 pr-4 font-medium">{fnum(i.foundationId)} <span className="font-normal text-muted">#{i.unit}</span></td>
                      <td className="pr-4">{i.component === 'footing' ? 'Footing' : `Plinth ${p?.index ?? ''}`}{p && <span className="text-muted"> · {codeOf(state, p.anchorageTypeId)}</span>}</td>
                      <td className="pr-4 tabular-nums">{i.plannedM3 === null ? <span className="text-muted" title="Dimensions are missing">Unknown</span> : volumeLabel(i.plannedM3)}</td>
                      <td className="pr-4 tabular-nums">{i.pouredM3 === null ? '—' : volumeLabel(i.pouredM3)}</td>
                      <td className="pr-4">
                        {i.completedDate ? <StatusBadge tone="ok" label={`Completed ${formatDate(i.completedDate)}`} /> : i.pouredM3 !== null ? <StatusBadge tone="warn" label={`Partial${rem !== null ? ` · ${volumeLabel(rem)} remaining` : ''}`} /> : <StatusBadge tone="muted" label="Not poured" />}
                        {i.overrideReason && <span className="block text-xs text-muted">Completed before its footing — {i.overrideReason}{i.overrideBy ? ` (${i.overrideBy})` : ''}</span>}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {canEdit && !i.completedDate && <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setRecording(i)}>Record</Button>}
                        {canEdit && !i.completedDate && i.pouredM3 === null && <Button variant="ghost" className="h-8 px-2 text-xs" aria-label={`Remove ${fnum(i.foundationId)} #${i.unit} ${i.component === 'footing' ? 'footing' : `plinth ${p?.index}`}`} onClick={() => void act.go(removePourItem(i.id))}>Remove</Button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {rows.length > 0 && (
        <Section title="Breakdown" description="Planned concrete by foundation, component and anchorage type.">
          <div className="overflow-x-auto">
            <table className="card-table w-full min-w-[520px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line">{['Foundation', 'Component', 'Anchorage', 'Count', 'Concrete'].map((h) => <th key={h} className="t-label py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-line"><td className="py-2 pr-4">{r.label}</td><td className="pr-4">{r.component === 'footing' ? 'Footings' : 'Plinths'}</td><td className="pr-4">{r.component === 'footing' ? '—' : codeOf(state, r.anchorageTypeId)}</td><td className="pr-4 tabular-nums">{r.count}</td><td className="pr-4 tabular-nums">{r.unknown ? `${r.m3 ? `${volumeLabel(r.m3)} + ` : ''}${r.unknown} unknown` : volumeLabel(r.m3)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {access.can('data.edit') && pour.status !== 'cancelled' && <ActualTotal pour={pour} />}
      {pour.notes && <Section title="Notes"><p className="text-[13px]">{pour.notes}</p></Section>}

      {editing && <EditPourModal pour={pour} onClose={() => setEditing(false)} />}
      {completing && <CompletePourModal pour={pour} today={today} onClose={() => setCompleting(false)} />}
      {recording && <RecordModal item={recording} today={today} onClose={() => setRecording(null)} />}
    </>
  )
}

function ActualTotal({ pour }: { pour: Pour }) {
  const [v, setV] = useState(pour.actualM3 === null ? '' : String(pour.actualM3))
  const act = useAction()
  return (
    <Section title="Concrete placed" description="Optional: the total volume actually placed in this pour (delivered and used), for comparison with the plan.">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void act.go(setPourActual(pour.id, v.trim() === '' ? null : Number(v))) }}>
        <div className="w-40"><Field label="Total placed (m³)"><Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder="Not recorded" /></Field></div>
        <Button type="submit" disabled={act.busy}>Save</Button>
        {act.error && <p role="alert" className="text-[13px]">{act.error}</p>}
      </form>
    </Section>
  )
}

function EditPourModal({ pour, onClose }: { pour: Pour; onClose: () => void }) {
  const [name, setName] = useState(pour.name)
  const [date, setDate] = useState(pour.date ?? '')
  const [waste, setWaste] = useState(String(pour.wastePct))
  const [notes, setNotes] = useState(pour.notes)
  const act = useAction()
  const closed = pour.status === 'completed'
  return (
    <Modal title="Pour details" onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <Field label="Pour name"><Input disabled={closed} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pour date"><Input type="date" disabled={closed} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Waste / overage %"><Input inputMode="decimal" disabled={closed} value={waste} onChange={(e) => setWaste(e.target.value)} /></Field>
        </div>
        {!closed && <p className="-mt-2 text-xs text-muted">Setting a date makes the pour Scheduled; clearing it returns it to Planned.</p>}
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {act.error && <p role="alert" className="border-l-2 border-bad pl-3">{act.error}</p>}
        <Button variant="primary" disabled={act.busy} onClick={() => void act.go(updatePour(pour.id, closed ? { notes } : { name, date: date || null, wastePct: Number(waste), notes }), onClose)}>{act.busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  )
}

function CompletePourModal({ pour, today, onClose }: { pour: Pour; today: string; onClose: () => void }) {
  const [date, setDate] = useState(pour.date && pour.date <= today ? pour.date : today)
  const act = useAction()
  const { state } = useConstruction()
  const items = (state.pourItems ?? []).filter((i) => i.pourId === pour.id)
  const untouched = items.filter((i) => !i.completedDate && i.pouredM3 === null).length
  const partial = items.filter((i) => !i.completedDate && i.pouredM3 !== null).length
  return (
    <Modal title="Complete pour" onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <p>{items.filter((i) => i.completedDate).length} of {items.length} components are recorded as poured.</p>
        {untouched > 0 && <p className="text-muted">{untouched} component{untouched === 1 ? ' has' : 's have'} nothing recorded; {untouched === 1 ? 'it is' : 'they are'} released and can be planned in another pour.</p>}
        {partial > 0 && <p className="text-muted">{partial} component{partial === 1 ? ' was' : 's were'} only partly poured; the remaining volume can be planned in a later pour.</p>}
        <Field label="Completion date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {act.error && <p role="alert" className="border-l-2 border-bad pl-3">{act.error}</p>}
        <Button variant="primary" disabled={act.busy} onClick={() => void act.go(completePour(pour.id, date, today), onClose)}>{act.busy ? 'Saving…' : 'Complete pour'}</Button>
      </div>
    </Modal>
  )
}

function RecordModal({ item, today, onClose }: { item: PourItem; today: string; onClose: () => void }) {
  const { state } = useConstruction()
  const access = useAccess()
  const act = useAction()
  const [poured, setPoured] = useState(item.pouredM3 !== null ? String(item.pouredM3) : item.plannedM3 !== null ? String(Math.round(item.plannedM3 * 1e6) / 1e6) : '')
  const [complete, setComplete] = useState(false)
  const [date, setDate] = useState(today)
  const [reason, setReason] = useState('')
  const f = state.foundations.find((x) => x.id === item.foundationId)
  const p = item.plinthId ? state.plinths.find((x) => x.id === item.plinthId) : undefined
  const blocked = item.component === 'plinth' && !footingDone(state, item.foundationId, item.unit)
  const canOverride = blocked && access.can('structure.manage')
  const info = componentInfo(state, item.foundationId, item.unit, item.plinthId)
  const value = poured.trim() === '' ? null : Number(poured)
  const save = () => {
    const rec = { pouredM3: value, complete, date: complete ? date : null }
    return act.go(blocked && complete && canOverride ? recordPourOverride(item.id, rec, reason, today) : recordPour(item.id, rec, today), onClose)
  }
  return (
    <Modal title={`Record pour · ${f?.number} #${item.unit} ${item.component === 'footing' ? 'footing' : `plinth ${p?.index}`}`} onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Planned {item.plannedM3 === null ? 'volume unknown (dimensions missing)' : volumeLabel(item.plannedM3)}. Enter the total poured so far for this component — saving again replaces the figure, it never adds to it.{info.pouredM3 > (item.pouredM3 ?? 0) && ` ${volumeLabel(info.pouredM3 - (item.pouredM3 ?? 0))} was poured earlier in another pour.`}</p>
        <Field label="Poured so far (m³)"><Input autoFocus inputMode="decimal" value={poured} onChange={(e) => setPoured(e.target.value)} placeholder="e.g. 3.5" /></Field>
        <label className="flex min-h-9 items-center gap-2 phone:min-h-11"><input type="checkbox" className="h-4 w-4 phone:h-6 phone:w-6" checked={complete} onChange={(e) => setComplete(e.target.checked)} />Fully poured — mark this component completed</label>
        {complete && <Field label="Completion date"><Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {blocked && complete && (
          <div role="status" className="border-l-2 border-warn pl-3">
            <p>The footing of this foundation (#{item.unit}) is not recorded as poured yet, so its plinths cannot be completed.</p>
            {canOverride ? <div className="mt-2"><Field label="Override reason (required, kept on the record)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the plinth being completed first?" /></Field></div> : <p className="mt-1 text-muted">An administrator can override this with a recorded reason. You can still record a partial amount.</p>}
          </div>
        )}
        {act.error && <p role="alert" className="border-l-2 border-bad pl-3">{act.error}</p>}
        <Button variant="primary" disabled={act.busy || (blocked && complete && !canOverride)} onClick={() => void save()}>{act.busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  )
}

/** Parses "1-6, 9, 12-13" into foundation numbers. */
export function parseUnits(text: string, max: number): number[] | string {
  const out = new Set<number>()
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) return `“${part}” is not a number or range (use for example 1-6, 9).`
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
    if (a < 1 || b < a || b > max) return `Choose numbers from 1 to ${max}.`
    for (let u = a; u <= b; u++) out.add(u)
  }
  return [...out]
}

/** Choose foundations, how many (or which) of them, and which components, then add them to the pour. Repeat to combine several foundation types. */
function PourPicker({ pour }: { pour: Pour }) {
  const { state } = useConstruction()
  const act = useAction()
  const foundations = state.foundations.filter((f) => !f.archived && state.areas.find((a) => a.id === f.areaId)?.projectId === pour.projectId).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  const [fid, setFid] = useState('')
  const [units, setUnits] = useState('')
  const [components, setComponents] = useState<'footing' | 'plinth' | 'both'>('footing')
  const [plinthIds, setPlinthIds] = useState<string[] | null>(null)
  const f = foundations.find((x) => x.id === fid)
  const qty = f ? f.quantity ?? 1 : 0
  const plinths = f ? state.plinths.filter((p) => p.foundationId === f.id).sort((a, b) => a.index - b.index) : []
  const wantsPlinths = components !== 'footing'
  const summary = useMemo(() => {
    if (!f || qty > 5000) return null
    const c = { available: [] as number[], planned: 0, completed: 0 }
    for (let u = 1; u <= qty; u++) { const s = componentInfo(state, f.id, u, null).state; if (s === 'completed') c.completed++; else if (s === 'planned') c.planned++; else c.available.push(u) }
    return c
  }, [f, qty, state])
  const add = () => {
    if (!f) return
    const parsed = parseUnits(units, qty)
    if (typeof parsed === 'string') { act.setError(parsed); return }
    if (parsed.length === 0) { act.setError('Enter which foundations are being poured, for example 1-6.'); return }
    void act.go(addPourItems(pour.id, [{ foundationId: f.id, units: parsed, components, ...(wantsPlinths && plinthIds ? { plinthIds } : {}) }]), () => setUnits(''))
  }
  return (
    <Section title="Add to this pour" description="Pick a foundation, which of its physical foundations are being poured, and whether that is the footings, the plinths or both. Add several foundations to combine them in one pour.">
      <div className="space-y-4 text-[13px]">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Foundation"><Select aria-label="Foundation" value={fid} onChange={(e) => { setFid(e.target.value); setUnits(''); setPlinthIds(null) }}>
            <option value="">Choose a foundation…</option>
            {foundations.map((x) => <option key={x.id} value={x.id}>{x.number} · {(x.quantity ?? 1).toLocaleString('en-CA')} foundation{(x.quantity ?? 1) === 1 ? '' : 's'}{x.description ? ` — ${x.description}` : ''}</option>)}
          </Select></Field>
          <Field label="Components"><Select aria-label="Components" value={components} onChange={(e) => setComponents(e.target.value as typeof components)}><option value="footing">Footings</option><option value="plinth">Plinths</option><option value="both">Footings and plinths</option></Select></Field>
        </div>
        {f && (
          <>
            <div className="grid items-end gap-3 md:grid-cols-[2fr_auto]">
              <Field label={`Which of the ${qty.toLocaleString('en-CA')} (numbers or ranges, e.g. 1-6, 9)`}><Input aria-label="Foundation numbers" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={qty === 1 ? '1' : `1-${Math.min(qty, 6)}`} /></Field>
              {summary && summary.available.length > 0 && (
                <div className="flex items-center gap-2">
                  <Input aria-label="How many to select" className="w-28" inputMode="numeric" placeholder="How many" id="pour-next-n" />
                  <Button onClick={() => { const n = Number((document.getElementById('pour-next-n') as HTMLInputElement).value); if (n >= 1) setUnits(compact(summary.available.slice(0, n))) }}>Select next</Button>
                </div>
              )}
            </div>
            {summary && <p className="text-xs text-muted">{summary.available.length} footing{summary.available.length === 1 ? '' : 's'} not yet planned or poured · {summary.planned} in an open pour · {summary.completed} poured. Selecting 6 of {qty.toLocaleString('en-CA')} adds only those 6.</p>}
            {wantsPlinths && plinths.length > 0 && (
              <fieldset>
                <legend className="t-label mb-1">Plinths ({plinthIds === null ? 'all' : plinthIds.length} of {plinths.length})</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {plinths.map((p) => {
                    const on = plinthIds === null || plinthIds.includes(p.id)
                    return <label key={p.id} className="flex min-h-9 items-center gap-2 phone:min-h-11"><input type="checkbox" className="h-4 w-4 phone:h-6 phone:w-6" checked={on} onChange={(e) => { const cur = plinthIds ?? plinths.map((x) => x.id); const next = e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id); setPlinthIds(next.length === plinths.length ? null : next) }} />Plinth {p.index} · {state.anchorageTypes.find((t) => t.id === p.anchorageTypeId)?.code ?? 'not assigned'}</label>
                  })}
                </div>
              </fieldset>
            )}
            {wantsPlinths && plinths.length === 0 && <p className="text-muted">This foundation has no plinths configured.</p>}
          </>
        )}
        {act.error && <p role="alert" className="border-l-2 border-bad pl-3">{act.error}</p>}
        <Button variant="primary" disabled={!f || act.busy || (wantsPlinths && plinthIds !== null && plinthIds.length === 0 && components === 'plinth')} onClick={add}>{act.busy ? 'Adding…' : 'Add to pour'}</Button>
      </div>
    </Section>
  )
}

/** [1,2,3,5] → "1-3, 5" */
function compact(nums: number[]) {
  const out: string[] = []
  for (let i = 0; i < nums.length; i++) { let j = i; while (nums[j + 1] === nums[j] + 1) j++; out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i])); i = j }
  return out.join(', ')
}
