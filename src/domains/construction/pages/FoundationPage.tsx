import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Disclosure } from '@/components/ui/Disclosure'
import { EmptyState } from '@/components/ui/EmptyState'
import { CompactSelect, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { foundationQuantity, plinthsPerFoundation, totalPlinths } from '../foundationQuantity'
import { ProgressBar } from '@/components/ui/Progress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Section } from '@/components/ui/Section'
import { Stat } from '@/components/ui/Stat'
import { formatDate } from '@/lib/format'
import { addDeficiency, linkFoundationDoc, setDeficiencyStatus, setPlinthAnchorage } from '../actions'
import { setFoundationNotes, setPlinthNotes } from '../commands'
import { FoundationMaterials } from './FoundationMaterials'
import { ActivityTable } from '../ActivityTable'
import { DocumentModal } from '../DocumentModal'
import { STATUS_LABEL, STATUS_TONE, FOUNDATION_COMPLETE_DEFINITION } from '../config'
import { paths } from '../paths'
import {
  computeStats, deriveIssues, footingActivities, footingStep, foundationActivities, foundationState, plinthActivities,
  effectiveStatus, plinthMaterials, plinthState, plinthStep, progressOf, tallyCategory, type Index,
} from '../selectors'
import { useConstruction, useConstructionCommand, useRun } from '../store'
import { FoundationStateBadge, fraction, IssueList } from '../ui'
import { FoundationConcrete } from './FoundationConcrete'
import { FOUNDATION_STATE_LABEL } from '../selectors'
import type { Activity, Foundation, Plinth } from '../types'

export function FoundationPage() {
  const { projectId = '', foundationId = '' } = useParams()
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const { run: save } = useConstructionCommand()
  const [params] = useSearchParams()
  const [addingDoc, setAddingDoc] = useState(false)
  const [notes, setNotes] = useState<string | null>(null)
  const [defTitle, setDefTitle] = useState('')
  const [defSeverity, setDefSeverity] = useState<'minor' | 'major'>('minor')
  const f = idx.foundation.get(foundationId)
  if (!f) return <EmptyState title="Foundation not found" action={<Link to={paths.register(projectId)} className="text-[13px] underline underline-offset-4">Back to foundations</Link>} />

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
      <Link to={paths.area(projectId, area.id, 'register')} className="mb-5 phone:hidden inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} strokeWidth={1.5} />{area.name} foundations
      </Link>
      <PageHeader title={f.number} description={[area.name, f.description, `Quantity ${foundationQuantity(f).toLocaleString('en-CA')}`, plinthsPerFoundation(f, plinths.length) === null ? 'Plinths per foundation not known' : `${plinthsPerFoundation(f, plinths.length)} plinth${plinthsPerFoundation(f, plinths.length) === 1 ? '' : 's'} per foundation`, totalPlinths(f, plinths.length) === null ? '' : `${totalPlinths(f, plinths.length)!.toLocaleString('en-CA')} plinths in total`].filter(Boolean).join(' · ')} actions={<FoundationStateBadge state={fs.state} blocked={fs.blocked} />} />

      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-5">
        <Stat label="Construction" value={`${stats.progress}%`} sub={`${stats.elementsPoured.done} of ${stats.elementsPoured.total} elements poured`} />
        <Stat label="Status" value={<span className="text-xl font-normal tracking-normal">{FOUNDATION_STATE_LABEL[fs.state]}</span>} sub={fs.state === 'closed-out' ? 'Survey and QA/QC complete' : fs.state === 'constructed' ? 'Close-out outstanding' : footingStep(idx, f)} />
        <Stat label="Materials ready" value={`${plinths.filter((p) => plinthMaterials(idx, p).ready).length}/${plinths.length}`} sub="Plinths with everything on hand" />
        <Stat label="Survey" value={fraction(stats.survey)} sub="Separate from QA/QC" />
        <Stat label="QA/QC" value={fraction(stats.qaqc)} sub={`${stats.qaqc.pending} pending review`} />
      </dl>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">{FOUNDATION_COMPLETE_DEFINITION}</p>

      <Section title="At a glance" description="The footing and each plinth, side by side.">
        <Glance idx={idx} f={f} plinths={plinths} />
      </Section>

      <FoundationConcrete f={f} plinths={plinths} projectId={projectId} />

      <Section title="Materials" description="What this foundation needs, from its anchorage types and its own bolts and plates, and where each stands. The figures are the same as in Materials and Procurement; ordering, delivery and allocation are managed there.">
        <FoundationMaterials idx={idx} foundationId={f.id} />
        <p className="mt-2 text-xs text-muted"><Link to={paths.procurement(projectId)} className="underline underline-offset-4 hover:text-ink">Open Procurement</Link> to order, receive and allocate.</p>
      </Section>

      <Section title="Footing" description="Foundation-level activities, tracked separately from each plinth.">
        <ActivityTable activities={footingActivities(idx, f)} />
      </Section>

      <Section title="Plinths" description="Each plinth is tracked independently.">
        <div className="border-t border-line">
          {plinths.map((p) => (
            <PlinthBlock key={p.id} f={f} p={p} defaultOpen={plinths.length === 1 || wantedPlinth === p.id} />
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
        <Textarea rows={3} value={notes ?? f.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== f.notes && save(setFoundationNotes(f.id, notes))} placeholder="Foundation notes" />
      </Section>

      {addingDoc && <DocumentModal onClose={() => setAddingDoc(false)} onCreated={(id) => run(linkFoundationDoc(f.id, id, true))} />}
    </>
  )
}

function PlinthBlock({ f, p, defaultOpen }: { f: Foundation; p: Plinth; defaultOpen: boolean }) {
  const { state, idx } = useConstruction()
  const run = useRun()
  const { run: save } = useConstructionCommand()
  const [notes, setNotes] = useState<string | null>(null)
  const acts = plinthActivities(idx, p)
  const ps = plinthState(idx, p)
  const grouped = (state.anchorageGroups ?? []).some((g) => g.id === p.groupId)

  return (
    <Disclosure
      defaultOpen={defaultOpen}
      summary={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
          <span className="font-medium">Plinth {p.index}</span>
          <span>{state.anchorageTypes.find((t) => t.id === p.anchorageTypeId)?.code ?? 'No anchorage type'}</span>
          <span className="text-muted">{plinthStep(idx, p)}</span>
          <ProgressBar value={progressOf(idx, acts)} width="w-20" />
          <FoundationStateBadge state={ps.state} blocked={ps.blocked} />
        </div>
      }
    >
      <div className="space-y-8">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Anchorage type">
            <Select disabled={grouped} value={p.anchorageTypeId ?? ''} onChange={(e) => run(setPlinthAnchorage(p.id, e.target.value || null))}>
              <option value="">None assigned</option>
              {state.anchorageTypes.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.description}</option>)}
            </Select>
            {grouped && <p className="mt-1 text-xs text-muted">Set by this foundation’s anchorage groups (Manage in Foundations).</p>}
          </Field>
          <div>
            <span className="t-label mb-1.5 block">Materials</span>
            <p className="text-[13px] text-muted">Tracked for the whole foundation: see Materials above.</p>
          </div>
        </div>

        <ActivityTable activities={acts} />

        <label className="block">
          <span className="t-label mb-1 block">Plinth notes</span>
          <Textarea rows={2} value={notes ?? p.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== p.notes && save(setPlinthNotes(p.id, notes))} />
        </label>
        <p className="text-xs text-muted">{f.number} · Plinth {p.index}</p>
      </div>
    </Disclosure>
  )
}

function Glance({ idx, f, plinths }: { idx: Index; f: Foundation; plinths: Plinth[] }) {
  const stage = (acts: Activity[], key: string) => {
    const a = acts.find((x) => x.key === key)
    const s = a ? effectiveStatus(idx, a) : 'not-started'
    return <StatusBadge tone={STATUS_TONE[s]} label={STATUS_LABEL[s]} />
  }
  const rebar = (acts: Activity[]) => {
    const done = (k: string) => { const a = acts.find((x) => x.key === k); return a && ['complete', 'approved'].includes(effectiveStatus(idx, a)) ? 1 : 0 }
    return <ProgressBar value={((done('rebarBuilt') + done('rebarInstalled')) / 2) * 100} width="w-16" showValue={false} />
  }
  const check = (acts: Activity[], cat: 'survey' | 'qaqc') => {
    const t = tallyCategory(idx, acts, cat)
    return <StatusBadge tone={t.blocked ? 'bad' : t.done === t.total ? 'ok' : t.pending ? 'warn' : t.done > 0 ? 'info' : 'muted'} label={fraction(t)} />
  }
  const rows: { key: string; label: string; acts: Activity[]; materials: React.ReactNode }[] = [
    { key: 'footing', label: 'Footing', acts: footingActivities(idx, f), materials: <span className="text-muted">—</span> },
    ...plinths.map((p) => {
      const m = plinthMaterials(idx, p)
      return { key: p.id, label: `Plinth ${p.index} · ${(p.anchorageTypeId && idx.anchorage.get(p.anchorageTypeId)?.code) || 'no anchorage'}`, acts: plinthActivities(idx, p), materials: <StatusBadge tone={m.ready ? 'ok' : m.done > 0 ? 'info' : 'muted'} label={m.ready ? 'Ready' : `${m.done}/${m.total}`} /> }
    }),
  ]
  return (
    <div className="overflow-x-auto">
      <table className="card-table w-full min-w-[640px] border-collapse text-left">
        <thead><tr className="border-b border-line">{['Element', 'Rebar', 'Forming', 'Pouring', 'Survey', 'QA/QC', 'Materials'].map((h) => <th key={h} className="t-label py-3 pr-4 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line">
              <td className="py-3 pr-4 text-[13px] font-medium">{r.label}</td>
              <td className="py-3 pr-4">{rebar(r.acts)}</td>
              <td className="py-3 pr-4">{stage(r.acts, 'formed')}</td>
              <td className="py-3 pr-4">{stage(r.acts, 'poured')}</td>
              <td className="py-3 pr-4">{check(r.acts, 'survey')}</td>
              <td className="py-3 pr-4">{check(r.acts, 'qaqc')}</td>
              <td className="py-3 pr-4">{r.materials}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
