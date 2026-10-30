import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { deriveIssues, type IssueCategory } from '../selectors'
import { useConstruction } from '../store'
import { IssueList } from '../ui'

const CATEGORIES: Record<IssueCategory, string> = {
  blocked: 'Blocked', overdue: 'Overdue', sequence: 'Sequence', material: 'Materials', procurement: 'Procurement', inspection: 'Inspections',
  survey: 'Survey', deficiency: 'Deficiencies', delivery: 'Deliveries', fabrication: 'Fabrication',
}

/** Every derived issue, for when the dashboard's short list is not enough. */
export function IssuesPage() {
  const { projectId = '' } = useParams()
  const { state, idx, today } = useConstruction()
  const [params] = useSearchParams()
  const [area, setArea] = useState(params.get('area') ?? 'all')
  const [category, setCategory] = useState<IssueCategory | 'all'>('all')
  const all = deriveIssues(idx, today, projectId)
  const issues = all.filter((i) => (area === 'all' || i.areaId === area) && (category === 'all' || i.category === category))
  return (
    <>
      <PageHeader title="All issues" description={`${issues.length} of ${all.length}`} />
      <div className="mb-3 flex flex-wrap gap-3">
        <Select className="w-44" aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="all">All areas</option>
          {state.areas.filter((a) => a.projectId === projectId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select className="w-44" aria-label="Filter by type" value={category} onChange={(e) => setCategory(e.target.value as IssueCategory | 'all')}>
          <option value="all">All types</option>
          {(Object.keys(CATEGORIES) as IssueCategory[]).map((c) => <option key={c} value={c}>{CATEGORIES[c]}</option>)}
        </Select>
      </div>
      <IssueList issues={issues} />
    </>
  )
}
