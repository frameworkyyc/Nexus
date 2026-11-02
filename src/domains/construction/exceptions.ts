import { addDays, daysBetween, type ISODate } from '@/lib/date'
import { getDef, isDone } from './config'
import { paths } from './paths'
import { activityTitle, boltRows, bulkRows, effectiveStatus, evaluateHandover, plinthBoltStage, poFulfilment, specLabel, type Index } from './selectors'

export interface Exception {
  id: string
  severity: 'high' | 'medium'
  title: string
  area: string
  areaId: string | null
  status: string
  to: string
}

const RANK = { high: 0, medium: 1 }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The short list of items a coordinator must act on. Related records are grouped (for example, one line per
 * area for plinths awaiting anchor bolts) so the project dashboard stays readable. The full list is on the Issues page.
 */
export function deriveExceptions(idx: Index, today: ISODate, projectId: string): Exception[] {
  const s = idx.state
  const out: Omit<Exception, 'areaId'>[] = []
  const areaName = (id: string) => idx.area.get(id)?.name ?? 'Project'

  // Blocked work
  for (const a of idx.activities) {
    if (effectiveStatus(idx, a) !== 'blocked') continue
    const f = idx.foundation.get(a.foundationId)!
    out.push({ id: `blocked:${a.id}`, severity: 'high', title: activityTitle(idx, a), area: areaName(f.areaId), status: 'Blocked', to: paths.foundation(projectId, f, a.plinthId ?? undefined) })
  }

  // Plinths due to form soon without anchor bolts ready
  const soon = addDays(today, 14)
  for (const area of s.areas) {
    const late = s.plinths.filter((p) => {
      const f = idx.foundation.get(p.foundationId)!
      const forming = (idx.activitiesByOwner.get(p.id) ?? []).find((a) => a.key === 'formed')
      return f.areaId === area.id && !!p.anchorageTypeId && !!forming && !isDone(effectiveStatus(idx, forming)) && !!forming.plannedDate && forming.plannedDate <= soon && plinthBoltStage(idx, p) !== 'ready'
    })
    if (!late.length) continue
    const urgent = late.some((p) => (idx.activitiesByOwner.get(p.id) ?? []).find((a) => a.key === 'formed')!.plannedDate! <= addDays(today, 7))
    out.push({ id: `bolts:${area.id}`, severity: urgent ? 'high' : 'medium', title: `Anchor bolts not ready · ${plural(late.length, 'plinth')}`, area: area.name, status: 'Shortage', to: paths.area(projectId, area.id, 'materials') })
  }

  // Late deliveries
  for (const po of s.purchaseOrders) {
    const f = poFulfilment(idx, po)
    if (po.status !== 'issued' || !po.expectedDate || po.expectedDate >= today || f.state === 'complete' || f.state === 'over-received') continue
    const late = daysBetween(po.expectedDate, today)
    const areas = new Set(po.lines.map((l) => (l.kind === 'bulk' ? idx.bulk.get(l.itemId)!.areaId : '*')))
    out.push({ id: `po:${po.id}`, severity: late > 7 ? 'high' : 'medium', title: `${po.number} delivery late`, area: areas.size === 1 && !areas.has('*') ? areaName([...areas][0]) : 'Project-wide', status: `${late}d late`, to: paths.materials(projectId) })
  }

  // Anchor bolts and bulk hardware not yet ordered
  for (const r of boltRows(idx)) {
    if (r.toOrder <= 0) continue
    const names = [...new Set(r.lines.map((l) => l.area.name))]
    out.push({ id: `order:${r.spec.id}`, severity: 'medium', title: `${specLabel(r.spec)} anchor bolts not ordered`, area: names.length > 2 ? 'Multiple areas' : names.join(', '), status: 'Not ordered', to: paths.materials(projectId) })
  }
  for (const area of s.areas) {
    const n = bulkRows(idx, area.id).filter((r) => r.toOrder > 0).length
    if (n) out.push({ id: `bulk:${area.id}`, severity: 'medium', title: `Nuts and washers not ordered · ${plural(n, 'line')}`, area: area.name, status: 'Not ordered', to: paths.area(projectId, area.id, 'materials') })
  }

  // Delivery discrepancies
  for (const d of s.deliveries) {
    if (d.lines.some((l) => l.qtyShipped !== l.qtyReceived && !l.resolved)) out.push({ id: `disc:${d.id}`, severity: 'medium', title: `${d.number} quantity discrepancy`, area: 'Project-wide', status: 'Open', to: paths.materials(projectId) })
  }

  // Fabrication approvals and delays
  for (const r of s.fabrication) {
    const to = paths.fabrication(projectId)
    const area = areaName(r.areaId)
    if (r.siteReceipt !== 'received' && r.expectedDate && r.expectedDate < today) out.push({ id: `fab:${r.id}`, severity: 'medium', title: `${r.number} templates late`, area, status: 'Late', to })
    else if (r.approval === 'under-review') out.push({ id: `fab:${r.id}`, severity: 'medium', title: `${r.number} awaiting your approval`, area, status: 'Review', to })
    else if (r.approval === 'revisions-requested') out.push({ id: `fab:${r.id}`, severity: 'medium', title: `${r.number} awaiting supplier revision`, area, status: 'Revisions', to })
    else if (r.approval === 'approved' && r.authorization === 'pending') out.push({ id: `fab:${r.id}`, severity: 'medium', title: `${r.number} awaiting authorization`, area, status: 'Authorization', to })
  }

  for (const area of s.areas) {
    // Overdue survey
    const overdue = idx.activities.filter((a) => {
      const def = getDef(a.scope, a.key)
      return def.category === 'survey' && idx.foundation.get(a.foundationId)!.areaId === area.id && !isDone(effectiveStatus(idx, a)) && !!a.plannedDate && a.plannedDate < today
    })
    if (overdue.length && overdue.some((a) => daysBetween(a.plannedDate!, today) > 7)) {
      out.push({ id: `survey:${area.id}`, severity: 'medium', title: `Survey overdue · ${plural(overdue.length, 'activity', 'activities')}`, area: area.name, status: 'Overdue', to: paths.area(projectId, area.id, 'quality') })
    }
    // Deficiencies
    const open = s.deficiencies.filter((d) => d.areaId === area.id && d.status === 'open')
    for (const d of open.filter((x) => x.severity === 'major')) {
      const f = d.foundationId ? idx.foundation.get(d.foundationId) : null
      out.push({ id: `def:${d.id}`, severity: 'high', title: d.title, area: area.name, status: 'Major deficiency', to: f ? paths.foundation(projectId, f) : paths.area(projectId, area.id, 'handover') })
    }
    const minor = open.filter((x) => x.severity === 'minor')
    if (minor.length) out.push({ id: `defm:${area.id}`, severity: 'medium', title: `${plural(minor.length, 'minor deficiency', 'minor deficiencies')} open`, area: area.name, status: 'Open', to: paths.area(projectId, area.id, 'handover') })
    // Handover blockers
    const ev = evaluateHandover(idx, area.id)
    if (ev.constructionComplete && !ev.allMet && ev.record.acceptance !== 'accepted') {
      out.push({ id: `handover:${area.id}`, severity: 'medium', title: `Handover blocked · ${plural(ev.items.filter((i) => !i.met).length, 'requirement')} outstanding`, area: area.name, status: 'Blocked', to: paths.area(projectId, area.id, 'handover') })
    }
    if (ev.record.acceptance === 'returned') out.push({ id: `returned:${area.id}`, severity: 'high', title: 'Handover returned with comments', area: area.name, status: 'Returned', to: paths.area(projectId, area.id, 'handover') })
  }

  return out
    .map((e): Exception => ({ ...e, areaId: s.areas.find((a) => a.name === e.area)?.id ?? null }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity])
}
