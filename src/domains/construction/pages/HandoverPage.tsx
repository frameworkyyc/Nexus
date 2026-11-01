import { identity } from '@/app/identity'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { CompactInput, Input, Select, Textarea } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { addDeficiency, addRequirement, recordAcceptance, removeRequirement, renameRequirement, reopenHandover, setDeficiencyStatus, setHandoverNotes, setRequirementDone, submitHandover } from '../actions'
import { ACCEPTANCE_LABEL, AUTO_METRIC_LABEL } from '../config'
import { paths } from '../paths'
import { completionOf } from '../completionBasis'
import { evaluateHandover, foundationsOf, type HandoverEvaluation } from '../selectors'
import { useConstruction, useRun } from '../store'
import { fraction, phaseTone } from '../ui'
import type { AutoMetric } from '../types'

export function HandoverPage() {
  const { projectId = '' } = useParams()
  const { state, idx } = useConstruction()
  const navigate = useNavigate()
  const rows = state.areas.map((a) => ({ area: a, ev: evaluateHandover(idx, a.id) }))
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'a', header: 'Area', render: (r) => <span className="font-medium">{r.area.name}</span> },
    { key: 'c', header: 'Construction', render: (r) => <span className="tabular-nums">{completionOf(idx, foundationsOf(idx, r.area.id), 'type').percent ?? 0}%</span> },
    { key: 'f', header: 'Outstanding foundations', render: (r) => r.ev.outstandingFoundations },
    { key: 's', header: 'Survey', hideOnMobile: true, render: (r) => <span className="tabular-nums text-muted">{fraction(r.ev.stats.survey)}</span> },
    { key: 'q', header: 'QA/QC', hideOnMobile: true, render: (r) => <span className="tabular-nums text-muted">{fraction(r.ev.stats.qaqc)}</span> },
    { key: 'd', header: 'Open deficiencies', hideOnMobile: true, render: (r) => r.ev.openDeficiencies },
    { key: 'r', header: 'Requirements met', render: (r) => <span className="tabular-nums">{r.ev.items.filter((i) => i.met).length} / {r.ev.items.length}</span> },
    { key: 'h', header: 'Handover status', render: (r) => <StatusBadge tone={phaseTone(r.ev.phase)} label={r.ev.label} /> },
  ]
  return (
    <>
      <PageHeader title="Area handover" description="Each area is handed over individually. Construction completion and formal acceptance are tracked separately, and the requirements below are configurable placeholders." />
      <DataTable columns={columns} rows={rows} getKey={(r) => r.area.id} onRowClick={(r) => navigate(paths.area(projectId, r.area.id))} />
    </>
  )
}

