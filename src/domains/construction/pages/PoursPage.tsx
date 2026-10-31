import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { useAccess } from '@/lib/access'
import { formatDate } from '@/lib/format'
import { volumeLabel } from '../concrete'
import { createPour } from '../commands'
import { paths } from '../paths'
import { PLAN_LABEL, pourTotals } from '../pours'
import { constructionStore, useConstruction } from '../store'
import type { Pour } from '../types'

export const POUR_TONE: Record<Pour['status'], Tone> = { planned: 'neutral', scheduled: 'info', completed: 'ok', cancelled: 'muted' }

export const PourLegend = () => (
  <p className="max-w-2xl text-xs leading-relaxed text-muted">
    <span className="font-medium text-ink">Planned</span> — being worked out, no date yet · <span className="font-medium text-ink">Scheduled</span> — a pour date is set · <span className="font-medium text-ink">Completed</span> — concrete placed and recorded. Nothing counts as poured until it is recorded.
  </p>
)

/** Concrete pours of one project: plan which footings and plinths go in which pour, then record what was actually placed. */
export function PoursPage() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const access = useAccess()
  const [creating, setCreating] = useState(false)
  const pours = (state.pours ?? []).filter((p) => p.projectId === projectId).sort((a, b) => (b.date ?? '9999').localeCompare(a.date ?? '9999') || b.createdAt.localeCompare(a.createdAt))
  const canPlan = access.can('data.edit')
  const hasFoundations = state.foundations.some((f) => state.areas.find((a) => a.id === f.areaId)?.projectId === projectId)
  return (
    <>
      <PageHeader title="Concrete pours" description="Plan pour days by choosing exactly which footings and plinths go in, see the concrete needed, then record what was poured." actions={canPlan && hasFoundations ? <Button onClick={() => setCreating(true)}><Plus size={14} strokeWidth={1.5} />New pour</Button> : undefined} />
      <PourLegend />
      <div className="mt-6">
        {pours.length === 0 ? (
          <EmptyState title={hasFoundations ? 'No pours planned yet' : 'No foundations yet'} description={hasFoundations ? 'Create a pour, then add the foundations, footings and plinths it covers.' : 'Add foundations before planning a pour.'} action={canPlan && hasFoundations ? <Button onClick={() => setCreating(true)}><Plus size={14} strokeWidth={1.5} />New pour</Button> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="card-table w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead><tr className="border-b border-line">{['Pour', 'Status', 'Date', 'Planned', 'With waste', 'Poured', 'Components'].map((h) => <th key={h} className="t-label py-3 pr-5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {pours.map((p) => {
                  const t = pourTotals(p, state.pourItems ?? [])
                  return (
                    <tr key={p.id} className="border-b border-line hover:bg-hover">
                      <td className="py-3.5 pr-5"><Link to={paths.pour(projectId, p.id)} className="font-medium underline-offset-4 hover:underline">{p.name}</Link></td>
                      <td className="pr-5"><StatusBadge tone={POUR_TONE[p.status]} label={PLAN_LABEL[p.status]} /></td>
                      <td className="pr-5">{p.date ? formatDate(p.date) : <span className="text-muted">Not scheduled</span>}</td>
                      <td className="pr-5 tabular-nums">{t.items === 0 ? '—' : <>{t.unknownItems ? '≥ ' : ''}{volumeLabel(t.planned)}</>}</td>
                      <td className="pr-5 tabular-nums text-muted">{t.items === 0 ? '—' : `${t.unknownItems ? '≥ ' : ''}${volumeLabel(t.withWaste)} (${p.wastePct}%)`}</td>
                      <td className="pr-5 tabular-nums">{p.actualM3 !== null ? volumeLabel(p.actualM3) : t.poured > 0 ? volumeLabel(t.poured) : '—'}</td>
                      <td className="pr-5 tabular-nums text-muted">{t.completedItems} of {t.items} poured</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewPourModal projectId={projectId} onClose={() => setCreating(false)} />}
    </>
  )
}

function NewPourModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [waste, setWaste] = useState('0')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    const w = waste.trim() === '' ? 0 : Number(waste)
    if (!Number.isFinite(w)) { setError('Enter the waste / overage as a number of percent.'); return }
    setSaving(true); setError('')
    const e = await constructionStore.run(createPour(projectId, name, date || null, w, notes))
    setSaving(false)
    if (e) { setError(e); return }
    const made = (constructionStore.get().pours ?? []).filter((p) => p.projectId === projectId && p.name === name.trim().replace(/\s+/g, ' ')).at(-1)
    onClose()
    if (made) navigate(paths.pour(projectId, made.id))
  }
  return (
    <Modal title="New concrete pour" onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <Field label="Pour name *"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Footings OP1 – week 12" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pour date (optional)"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Waste / overage % (optional)"><Input inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} /></Field>
        </div>
        <p className="-mt-2 text-xs text-muted">With a date the pour is Scheduled; without one it stays Planned. You can add or change the date later.</p>
        <Field label="Notes (optional)"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <Button variant="primary" disabled={saving || name.trim().length < 2} onClick={() => void save()}>{saving ? 'Creating…' : 'Create pour'}</Button>
      </div>
    </Modal>
  )
}
