import type { ReactNode } from 'react'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format'
import { vehicleTitle, type FleetRow } from './selectors'
import { ConditionBadge, NOT_RECORDED } from './ui'

const km = (n: number) => `${n.toLocaleString('en-CA')} km`

export function InspectionCell({ row }: { row: FleetRow }) {
  const i = row.inspection
  if (i.state === 'none') return <span className="text-muted">No inspection recorded</span>
  const tone: Tone = i.overdue ? 'warn' : i.state === 'reviewed' ? 'ok' : 'info'
  return <StatusBadge tone={tone} label={`${i.state === 'reviewed' ? 'Reviewed' : 'Submitted, not reviewed'}${i.overdue ? ` · ${i.daysSince} days ago` : ''}`} />
}

export function ServiceCell({ row }: { row: FleetRow }) {
  const s = row.service
  if (!s.target) return <span className="text-muted">Not set</span>
  if (s.kmRemaining === null) return <span className="text-muted">{km(s.target.odometer)}, no reading</span>
  return s.overdue ? <StatusBadge tone="bad" label={`Overdue by ${km(-s.kmRemaining)}`} /> : <span className="tabular-nums">{km(s.kmRemaining)}</span>
}

const th = 't-label py-3 pr-5 font-medium whitespace-nowrap'
const td = 'py-3 pr-5 align-top text-[13px]'

/**
 * Vehicle table shared by the organization Fleet page and a project's Fleet page: same row data, same cells.
 * `unit` renders the unit link; `actions` renders row buttons (omit for read-only). With `onRowClick`, the whole row opens the
 * vehicle dashboard; the unit link inside remains a real link for keyboard and open-in-new-tab use.
 */
export function FleetTable({ rows, projectName, unit, actions, onRowClick }: { rows: FleetRow[]; projectName?: (id: string) => string; unit: (r: FleetRow) => ReactNode; actions?: (r: FleetRow) => ReactNode; onRowClick?: (r: FleetRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>Unit</th><th className={th}>Vehicle</th>{projectName && <th className={th}>Project</th>}
            <th className={`${th} text-right`}>Odometer</th><th className={th}>Service</th><th className={th}>Inspection</th><th className={`${th} text-right`}>Defects</th><th className={th}>Condition</th>{actions && <th className={th} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vehicle.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`border-b border-line transition-colors ${onRowClick ? 'cursor-pointer hover:bg-hover' : ''}`}>
              <td className={td}>{unit(r)}</td>
              <td className={td}>{vehicleTitle(r.vehicle)}</td>
              {projectName && <td className={td}>{r.assignment ? projectName(r.assignment.projectId) : <span className="text-muted">Unassigned</span>}</td>}
              <td className={`${td} text-right`}>
                {r.odometer ? <><span className="tabular-nums">{km(r.odometer.reading)}</span><span className="block text-xs text-muted">{formatDate(r.odometer.date)}</span></> : NOT_RECORDED}
                {r.flaggedReadings > 0 && <span className="block text-xs text-warn">{r.flaggedReadings} held for review</span>}
              </td>
              <td className={td}><ServiceCell row={r} />{r.service.target && <span className="block text-xs text-muted">due at {km(r.service.target.odometer)}</span>}</td>
              <td className={td}><InspectionCell row={r} />{r.inspection.last && <span className="block text-xs text-muted">{formatDate(r.inspection.last.date)}</span>}</td>
              <td className={`${td} text-right tabular-nums`}>{r.defects}{r.unreviewedDefects > 0 && <span className="block text-xs text-muted">{r.unreviewedDefects} unreviewed</span>}</td>
              <td className={td}><ConditionBadge condition={r.condition} /></td>
              {actions && <td className={`${td} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
