import { Droplets, Lightbulb, Package, Radio, ShieldHalf, Wrench, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { MaintenanceAlerts, MetricSummary, RadialGauge, Sparkline, StatusMark, type AlertItem, type SparkPoint, type Status } from '@/components/viz'
import { daysBetween } from '@/lib/date'
import { useIsPhone } from '@/lib/useMedia'
import { formatDate } from '@/lib/format'
import { inspectionIndicator, lifespanIndicator, oilIndicator, pct1, serviceIndicator, tireIndicator, type DistanceIndicator } from './indicators'
import { accessoriesOf, ACCESSORY_CATEGORY_LABEL, conditionOf, CONDITION_LABEL, latestOdometer, odometerHistory, readingsNeedingReview, TIRE_CONDITION_LABEL } from './selectors'
import type { AccessoryCategory, ConditionStatus, FleetState, Vehicle } from './types'

const km = (n: number) => `${n.toLocaleString('en-CA')} km`
const num = (n: number) => n.toLocaleString('en-CA')
const pct = (n: number) => `${pct1(n)}%`

const CONDITION_STATUS: Record<ConditionStatus, Status> = { 'not-assessed': 'unknown', good: 'ok', fair: 'warn', poor: 'bad', 'out-of-service': 'bad' }
const ACCESSORY_ICON: Record<AccessoryCategory, LucideIcon> = { 'tidy-tank': Droplets, 'light-bar': Lightbulb, 'job-box': Package, 'headache-rack': ShieldHalf, radio: Radio, other: Wrench }

const act = 'text-xs text-muted underline-offset-4 hover:text-ink hover:underline phone:text-[15px] phone:text-ink phone:underline'
const ROW_RING = 124

export interface GaugeHandlers {
  jump: (sectionId: string) => void
  /** Present only when the user may edit; the action links are hidden otherwise. */
  edit?: { lifespan: () => void; service: () => void; oilTarget: () => void; oilRecord: () => void; tire: () => void; tread: () => void; inspection: () => void }
}

/** Gauge for work that falls due at a mileage (oil change, other scheduled service): remaining share of the interval, else remaining km, else Unknown. */
function DistanceGauge({ title, ind, noSchedule, onSelect, actions, row }: { title: string; ind: DistanceIndicator; noSchedule: string; onSelect: () => void; actions?: ReactNode; row?: boolean }) {
  const known = ind.remaining !== null
  const value = ind.remainingPercent !== null ? pct(ind.remainingPercent) : ind.consumedPercent !== null ? '0%' : known ? num(Math.abs(ind.remaining!)) : 'Unknown'
  const unit = known ? (ind.remaining! < 0 ? `${km(-ind.remaining!)} overdue` : `${km(ind.remaining!)} remaining`) : ind.schedule ? 'No valid odometer' : noSchedule
  const detail: string[] = []
  if (ind.dueAt !== null) detail.push(`Due at ${km(ind.dueAt)}${ind.intervalKm ? ` · ${km(ind.intervalKm)} interval` : ''}`)
  if (ind.baselineCalculated && ind.intervalStart !== null) detail.push(`Interval start ${km(ind.intervalStart)} (calculated)`)
  else if (ind.last) detail.push(`Last done ${ind.lastAt !== null ? `at ${km(ind.lastAt)} · ` : ''}${formatDate(ind.last.date)}`)
  return (
    <RadialGauge title={title} layout={row ? 'row' : 'stack'} size={row ? ROW_RING : undefined} word={value === 'Unknown'} percent={ind.remainingPercent} status={ind.status} statusLabel={ind.label} value={value} unit={unit} detail={detail.map((d) => <div key={d}>{d}</div>)} onSelect={onSelect} actions={actions} />
  )
}

/** The large, at-a-glance part of the vehicle dashboard. Everything shown is derived from recorded or configured data (see indicators.ts). */
export function VehicleGauges({ state, vehicle, today, projectName, handlers }: { state: FleetState; vehicle: Vehicle; today: string; projectName?: string; handlers: GaugeHandlers }) {
  const { jump, edit } = handlers
  const phone = useIsPhone()
  const row = phone
  const g = row ? { layout: 'row' as const, size: ROW_RING } : {}
  const life = lifespanIndicator(state, vehicle.id)
  const oil = oilIndicator(state, vehicle.id)
  const service = serviceIndicator(state, vehicle.id)
  const tire = tireIndicator(state, vehicle.id)
  const insp = inspectionIndicator(state, vehicle.id, today)
  const odo = latestOdometer(state, vehicle.id)
  const condition = conditionOf(state, vehicle.id)
  const flagged = readingsNeedingReview(state, vehicle.id).length

  const alerts: AlertItem[] = []
  const add = (id: string, status: AlertItem['status'], text: string, section: string) => alerts.push({ id, status, text, onSelect: () => jump(section) })
  if (oil.status === 'bad') add('oil', 'bad', `Oil change is overdue by ${km(-oil.remaining!)}.`, 'maintenance')
  if (oil.status === 'warn') add('oil', 'warn', `Oil change due soon: ${km(oil.remaining!)} left.`, 'maintenance')
  if (service.status === 'bad') add('service', 'bad', `Scheduled service is overdue by ${km(-service.remaining!)}.`, 'maintenance')
  if (service.status === 'warn') add('service', 'warn', `Scheduled service due soon: ${km(service.remaining!)} left.`, 'maintenance')
  if (tire.status === 'bad') add('tires', 'bad', `Tires: ${tire.label}.`, 'tires')
  if (tire.status === 'warn') add('tires', 'warn', `Tires: ${tire.label}.`, 'tires')
  if (insp.cadence === 'overdue' || insp.cadence === 'due') add('insp', insp.status as 'bad' | 'warn', `Weekly inspection: ${insp.label.toLowerCase()}.`, 'inspections')
  // Defects carry no recorded severity, so they are flagged as needing attention rather than critical.
  if (insp.defects > 0) add('defects', 'warn', `${insp.defects} outstanding defect${insp.defects === 1 ? '' : 's'}${insp.unreviewedDefects ? ` (${insp.unreviewedDefects} on inspections not yet reviewed)` : ''}.`, 'inspections')
  if (flagged > 0) add('odo', 'warn', `${flagged} odometer reading${flagged === 1 ? '' : 's'} held for review; mileage-based figures use the last accepted reading.`, 'odometer')

  const trend: SparkPoint[] = odometerHistory(state, vehicle.id).filter((r) => r.date && (r.review === 'valid' || r.review === 'accepted')).map((r) => ({ x: daysBetween('2000-01-01', r.date!), y: r.reading }))
  const accessories = accessoriesOf(state, vehicle.id).filter((a) => a.status === 'installed')

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 py-2 md:grid-cols-4" aria-label="Vehicle summary">
        <MetricSummary label="Odometer" value={odo ? <>{num(odo.reading)}<span className="text-lg text-muted"> km</span></> : <span className="text-muted">Unknown</span>}
          sub={odo ? (odo.date ? formatDate(odo.date) : 'Date not recorded') : 'No valid reading recorded'}
          visual={trend.length > 1 ? <Sparkline points={trend} label={`Odometer trend over ${trend.length} dated readings`} /> : undefined} onSelect={() => jump('odometer')} />
        <MetricSummary label="Condition" value={<span>{CONDITION_LABEL[condition]}</span>} status={CONDITION_STATUS[condition]}
          statusLabel={condition === 'not-assessed' ? 'Awaiting a reviewed inspection' : 'Stated by a reviewer'} onSelect={() => jump('inspections')} />
        <MetricSummary label="Outstanding defects" value={String(insp.defects)} status={insp.defects ? 'warn' : insp.cadence === 'unknown' ? 'unknown' : 'ok'}
          statusLabel={insp.defects ? (insp.unreviewedDefects ? `${insp.unreviewedDefects} not yet reviewed` : 'Verified, open') : insp.cadence === 'unknown' ? 'No verified inspection' : 'None open'} onSelect={() => jump('inspections')} />
        <MetricSummary label="Project" value={<span className="block truncate text-[22px] leading-10 sm:text-[2rem]">{projectName ?? 'Unassigned'}</span>} onSelect={() => jump('overview')} />
      </div>

      <MaintenanceAlerts items={alerts} />

      <section aria-label="Vehicle gauges" className={`mt-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 ${row ? 'mt-6 gap-3' : 'gap-x-8 gap-y-12'}`}>
        <RadialGauge {...g} title="Vehicle Lifespan" word={life.remainingPercent === null} percent={life.remainingPercent} status={life.status} statusLabel={life.label}
          value={life.remainingPercent !== null ? pct(life.remainingPercent) : 'Unknown'}
          unit={life.remainingKm !== null ? (life.remainingKm >= 0 ? `${km(life.remainingKm)} remaining` : `${km(-life.remainingKm)} beyond`) : life.expectedKm === null ? 'No estimate set' : 'No valid odometer'}
          detail={life.expectedKm !== null && <div>Planning estimate: {km(life.expectedKm)}</div>} onSelect={() => jump('overview')}
          actions={edit && <button className={act} onClick={edit.lifespan}>{life.expectedKm === null ? 'Set estimate' : 'Edit estimate'}</button>} />
        <DistanceGauge row={row} title="Oil Change" ind={oil} noSchedule="No schedule recorded" onSelect={() => jump('maintenance')}
          actions={edit && <><button className={act} onClick={edit.oilTarget}>{oil.schedule ? 'Update next oil change' : 'Set next oil change'}</button><button className={act} onClick={edit.oilRecord}>Record oil change</button></>} />
        {service.schedule && <DistanceGauge row={row} title="Scheduled Service" ind={service} noSchedule="No service scheduled" onSelect={() => jump('maintenance')} actions={edit && <button className={act} onClick={edit.service}>Update next service</button>} />}
        <RadialGauge {...g} title="Tire Lifespan" word={!tire.set || (tire.remainingPercent === null && tire.km === null)} percent={tire.remainingPercent} status={tire.status} statusLabel={tire.label}
          value={tire.set ? (tire.remainingPercent !== null ? pct(tire.remainingPercent) : tire.km !== null ? num(tire.km) : 'Unknown') : 'None'}
          unit={tire.set ? (tire.remainingKm !== null ? (tire.remainingKm >= 0 ? `${km(tire.remainingKm)} remaining` : `${km(-tire.remainingKm)} beyond`) : tire.km !== null ? 'km on this set' : 'Distance unknown') : 'No tire set fitted'}
          detail={tire.set && <>
            <div>Estimated, mileage-based{tire.expectedLifeKm !== null ? ` · ${km(tire.expectedLifeKm)}` : ' · no estimate set'}</div>
            <div>Condition: {TIRE_CONDITION_LABEL[tire.set.condition]}{tire.treadMm !== null ? ` · tread ${tire.treadMm} mm` : ''}</div>
          </>}
          onSelect={() => jump('tires')}
          actions={edit && tire.set && <><button className={act} onClick={edit.tire}>{tire.expectedLifeKm === null ? 'Set estimate' : 'Edit estimate'}</button><button className={act} onClick={edit.tread}>Record tread depth</button></>} />
        <RadialGauge {...g} title="Weekly Inspection" word percent={null} status={insp.status} statusLabel={insp.label}
          value={insp.cadence === 'unknown' ? 'Unknown' : insp.cadence === 'current' ? 'Current' : insp.cadence === 'due' ? 'Due' : 'Overdue'}
          unit={insp.daysSince === null ? 'None verified' : `${insp.daysSince} day${insp.daysSince === 1 ? '' : 's'} since last`}
          detail={insp.demoCount > 0 && <div>{insp.demoCount} demo record{insp.demoCount === 1 ? '' : 's'} not counted</div>}
          onSelect={() => jump('inspections')} actions={edit && <button className={act} onClick={edit.inspection}>Submit inspection</button>} />
      </section>

      <section aria-label="Installed accessories" className="mt-14">
        <h2 className="t-title">Installed accessories</h2>
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
