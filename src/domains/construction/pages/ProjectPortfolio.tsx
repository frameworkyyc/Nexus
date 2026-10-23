import { identity } from '@/app/identity'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CARD, MeterBar, SortBar } from '@/components/mobile/Cards'
import { useIsPhone } from '@/lib/useMedia'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Field'
import { ProgressBar } from '@/components/ui/Progress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { IN_DELIVERY, PROJECT_STATUS_LABEL, PROJECT_STATUS_RANK, PROJECT_STATUS_TONE } from '../config'
import { deriveExceptions } from '../exceptions'
import { paths } from '../paths'
import { projectSummaries, type ProjectSummary } from '../selectors'
import { useConstruction } from '../store'
import type { ProjectStatus } from '../types'

type SortKey = 'status' | 'name' | 'job' | 'completion'
type Filter = ProjectStatus | 'in-delivery' | 'all'

/** Searchable, sortable, filterable project list that stays usable with hundreds of projects. */
export function ProjectPortfolio({ pageSize = 10 }: { pageSize?: number }) {
  const { idx, today } = useConstruction()
  const navigate = useNavigate()
  const phone = useIsPhone()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 })
  const [shown, setShown] = useState(pageSize)

  const all = useMemo(() => projectSummaries(idx, (id) => deriveExceptions(idx, today, id)), [idx, today])
  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const value = (r: ProjectSummary) => (sort.key === 'name' ? r.project.name.toLowerCase() : sort.key === 'job' ? Number(r.project.jobNumber) : sort.key === 'completion' ? r.progress : PROJECT_STATUS_RANK[r.project.status])
    return all
      .filter((r) => (filter === 'all' ? true : filter === 'in-delivery' ? IN_DELIVERY.includes(r.project.status) : r.project.status === filter))
      .filter((r) => !q || [r.project.name, r.project.jobNumber, r.project.client, r.project.location].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => {
        const [x, y] = [value(a), value(b)]
        return (x < y ? -1 : x > y ? 1 : Number(a.project.jobNumber) - Number(b.project.jobNumber)) * sort.dir
      })
  }, [all, filter, q, sort])

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'completion' ? -1 : 1 }))
  const Th = ({ k, children, hide }: { k: SortKey; children: React.ReactNode; hide?: boolean }) => (
    <th className={`t-label py-3 pr-5 font-medium ${hide ? 'hidden sm:table-cell' : ''}`} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => toggle(k)} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink">
        {children}
        {sort.key === k && <span aria-hidden>{sort.dir === 1 ? '↑' : '↓'}</span>}
      </button>
    </th>
  )
  const reset = (fn: () => void) => { fn(); setShown(pageSize) }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input data-search className="sm:max-w-xs" type="search" placeholder="Search name, job number, client" aria-label="Search projects" value={query} onChange={(e) => reset(() => setQuery(e.target.value))} />
        <Select className="sm:w-44" aria-label="Filter projects by status" value={filter} onChange={(e) => reset(() => setFilter(e.target.value as Filter))}>
          <option value="all">All projects</option>
          <option value="in-delivery">Active (in delivery)</option>
          {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
        </Select>
        {phone && <SortBar options={[{ key: 'status', label: 'Status' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job number' }, { key: 'completion', label: 'Completion' }]} value={sort.key} dir={sort.dir} onChange={(k) => setSort({ key: k, dir: k === 'completion' ? -1 : 1 })} onToggleDir={() => setSort((x) => ({ ...x, dir: x.dir === 1 ? -1 : 1 }))} />}
        <span className="text-[13px] text-muted sm:ml-auto">{rows.length} of {all.length} projects</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No projects match" description="Adjust the search or status filter." />
      ) : phone ? (
        <ul className="space-y-3" aria-label="Projects">
          {rows.slice(0, shown).map((r) => (
            <li key={r.project.id}>
              <Link to={paths.project(r.project.id)} className={`${CARD} block p-4 active:bg-hover`}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-[17px] font-medium leading-snug">{r.project.name}</span>
                  <StatusBadge tone={PROJECT_STATUS_TONE[r.project.status]} label={PROJECT_STATUS_LABEL[r.project.status]} className="mt-0.5 shrink-0 text-[14px]" />
                </span>
                <span className="mt-1 block text-[14px] text-muted">Job {r.project.jobNumber} · {r.project.client}</span>
                <span className="mt-3 flex items-center gap-3"><MeterBar value={r.progress} label={`${r.project.name} completion`} /><span className="w-12 shrink-0 text-right text-[16px] font-medium tabular-nums">{r.progress}%</span></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <Th k="name">Project</Th>
                <Th k="job" hide>Job</Th>
                <Th k="completion">Completion</Th>
                <Th k="status">Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r) => (
                <tr key={r.project.id} onClick={() => navigate(paths.project(r.project.id))} className="cursor-pointer border-b border-line transition-colors hover:bg-hover">
                  <td className="py-3.5 pr-5 text-[13px]">
                    <Link to={paths.project(r.project.id)} onClick={(e) => e.stopPropagation()} className="font-medium underline-offset-4 hover:underline">{r.project.name}</Link>
                    <span className="block text-xs text-muted"><span className="sm:hidden">Job {r.project.jobNumber} · </span>{r.project.client}</span>
                  </td>
                  <td className="hidden py-3.5 pr-5 font-mono text-xs text-muted sm:table-cell">{r.project.jobNumber}</td>
                  <td className="py-3.5 pr-5"><ProgressBar value={r.progress} width="w-16 sm:w-28" /></td>
                  <td className="py-3.5 pr-2"><StatusBadge tone={PROJECT_STATUS_TONE[r.project.status]} label={PROJECT_STATUS_LABEL[r.project.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <div className="mt-4 flex justify-center"><Button onClick={() => setShown(shown + pageSize)}>Show {Math.min(pageSize, rows.length - shown)} more</Button></div>
      )}
      <p className="mt-4 text-xs text-muted">Completion is calculated from activity records for projects with detailed tracking (such as {identity.trackerName}) and is the reported figure for the others. Status is always recorded by a person.</p>
    </div>
  )
}
