import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CompactInput, CompactSelect, Textarea } from '@/components/ui/Field'
import { updateActivity } from './actions'
import { CATEGORY_LABEL, CATEGORY_ORDER, STATUS_LABEL, STATUS_OPTIONS, getDef } from './config'
import { paths } from './paths'
import { derivedNote, effectiveStatus, isReady } from './selectors'
import { useConstruction, useRun } from './store'
import { ActivityStatusBadge } from './ui'
import type { Activity, Person } from './types'

function assignees(people: Person[], category: string): Person[] {
  if (category === 'survey') return people.filter((p) => p.role === 'surveyor')
  if (category === 'qaqc') return people.filter((p) => p.role === 'qc-inspector')
  if (category === 'materials') return people.filter((p) => p.role === 'coordinator')
  return people.filter((p) => p.role === 'foreman' || p.role === 'carpenter' || p.role === 'superintendent')
}

function ActivityRow({ a }: { a: Activity }) {
  const { state, idx, today } = useConstruction()
  const run = useRun()
  const { projectId = 'reef' } = useParams()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(a.notes)
  const def = getDef(a.scope, a.key)
  const status = effectiveStatus(idx, a)
  const note = derivedNote(idx, a)
  const waiting = !def.derived && status !== 'complete' && status !== 'approved' && !isReady(idx, a)
  const patch = (p: Parameters<typeof updateActivity>[1]) => run(updateActivity(a.id, p, today))
  const unlinked = state.documents.filter((d) => !a.docIds.includes(d.id))

  return (
    <>
      <tr className="border-b border-line">
        <td className="py-2.5 pr-4 align-top text-[13px]">
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-start gap-2 text-left">
            <ChevronRight size={13} strokeWidth={1.5} className={`mt-1 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
            <span>
              {def.label}
              {(a.notes || a.docIds.length > 0) && <span className="ml-2 text-xs text-muted">{a.notes ? 'note' : ''}{a.notes && a.docIds.length ? ' · ' : ''}{a.docIds.length ? `${a.docIds.length} doc${a.docIds.length > 1 ? 's' : ''}` : ''}</span>}
              {waiting && <span className="block text-xs text-muted">Prerequisites not yet complete</span>}
            </span>
          </button>
        </td>
        <td className="py-1.5 pr-4 align-top">
          {def.derived ? (
            <div className="py-1">
              <ActivityStatusBadge status={status} />
              <span className="block text-xs text-muted">{note}</span>
              <Link to={def.derived === 'templates' ? paths.fabrication(projectId) : paths.materials(projectId)} className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline">
                Managed in {def.derived === 'templates' ? 'Fabrication' : 'Materials'}
              </Link>
            </div>
          ) : (
            <CompactSelect aria-label={`${def.label} status`} value={status} onChange={(e) => patch({ status: e.target.value as Activity['status'] })}>
              {STATUS_OPTIONS[def.statusSet].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </CompactSelect>
          )}
        </td>
        <td className="py-1.5 pr-3 align-top"><CompactInput type="date" aria-label={`${def.label} planned date`} value={a.plannedDate ?? ''} onChange={(e) => patch({ plannedDate: e.target.value || null })} /></td>
        <td className="py-1.5 pr-3 align-top"><CompactInput type="date" aria-label={`${def.label} actual date`} value={a.actualDate ?? ''} onChange={(e) => patch({ actualDate: e.target.value || null })} /></td>
        <td className="hidden py-1.5 pr-3 align-top md:table-cell">
          <CompactSelect aria-label={`${def.label} assignee`} value={a.assigneeId ?? ''} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {assignees(state.people, def.category).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </CompactSelect>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-canvas">
          <td colSpan={5} className="space-y-4 px-6 py-4">
            <div className="md:hidden">
              <span className="t-label mb-1 block">Assigned</span>
              <CompactSelect value={a.assigneeId ?? ''} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {assignees(state.people, def.category).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </CompactSelect>
            </div>
            <label className="block">
              <span className="t-label mb-1 block">Notes</span>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== a.notes && patch({ notes })} placeholder="Add a note" />
            </label>
            <div>
              <span className="t-label mb-1 block">Linked documents</span>
              {a.docIds.length === 0 && <p className="text-xs text-muted">None linked.</p>}
              <ul className="text-[13px]">
                {a.docIds.map((id) => {
                  const d = state.documents.find((x) => x.id === id)
                  return (
                    <li key={id} className="flex items-center justify-between gap-4 py-1">
                      <span>{d?.title ?? id} <span className="text-xs text-muted">· Rev {d?.revision}</span></span>
                      <button className="text-xs text-muted hover:text-ink" onClick={() => patch({ docIds: a.docIds.filter((x) => x !== id) })}>Unlink</button>
                    </li>
                  )
                })}
              </ul>
              {unlinked.length > 0 && (
                <CompactSelect className="mt-1 max-w-full" aria-label="Link a document" value="" onChange={(e) => e.target.value && patch({ docIds: [...a.docIds, e.target.value] })}>
                  <option value="">Link a document…</option>
                  {unlinked.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </CompactSelect>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function ActivityTable({ activities }: { activities: Activity[] }) {
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: activities.filter((a) => getDef(a.scope, a.key).category === c) })).filter((g) => g.items.length)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {['Activity', 'Status', 'Planned', 'Actual'].map((h) => <th key={h} className="t-label py-2 pr-4 font-medium">{h}</th>)}
            <th className="t-label hidden py-2 pr-4 font-medium md:table-cell">Assigned</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.c}>
            <tr><td colSpan={5} className="pb-1 pt-5 text-xs font-medium text-muted">{CATEGORY_LABEL[g.c]}</td></tr>
            {g.items.map((a) => <ActivityRow key={a.id} a={a} />)}
          </tbody>
        ))}
      </table>
    </div>
  )
}
