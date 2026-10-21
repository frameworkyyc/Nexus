import { Droplets, Lightbulb, Package, Radio, ShieldHalf, Wrench, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { MaintenanceAlerts, MetricSummary, RadialGauge, Sparkline, StatusMark, worstStatus, type AlertItem, type SparkPoint, type Status } from '@/components/viz'
import { daysBetween } from '@/lib/date'
import { formatDate } from '@/lib/format'
import { inspectionIndicator, oilIndicator, serviceIndicator, tireIndicator, type DistanceIndicator } from './indicators'
import { accessoriesOf, ACCESSORY_CATEGORY_LABEL, conditionOf, CONDITION_LABEL, latestOdometer, odometerHistory, readingsNeedingReview, TIRE_CONDITION_LABEL } from './selectors'
import type { AccessoryCategory, ConditionStatus, FleetState, Vehicle } from './types'

const km = (n: number) => `${n.toLocaleString('en-CA')} km`
const num = (n: number) => n.toLocaleString('en-CA')

const CONDITION_STATUS: Record<ConditionStatus, Status> = { 'not-assessed': 'unknown', good: 'ok', fair: 'warn', poor: 'bad', 'out-of-service': 'bad' }
const ACCESSORY_ICON: Record<AccessoryCategory, LucideIcon> = { 'tidy-tank': Droplets, 'light-bar': Lightbulb, 'job-box': Package, 'headache-rack': ShieldHalf, radio: Radio, other: Wrench }

const act = 'text-xs text-muted underline-offset-4 hover:text-ink hover:underline'

export interface GaugeHandlers {
  jump: (sectionId: string) => void
  /** Present only when the user may edit; the action links are hidden otherwise. */
  edit?: { service: () => void; oilTarget: () => void; oilRecord: () => void; tire: () => void; tread: () => void; inspection: () => void }
}

/** Remaining-distance gauge shared by scheduled service and oil change: same maths, same statuses, same Unknown handling. */
function DistanceGauge({ title, ind, noScheduleReason, onSelect, actions }: { title: string; ind: DistanceIndicator; noScheduleReason: string; onSelect: () => void; actions?: ReactNode }) {
  const known = ind.remaining !== null
  const value = known ? num(Math.abs(ind.remaining!)) : 'Unknown'
  const unit = known ? (ind.remaining! < 0 ? 'km overdue' : 'km remaining') : ind.schedule ? 'No valid odometer' : noScheduleReason
  const details: string[] = []
  if (ind.dueAt !== null) details.push(`Due at ${km(ind.dueAt)}${ind.current !== null ? ` · now ${km(ind.current)}` : ''}`)
  if (ind.percent !== null) details.push(`${Math.round(ind.percent)}% of interval used (${km(ind.lastAt!)} → ${km(ind.dueAt!)})`)
  else if (ind.schedule) details.push('Interval start not recorded, so no percentage is shown')
  details.push(ind.last ? `Last done ${ind.lastAt !== null ? `at ${km(ind.lastAt)}` : 'odometer not recorded'} · ${formatDate(ind.last.date)}` : 'Last completed: not recorded')
  return (
    <RadialGauge title={title} percent={ind.percent} status={ind.status} statusLabel={ind.label} value={value} unit={unit}
      detail={details.map((d) => <div key={d}>{d}</div>)} onSelect={onSelect} actions={actions} />
  )
}

/** The large, at-a-glance part of the vehicle dashboard. Everything shown is derived from recorded data (see indicators.ts). */
export function VehicleGauges({ state, vehicle, today, handlers }: { state: FleetState; vehicle: Vehicle; today: string; handlers: GaugeHandlers }) {
  const { jump, edit } = handlers
  const service = serviceIndicator(state, vehicle.id)
  const oil = oilIndicator(state, vehicle.id)
  const tire = tireIndicator(state, vehicle.id)
  const insp = inspectionIndicator(state, vehicle.id, today)
  const odo = latestOdometer(state, vehicle.id)
  const condition = conditionOf(state, vehicle.id)
  const flagged = readingsNeedingReview(state, vehicle.id).length

  const alerts: AlertItem[] = []
  if (service.status === 'bad') alerts.push({ id: 'service', status: 'bad', text: `Scheduled service is ${service.label.toLowerCase()}.`, onSelect: () => jump('maintenance') })
  if (service.status === 'warn') alerts.push({ id: 'service', status: 'warn', text: `Scheduled service: ${service.label.toLowerCase()}.`, onSelect: () => jump('maintenance') })
  if (oil.status === 'bad') alerts.push({ id: 'oil', status: 'bad', text: `Oil change is ${oil.label.toLowerCase()}.`, onSelect: () => jump('maintenance') })
  if (oil.status === 'warn') alerts.push({ id: 'oil', status: 'warn', text: `Oil change: ${oil.label.toLowerCase()}.`, onSelect: () => jump('maintenance') })
  if (tire.status === 'bad') alerts.push({ id: 'tires', status: 'bad', text: `Tires: ${tire.label}.`, onSelect: () => jump('tires') })
  if (tire.status === 'warn') alerts.push({ id: 'tires', status: 'warn', text: `Tires: ${tire.label}.`, onSelect: () => jump('tires') })
  if (insp.cadence === 'overdue' || insp.cadence === 'due') alerts.push({ id: 'insp', status: insp.status as 'bad' | 'warn', text: `Weekly inspection: ${insp.label.toLowerCase()}.`, onSelect: () => jump('inspections') })
  // Defects have no recorded severity, so they are flagged as needing attention rather than critical.
  if (insp.defects > 0) alerts.push({ id: 'defects', status: 'warn', text: `${insp.defects} outstanding defect${insp.defects === 1 ? '' : 's'}${insp.unreviewedDefects ? ` (${insp.unreviewedDefects} on inspections not yet reviewed)` : ''}.`, onSelect: () => jump('inspections') })
  if (flagged > 0) alerts.push({ id: 'odo', status: 'warn', text: `${flagged} odometer reading${flagged === 1 ? '' : 's'} held for review; mileage-based figures use the last accepted reading.`, onSelect: () => jump('odometer') })

  const trend: SparkPoint[] = odometerHistory(state, vehicle.id).filter((r) => r.date && (r.review === 'valid' || r.review === 'accepted')).map((r) => ({ x: daysBetween('2000-01-01', r.date!), y: r.reading }))
  const accessories = accessoriesOf(state, vehicle.id).filter((a) => a.status === 'installed')
  const overall = worstStatus([service.status, oil.status, tire.status, insp.status, CONDITION_STATUS[condition]])

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 py-2 md:grid-cols-4" aria-label="Vehicle summary">
        <MetricSummary label="Odometer" value={odo ? <>{num(odo.reading)}<span className="text-lg text-muted"> km</span></> : <span className="text-muted">Unknown</span>}
          sub={odo ? (odo.date ? formatDate(odo.date) : 'Date not recorded') : 'No valid reading recorded'}
          visual={trend.length > 1 ? <Sparkline points={trend} label={`Odometer trend over ${trend.length} dated readings`} /> : undefined} onSelect={() => jump('odometer')} />
        <MetricSummary label="Condition" value={<span>{CONDITION_LABEL[condition]}</span>} status={CONDITION_STATUS[condition]}
          statusLabel={condition === 'not-assessed' ? 'No reviewed inspection states one' : 'Stated by a reviewer'} onSelect={() => jump('inspections')} />
        <MetricSummary label="Outstanding defects" value={String(insp.defects)} status={insp.defects ? 'warn' : insp.cadence === 'unknown' ? 'unknown' : 'ok'}
          statusLabel={insp.defects ? (insp.unreviewedDefects ? `${insp.unreviewedDefects} not yet reviewed` : 'Open') : insp.cadence === 'unknown' ? 'No inspection recorded' : 'None open'} onSelect={() => jump('inspections')} />
        <MetricSummary label="Overall" value={<span>{overall === 'ok' ? 'All clear' : overall === 'unknown' ? 'Incomplete' : overall === 'info' ? 'No issues' : overall === 'warn' ? 'Attention' : 'Critical'}</span>} status={overall}
          statusLabel={overall === 'unknown' ? 'Some measures are unrecorded' : overall === 'ok' ? 'Every measure is confirmed' : overall === 'info' ? 'Nothing overdue' : 'See below'} />
      </div>

      <MaintenanceAlerts items={alerts} />

      <section aria-label="Maintenance and condition gauges" className="mt-10 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 xl:grid-cols-4">
        <DistanceGauge title="Scheduled service" ind={service} noScheduleReason="No service scheduled" onSelect={() => jump('maintenance')}
          actions={edit && <button className={act} onClick={edit.service}>{service.schedule ? 'Update next service' : 'Set next service'}</button>} />
        <DistanceGauge title="Oil change" ind={oil} noScheduleReason="No oil-change schedule" onSelect={() => jump('maintenance')}
          actions={edit && <><button className={act} onClick={edit.oilTarget}>{oil.schedule ? 'Update next oil change' : 'Set next oil change'}</button><button className={act} onClick={edit.oilRecord}>Record oil change</button></>} />
        <RadialGauge title="Tires" percent={tire.percent} status={tire.status} statusLabel={tire.label}
          value={tire.set ? (tire.km !== null ? num(tire.km) : 'Unknown') : 'None'} unit={tire.set ? (tire.km !== null ? 'km on this set' : 'Distance unknown') : 'No tire set fitted'}
          detail={tire.set && <>
            <div>{tire.set.manufacturer} {tire.set.model}{tire.set.origin ? ` · ${tire.set.origin.toLowerCase()}` : ''}</div>
            {tire.set.installOdometer !== null && <div>Installed at {km(tire.set.installOdometer)}</div>}
            <div>Condition: {TIRE_CONDITION_LABEL[tire.set.condition]}{tire.treadMm !== null ? ` · tread ${tire.treadMm} mm` : ''}</div>
            <div>{tire.remainingKm !== null ? (tire.remainingKm >= 0 ? `Estimated life left: ${km(tire.remainingKm)} (of ${km(tire.expectedLifeKm!)} expected)` : `Past the ${km(tire.expectedLifeKm!)} expected lifespan`) : 'Remaining life: Unknown (no lifespan or tread limit set)'}</div>
          </>}
          onSelect={() => jump('tires')}
          actions={edit && tire.set && <><button className={act} onClick={edit.tread}>Record tread depth</button><button className={act} onClick={edit.tire}>Set lifespan</button></>} />
        <RadialGauge title="Weekly inspection" percent={insp.percent} status={insp.status} statusLabel={insp.label}
          value={insp.daysSince === null ? 'Unknown' : String(insp.daysSince)} unit={insp.daysSince === null ? 'None recorded' : insp.daysSince === 1 ? 'day since last' : 'days since last'}
          detail={<>
            <div>Cadence only — an inspection being submitted does not say the vehicle is sound.</div>
            <div>{insp.defects} outstanding defect{insp.defects === 1 ? '' : 's'}</div>
          </>}
          onSelect={() => jump('inspections')} actions={edit && <button className={act} onClick={edit.inspection}>Submit inspection</button>} />
      </section>

      <section aria-label="Installed accessories" className="mt-14">
        <h2 className="t-title">Installed accessories</h2>
        <p className="mt-0.5 text-xs text-muted">Inventory records. They are not given a lifespan unless one is recorded.</p>
        {accessories.length ? (
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {accessories.map(({ accessory: a, placement: p }) => {
              const Icon = ACCESSORY_ICON[a.category]
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => jump('accessories')} className="flex w-full items-start gap-4 rounded-xl bg-surface p-4 text-left shadow-[0_0_0_1px_var(--nx-line)] transition-shadow hover:shadow-[0_0_0_1px_var(--nx-ink)]">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-hover"><Icon size={22} strokeWidth={1.5} aria-hidden="true" /></span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium leading-snug">{a.name}</span>
                      <span className="mt-0.5 block text-xs text-muted">{ACCESSORY_CATEGORY_LABEL[a.category]}{a.specification && a.specification !== a.name ? ` · ${a.specification}` : ''}</span>
                      <span className="mt-1.5 block"><StatusMark status="info" label="Installed" /></span>
                      <span className="mt-1 block text-xs text-muted">{p.installDate ? `Since ${formatDate(p.installDate)}` : 'Install date not recorded'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : <p className="mt-4 text-[13px] text-muted">No accessories are installed on this vehicle.</p>}
      </section>
    </>
  )
}
