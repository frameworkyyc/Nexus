import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { EmptyState } from '@/components/ui/EmptyState'
import { CompactSelect, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProgressBar } from '@/components/ui/Progress'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { formatDate } from '@/lib/format'
import { addDeficiency, linkFoundationDoc, returnAllocation, setBoltsReady, setDeficiencyStatus, setFoundationNotes, setPlinthAnchorage, setPlinthNotes } from '../actions'
import { ActivityTable } from '../ActivityTable'
import { DocumentModal } from '../DocumentModal'
import { paths } from '../paths'
import {
  BOLT_STAGE_LABEL, areaOfPlinth, computeStats, deriveIssues, footingActivities, footingStep, foundationActivities, foundationState, plinthActivities, plinthBoltRequirements,
  plinthBoltStage, plinthHardware, plinthState, plinthStep, progressOf, specLabel,
} from '../selectors'
import { useConstruction, useRun } from '../store'
import { FoundationStateBadge, fraction, IssueList } from '../ui'
import type { Foundation, Plinth } from '../types'

export function FoundationPage() {
  const { projectId = '', foundationId = '' } = useParams()
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const [params] = useSearchParams()
  const [addingDoc, setAddingDoc] = useState(false)
  const [notes, setNotes] = useState<string | null>(null)
  const [defTitle, setDefTitle] = useState('')
  const [defSeverity, setDefSeverity] = useState<'minor' | 'major'>('minor')
  const f = idx.foundation.get(foundationId)
  if (!f) return <EmptyState title="Foundation not found" action={<Link to={paths.register(projectId)} className="text-[13px] underline underline-offset-4">Back to register</Link>} />

  const area = idx.area.get(f.areaId)!
  const plinths = idx.plinthsByFoundation.get(f.id) ?? []
  const stats = computeStats(idx, [f])
  const fs = foundationState(idx, f)
  const acts = foundationActivities(idx, f)
  const planned = acts.map((a) => a.plannedDate).filter(Boolean).sort() as string[]
  const actual = acts.map((a) => a.actualDate).filter(Boolean).sort() as string[]
  const issues = deriveIssues(idx, today, projectId).filter((i) => i.foundationId === f.id && i.category !== 'deficiency')
  const deficiencies = state.deficiencies.filter((d) => d.foundationId === f.id)
  const wantedPlinth = params.get('plinth')

  return (
    <>
      <Link to={paths.area(projectId, area.id, 'register')} className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.5} />{area.name} register
      </Link>
      <PageHeader title={f.number} description={`${area.name} · ${f.description} · ${plinths.length} plinth${plinths.length === 1 ? '' : 's'}`} actions={<FoundationStateBadge state={fs.state} blocked={fs.blocked} />} />

      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-5">
        <Stat label="Construction" value={`${stats.progress}%`} sub={`${stats.elementsPoured.done} of ${stats.elementsPoured.total} elements poured`} />
        <Stat label="Footing step" value={<span className="text-xl font-normal tracking-normal">{footingStep(idx, f)}</span>} />
        <Stat label="Plinths poured" value={fraction(stats.plinthPoured)} />
        <Stat label="Survey" value={fraction(stats.survey)} sub="Separate from QA/QC" />
        <Stat label="QA/QC" value={fraction(stats.qaqc)} sub={`${stats.qaqc.pending} pending review`} />
      </dl>

      <Section title="Required materials" description="Anchor bolts, hardware and templates per plinth. Allocation is managed in Materials.">
        <ul className="text-[13px]">
          {plinths.map((p) => {
            const hw = plinthHardware(idx, p, f.areaId)
            const bolts = plinthBoltRequirements(idx, p)
            const tpl = (idx.fabByPlinth.get(p.id) ?? [])[0]
            return (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-line py-3">
                <span className="w-20 font-medium">Plinth {p.index}</span>
                <span className="w-16">{p.anchorageTypeId ?? '—'}</span>
                <span className="text-muted">Bolts: {bolts.map((b) => `${b.allocated}/${b.qty} × ${specLabel(b.spec)}`).join(', ') || '—'} · {BOLT_STAGE_LABEL[plinthBoltStage(idx, p)]}</span>
                <span className="text-muted">{hw.map((h) => `${h.kind === 'nut' ? 'Nuts' : 'Washers'} ${h.allocated}/${h.demand}`).join(' · ')}</span>
                <span className="text-muted">Template: {tpl ? `${tpl.number}${tpl.siteReceipt === 'received' ? ' (on site)' : ''}` : 'none requested'}</span>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted"><Link to={paths.materials(projectId)} className="underline underline-offset-4 hover:text-ink">Open Materials</Link> to receive, allocate and order.</p>
      </Section>

      <Section title="Footing" description="Foundation-level activities, tracked separately from each plinth.">
        <ActivityTable activities={footingActivities(idx, f)} />
      </Section>

      <Section title="Plinths" description="Each plinth is tracked independently.">
        <div className="border-t border-line">
          {plinths.map((p) => (
            <PlinthBlock key={p.id} f={f} p={p} projectId={projectId} defaultOpen={plinths.length === 1 || wantedPlinth === p.id} />
          ))}
        </div>
      </Section>

      <Section title="Dates">
        <dl className="grid grid-cols-2 gap-6 text-[13px] lg:grid-cols-4">
          <div><dt className="t-label">First planned</dt><dd className="mt-1">{formatDate(planned[0])}</dd></div>
          <div><dt className="t-label">Last planned</dt><dd className="mt-1">{formatDate(planned[planned.length - 1])}</dd></div>
          <div><dt className="t-label">First actual</dt><dd className="mt-1">{formatDate(actual[0])}</dd></div>
          <div><dt className="t-label">Latest actual</dt><dd className="mt-1">{formatDate(actual[actual.length - 1])}</dd></div>
        </dl>
      </Section>

      <Section title="Outstanding issues" description="Derived from this foundation's records, plus deficiencies you raise here.">
        <IssueList issues={issues} empty="No derived issues." />
        <h3 className="t-label mb-1 mt-6">Deficiencies</h3>
        <ul className="text-[13px]">
          {deficiencies.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
              <span className={d.status === 'closed' ? 'text-muted line-through' : ''}>{d.title} <span className="text-xs text-muted">· {d.severity} · raised {formatDate(d.raised)}</span></span>
              <button className="shrink-0 text-xs text-muted hover:text-ink" onClick={() => run(setDeficiencyStatus(d.id, d.status === 'open' ? 'closed' : 'open', today))}>{d.status === 'open' ? 'Close' : 'Reopen'}</button>
            </li>
          ))}
          {!deficiencies.length && <li className="py-2 text-xs text-muted">No deficiencies recorded.</li>}
        </ul>
        <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (run(addDeficiency({ areaId: f.areaId, foundationId: f.id, plinthId: null, title: defTitle, severity: defSeverity }, today)) === null) setDefTitle('') }}>
          <Input className="max-w-sm" placeholder="Raise a deficiency" aria-label="Deficiency description" value={defTitle} onChange={(e) => setDefTitle(e.target.value)} />
          <Select className="w-28" aria-label="Severity" value={defSeverity} onChange={(e) => setDefSeverity(e.target.value as 'minor' | 'major')}><option value="minor">Minor</option><option value="major">Major</option></Select>
          <Button type="submit">Add</Button>
        </form>
      </Section>

      <Section title="Linked documents" description="Placeholder records for the demonstration. No files are stored." actions={<Button onClick={() => setAddingDoc(true)}>Add document record</Button>}>
        <ul className="text-[13px]">
          {f.docIds.map((id) => {
            const d = state.documents.find((x) => x.id === id)
            return (
              <li key={id} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
                <span>{d?.title ?? id} <span className="text-xs text-muted">· {d?.kind} · Rev {d?.revision}</span></span>
                <button className="text-xs text-muted hover:text-ink" onClick={() => run(linkFoundationDoc(f.id, id, false))}>Unlink</button>
              </li>
            )
          })}
          {!f.docIds.length && <li className="py-2 text-xs text-muted">No documents linked.</li>}
        </ul>
        {state.documents.some((d) => !f.docIds.includes(d.id)) && (
          <CompactSelect className="mt-2" aria-label="Link an existing document" value="" onChange={(e) => e.target.value && run(linkFoundationDoc(f.id, e.target.value, true))}>
            <option value="">Link an existing document…</option>
            {state.documents.filter((d) => !f.docIds.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </CompactSelect>
        )}
      </Section>

      <Section title="Notes">
        <Textarea rows={3} value={notes ?? f.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== f.notes && run(setFoundationNotes(f.id, notes))} placeholder="Foundation notes" />
      </Section>

      {addingDoc && <DocumentModal onClose={() => setAddingDoc(false)} onCreated={(id) => run(linkFoundationDoc(f.id, id, true))} />}
    </>
  )
}

function PlinthBlock({ f, p, projectId, defaultOpen }: { f: Foundation; p: Plinth; projectId: string; defaultOpen: boolean }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const [notes, setNotes] = useState<string | null>(null)
  const acts = plinthActivities(idx, p)
  const ps = plinthState(idx, p)
  const reqs = plinthBoltRequirements(idx, p)
  const hw = plinthHardware(idx, p, areaOfPlinth(idx, p))
  const stage = plinthBoltStage(idx, p)
  const allocs = state.allocations.filter((a) => a.plinthId === p.id)
  const ready = stage === 'ready'

  return (
    <Disclosure
      defaultOpen={defaultOpen}
      summary={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
          <span className="font-medium">Plinth {p.index}</span>
          <span>{p.anchorageTypeId ?? 'No anchorage type'}</span>
          <span className="text-muted">{plinthStep(idx, p)}</span>
          <ProgressBar value={progressOf(idx, acts)} width="w-20" />
          <FoundationStateBadge state={ps.state} blocked={ps.blocked} />
        </div>
      }
    >
      <div className="space-y-8">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Anchorage type">
            <Select value={p.anchorageTypeId ?? ''} onChange={(e) => run(setPlinthAnchorage(p.id, e.target.value || null))}>
              <option value="">None assigned</option>
              {state.anchorageTypes.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.description}</option>)}
            </Select>
          </Field>
          <div>
            <span className="t-label mb-1.5 block">Anchor bolts</span>
            <p className="text-[13px]">{BOLT_STAGE_LABEL[stage]}</p>
            <div className="mt-2 flex gap-2">
              <Button disabled={!reqs.length} onClick={() => run(setBoltsReady(p.id, !ready, today))}>{ready ? 'Unmark ready' : 'Mark ready for installation'}</Button>
              <Link to={paths.materials(projectId)} className="inline-flex h-9 items-center text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">Allocate in Materials</Link>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
            <thead><tr className="border-b border-line">{['Material', 'Required', 'Allocated', 'Remaining'].map((h) => <th key={h} className="t-label py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {reqs.map((r) => <tr key={r.spec.id} className="border-b border-line"><td className="py-2 pr-4">{specLabel(r.spec)} anchor bolt <span className="text-xs text-muted">{r.spec.id} · {r.spec.grade}</span></td><td className="pr-4">{r.qty}</td><td className="pr-4">{r.allocated}</td><td>{Math.max(0, r.qty - r.allocated)}</td></tr>)}
              {hw.map((h, i) => <tr key={i} className="border-b border-line"><td className="py-2 pr-4">{h.kind === 'nut' ? 'Nut' : 'Washer'} {h.size}</td><td className="pr-4">{h.demand}</td><td className="pr-4">{h.allocated}</td><td>{Math.max(0, h.demand - h.allocated)}</td></tr>)}
              {!reqs.length && <tr><td colSpan={4} className="py-3 text-muted">Assign an anchorage type to see material requirements.</td></tr>}
            </tbody>
          </table>
          {allocs.length > 0 && (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer hover:text-ink">{allocs.length} allocation record{allocs.length === 1 ? '' : 's'}</summary>
              <ul className="mt-1">
                {allocs.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 py-1">
                    <span>{a.qty} × {a.itemType === 'bolt' ? idx.spec.get(a.itemId)?.id : idx.bulk.get(a.itemId)?.description} · {formatDate(a.date)}</span>
                    <button className="hover:text-ink" onClick={() => run(returnAllocation(a.id))}>Return to stock</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <ActivityTable activities={acts} />

        <label className="block">
          <span className="t-label mb-1 block">Plinth notes</span>
          <Textarea rows={2} value={notes ?? p.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== p.notes && run(setPlinthNotes(p.id, notes))} />
        </label>
        <p className="text-xs text-muted">{f.number} · Plinth {p.index}</p>
      </div>
    </Disclosure>
  )
}