export function AreaHandover({ areaId }: { areaId: string }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const ev: HandoverEvaluation = evaluateHandover(idx, areaId)
  const { record } = ev
  const [label, setLabel] = useState('')
  const [metric, setMetric] = useState<AutoMetric | ''>('')
  const [by, setBy] = useState('')
  const [defTitle, setDefTitle] = useState('')
  const [notes, setNotes] = useState<string | null>(null)
  const deficiencies = state.deficiencies.filter((d) => d.areaId === areaId)
  const locked = record.acceptance === 'accepted'
  const met = ev.items.filter((i) => i.met).length

  return (
    <>
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <div>
          <h3 className="t-label mb-3">Construction completion</h3>
          <dl className="grid grid-cols-2 gap-5">
            <Stat label="Construction progress" value={`${completionOf(idx, foundationsOf(idx, areaId), 'type').percent ?? 0}%`} sub={`${ev.stats.elementsPoured.done} of ${ev.stats.elementsPoured.total} elements poured`} />
            <Stat label="Outstanding foundations" value={ev.outstandingFoundations} sub={`of ${ev.stats.foundations}`} />
            <Stat label="Survey" value={fraction(ev.stats.survey)} />
            <Stat label="QA/QC approved" value={fraction(ev.stats.qaqc)} />
          </dl>
        </div>
        <div>
          <h3 className="t-label mb-3">Handover acceptance</h3>
          <p className="t-title">{ev.label}</p>
          <p className="mt-1 text-xs text-muted">
            {ACCEPTANCE_LABEL[record.acceptance]}
            {record.submittedDate && ` · submitted ${formatDate(record.submittedDate)}`}
            {record.acceptedDate && ` · accepted ${formatDate(record.acceptedDate)} by ${record.acceptedBy}`}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">Completing construction never marks an area as handed over. Acceptance is recorded deliberately, after the area is submitted.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(record.acceptance === 'not-submitted' || record.acceptance === 'returned') && <Button variant="primary" onClick={() => run(submitHandover(areaId, today, ev.allMet))} disabled={!ev.allMet}>Submit for handover</Button>}
            {record.acceptance === 'submitted' && (
              <>
                <Input className="w-48" placeholder="Accepted by" aria-label="Accepted by" value={by} onChange={(e) => setBy(e.target.value)} />
                <Button variant="primary" onClick={() => run(recordAcceptance(areaId, true, by, today))}>Record acceptance</Button>
                <Button onClick={() => run(recordAcceptance(areaId, false, '', today))}>Return with comments</Button>
              </>
            )}
            {record.acceptance !== 'not-submitted' && <Button variant="ghost" onClick={() => window.confirm('Reopen this handover? Submission and acceptance details will be cleared.') && run(reopenHandover(areaId))}>Reopen</Button>}
          </div>
          {!ev.allMet && record.acceptance === 'not-submitted' && <p className="mt-2 text-xs text-muted">{ev.items.length - met} requirement{ev.items.length - met === 1 ? '' : 's'} outstanding before submission.</p>}
        </div>
      </div>

      <Section title="Handover requirements" description={`Placeholder checklist — the actual ${identity.trackerName} handover requirements are not yet defined. Rename, remove or add items. Automatic items are calculated from the records.`}>
        <ul>
          {ev.items.map((i) => {
            const req = record.requirements.find((r) => r.id === i.id)!
            return (
              <li key={i.id} className="flex items-center gap-3 border-b border-line py-2.5 text-[13px]">
                {i.auto ? (
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${i.met ? 'text-ok' : 'text-neutral-300'}`} title="Calculated automatically">{i.met ? <Check size={15} strokeWidth={1.75} /> : <span className="h-3 w-3 rounded-full border border-neutral-300" />}</span>
                ) : (
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-ink" aria-label={`Confirm ${i.label}`} checked={i.met} disabled={locked} onChange={(e) => run(setRequirementDone(areaId, i.id, e.target.checked, today))} />
                )}
                <CompactInput className="min-w-0 flex-1" aria-label="Requirement name" defaultValue={i.label} disabled={locked} onBlur={(e) => e.target.value.trim() && e.target.value !== i.label && run(renameRequirement(areaId, i.id, e.target.value.trim()))} />
                <span className="hidden shrink-0 text-xs text-muted sm:inline">{i.auto ? `${i.detail}` : req.done ? `Confirmed ${formatDate(req.doneDate)}` : 'Manual confirmation'}</span>
                <button aria-label={`Remove ${i.label}`} disabled={locked} className="shrink-0 text-muted hover:text-ink disabled:opacity-30" onClick={() => run(removeRequirement(areaId, i.id))}><X size={14} strokeWidth={1.5} /></button>
              </li>
            )
          })}
        </ul>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (run(addRequirement(areaId, label, metric || null)) === null) { setLabel(''); setMetric('') } }}>
          <Input className="max-w-xs" placeholder="New requirement" aria-label="New requirement" value={label} onChange={(e) => setLabel(e.target.value)} disabled={locked} />
          <Select className="w-64" aria-label="Requirement type" value={metric} onChange={(e) => setMetric(e.target.value as AutoMetric | '')} disabled={locked}>
            <option value="">Manual confirmation</option>
            {(Object.keys(AUTO_METRIC_LABEL) as AutoMetric[]).map((m) => <option key={m} value={m}>Automatic: {AUTO_METRIC_LABEL[m]}</option>)}
          </Select>
          <Button type="submit" disabled={locked}>Add</Button>
        </form>
      </Section>

      <Section title="Deficiencies" description={`${ev.openDeficiencies} open`}>
        <ul className="text-[13px]">
          {deficiencies.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
              <span className={d.status === 'closed' ? 'text-muted line-through' : ''}>{d.title} <span className="text-xs text-muted">· {d.foundationId ? idx.foundation.get(d.foundationId)?.number : 'area'} · {d.severity} · raised {formatDate(d.raised)}</span></span>
              <button className="shrink-0 text-xs text-muted hover:text-ink" onClick={() => run(setDeficiencyStatus(d.id, d.status === 'open' ? 'closed' : 'open', today))}>{d.status === 'open' ? 'Close' : 'Reopen'}</button>
            </li>
          ))}
          {!deficiencies.length && <li className="py-2 text-xs text-muted">None recorded.</li>}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (run(addDeficiency({ areaId, foundationId: null, plinthId: null, title: defTitle, severity: 'minor' }, today)) === null) setDefTitle('') }}>
          <Input className="max-w-sm" placeholder="Raise an area-level deficiency" aria-label="Area deficiency" value={defTitle} onChange={(e) => setDefTitle(e.target.value)} />
          <Button type="submit">Add</Button>
        </form>
      </Section>

      <Section title="Handover notes">
        <Textarea rows={3} value={notes ?? record.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== record.notes && run(setHandoverNotes(areaId, notes))} />
      </Section>
    </>
  )
}
