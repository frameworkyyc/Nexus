import type { ISODate } from '@/lib/date'
import { PROJECT_STATUS_LABEL } from './config'
import { deriveExceptions } from './exceptions'
import { paths } from './paths'
import { statusRank, type Index } from './selectors'

export interface CompanyIssue {
  id: string
  projectId: string
  project: string
  title: string
  status: string
  severity: 'high' | 'medium'
  to: string
}

/**
 * Significant project-level issues across the company. Sources are explicit:
 * the recorded status note of an at-risk or delayed project, issues recorded against summary-tracked projects,
 * and critical items derived from a detailed project's own records. Nothing is inferred from completion percentages.
 */
export function companyIssues(idx: Index, today: ISODate): CompanyIssue[] {
  const s = idx.state
  const out: CompanyIssue[] = []
  for (const p of s.projects.filter((x) => !x.archived)) {
    const to = paths.project(p.id)
    if ((p.status === 'at-risk' || p.status === 'delayed') && p.statusNote) {
      out.push({ id: `status:${p.id}`, projectId: p.id, project: p.name, title: p.statusNote.replace(/ \(recorded\)\.?$/, '').replace(/\.$/, ''), status: PROJECT_STATUS_LABEL[p.status], severity: p.status === 'delayed' ? 'high' : 'medium', to })
    }
    if (p.tracking === 'detailed') {
      for (const e of deriveExceptions(idx, today, p.id).filter((x) => x.severity === 'high').slice(0, 3)) {
        out.push({ id: `ex:${p.id}:${e.id}`, projectId: p.id, project: p.name, title: e.title, status: e.status, severity: 'high', to: e.to })
      }
    } else {
      for (const i of s.projectIssues.filter((x) => x.projectId === p.id && x.status === 'open')) {
        out.push({ id: i.id, projectId: p.id, project: p.name, title: i.title, status: i.severity === 'critical' ? 'Critical' : 'Open', severity: i.severity === 'critical' ? 'high' : 'medium', to })
      }
    }
  }
  const proj = (id: string) => s.projects.find((p) => p.id === id)!
  return out.sort((a, b) => (a.severity === b.severity ? statusRank(proj(a.projectId).status) - statusRank(proj(b.projectId).status) : a.severity === 'high' ? -1 : 1))
}
