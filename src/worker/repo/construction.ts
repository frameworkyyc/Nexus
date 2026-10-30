import type { Row, RowSet } from '../db'
import { blankActivitiesFor } from '@/domains/construction/blankActivities'
import { DEFAULT_HANDOVER_REQUIREMENTS } from '@/domains/construction/config'
import type { Activity, AnchorageType, Area, ConstructionState, Foundation, Plinth, Project } from '@/domains/construction/types'

const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

/**
 * Persisted construction records. Only what people record is stored: projects, areas, foundations, plinths and the activities
 * whose status, dates or notes were set. Everything else in ConstructionState (procurement, fabrication, handover, demonstration
 * portfolio) is not persisted and stays empty here. An activity with no stored row is "not started", never "complete".
 */
export const isDefaultActivity = (a: Activity) => a.status === 'not-started' && a.plannedDate === null && a.actualDate === null && a.notes === ''

export function constructionToRows(state: ConstructionState): RowSet {
  return {
    companies: state.company.id ? [{ id: state.company.id, name: state.company.name, legal_name: state.company.legalName ?? '', location: state.company.location ?? '', contact_name: state.company.contactName ?? '', contact_email: state.company.contactEmail ?? '', contact_phone: state.company.contactPhone ?? '', website: state.company.website ?? '', notes: state.company.notes ?? '' }] : [],
    projects: state.projects.map((p): Row => ({ id: p.id, company_id: p.companyId, name: p.name, job_number: p.jobNumber, client: p.client, location: p.location, scope: p.scope, status: p.status, status_note: p.statusNote, description: p.description ?? '', start_date: p.startDate ?? null, end_date: p.endDate ?? null })),
    areas: state.areas.map((a): Row => ({ id: a.id, project_id: a.projectId, name: a.name, sequence: a.sequence, identifier: a.identifier ?? '', description: a.description ?? '', archived: a.archived ? 1 : 0 })),
    anchorage_types: state.anchorageTypes.map((t, seq): Row => ({ id: t.id, project_id: t.projectId ?? '', code: t.code, description: t.description, archived: t.archived ? 1 : 0, seq })),
    foundations: state.foundations.map((f, seq): Row => ({ id: f.id, area_id: f.areaId, number: f.number, description: f.description, notes: f.notes, archived: f.archived ? 1 : 0, seq })),
    plinths: state.plinths.map((p, seq): Row => ({ id: p.id, foundation_id: p.foundationId, idx: p.index, anchorage_type_id: p.anchorageTypeId, notes: p.notes, seq })),
    activities: state.activities.filter((a) => !isDefaultActivity(a)).map((a): Row => ({ id: a.id, scope: a.scope, activity_key: a.key, foundation_id: a.foundationId, plinth_id: a.plinthId, status: a.status, planned_date: a.plannedDate, actual_date: a.actualDate, notes: a.notes, seq: 0 })),
  }
}

export function constructionFromRows(rows: RowSet): ConstructionState {
  const stored = new Map((rows.activities ?? []).map((r) => [String(r.id), r]))
  const overlay = (a: Activity): Activity => {
    const r = stored.get(a.id)
    return r ? { ...a, status: String(r.status) as Activity['status'], plannedDate: s(r.planned_date), actualDate: s(r.actual_date), notes: String(r.notes) } : a
  }
  const foundations = (rows.foundations ?? []).map((r): Foundation => ({ id: String(r.id), areaId: String(r.area_id), number: String(r.number), description: String(r.description), notes: String(r.notes), docIds: [], ...(Number(r.archived) === 1 ? { archived: true } : {}) }))
  const plinths = (rows.plinths ?? []).map((r): Plinth => ({ id: String(r.id), foundationId: String(r.foundation_id), index: Number(r.idx), anchorageTypeId: s(r.anchorage_type_id), notes: String(r.notes) }))
  const activities: Activity[] = foundations.flatMap((f) => blankActivitiesFor(f, plinths.filter((p) => p.foundationId === f.id)).map(overlay))
  const areas = (rows.areas ?? []).map((r): Area => ({ id: String(r.id), projectId: String(r.project_id), name: String(r.name), sequence: Number(r.sequence), identifier: String(r.identifier ?? ''), description: String(r.description ?? ''), ...(Number(r.archived) === 1 ? { archived: true } : {}) }))
  const anchorageTypes = (rows.anchorage_types ?? []).map((r): AnchorageType => ({ id: String(r.id), projectId: String(r.project_id), code: String(r.code), description: String(r.description), bolts: [], hardware: [], ...(Number(r.archived) === 1 ? { archived: true } : {}) }))
  const company = (rows.companies ?? [])[0]
  return {
    company: company ? { id: String(company.id), name: String(company.name), legalName: String(company.legal_name ?? ''), location: String(company.location ?? ''), contactName: String(company.contact_name ?? ''), contactEmail: String(company.contact_email ?? ''), contactPhone: String(company.contact_phone ?? ''), website: String(company.website ?? ''), notes: String(company.notes ?? '') } : { id: '', name: '' },
    projects: (rows.projects ?? []).map((r): Project => ({ id: String(r.id), companyId: String(r.company_id), name: String(r.name), jobNumber: String(r.job_number), client: String(r.client), location: String(r.location), scope: String(r.scope), status: String(r.status) as Project['status'], statusNote: String(r.status_note), tracking: 'detailed', reportedProgress: null, description: String(r.description ?? ''), startDate: s(r.start_date), endDate: s(r.end_date) })),
    projectIssues: [],
    areas,
    foundations, plinths,
    boltSpecs: [], anchorageTypes, bulkMaterials: [], suppliers: [], purchaseOrders: [], deliveries: [], allocations: [], plinthReady: [], fabrication: [],
    activities, documents: [], deficiencies: [],
    // Handover is not saved yet: each area carries an untouched, empty checklist so screens that read it keep working. Nothing here is persisted or shown as progress.
    handover: areas.map((a) => ({ areaId: a.id, requirements: DEFAULT_HANDOVER_REQUIREMENTS.map((r, i) => ({ id: `${a.id}-req-${i + 1}`, label: r.label, metric: r.metric, done: false, doneDate: null, note: '' })), acceptance: 'not-submitted' as const, submittedDate: null, acceptedDate: null, acceptedBy: '', notes: '' })),
    crews: [], people: [], rotationAnchor: '2026-01-01',
  }
}
