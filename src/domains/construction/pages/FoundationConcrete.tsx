import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Section } from '@/components/ui/Section'
import { useAccess } from '@/lib/access'
import { concreteByAnchorage, dimsLabel, foundationConcrete, volumeLabel } from '../concrete'
import { setPlinthDims } from '../commands'
import { componentInfo } from '../pours'
import { paths } from '../paths'
import { constructionStore, useConstruction } from '../store'
import type { Foundation, Plinth } from '../types'
import { ConcreteSummary, DimsRow, dimsDraft, dimsFrom, type DimsDraft } from './FoundationConfigFields'

const codeOf = (types: { id: string; code: string }[], id: string | null) => (id ? types.find((t) => t.id === id)?.code ?? id : 'Not assigned')

/** Anchorage configuration, dimensions, calculated concrete and pour progress for one foundation design. */
export function FoundationConcrete({ f, plinths, projectId }: { f: Foundation; plinths: Plinth[]; projectId: string }) {
  const { state } = useConstruction()
  const access = useAccess()
  const [editing, setEditing] = useState<Plinth | null>(null)
  const groups = (state.anchorageGroups ?? []).filter((g) => g.foundationId === f.id)
  const c = foundationConcrete(f, plinths, groups)
  const by = concreteByAnchorage(c)
  const qty = c.quantity
  const progress = (plinthId: string | null) => { let n = 0; for (let u = 1; u <= Math.min(qty, 5000); u++) if (componentInfo(state, f.id, u, plinthId).state === 'completed') n++; return n }
  const footingsPoured = progress(null)
  const plinthsPoured = plinths.reduce((t, p) => t + progress(p.id), 0)
  const hasPours = (state.pourItems ?? []).some((i) => i.foundationId === f.id)

  return (
    <Section title="Configuration and concrete" description="Anchorage groups, dimensions and the concrete they give. Volumes are rectangular, in cubic metres, converted from whatever unit was entered.">
      <div className="space-y-6 text-[13px]">
        <div className="rounded-nx bg-hover p-4"><ConcreteSummary c={c} /></div>

        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <div><dt className="t-label">Footing (each)</dt><dd className="mt-1">{c.footing === null ? <span className="text-muted">Dimensions not entered</span> : <>{volumeLabel(c.footing)}<span className="block text-xs text-muted">{dimsLabel(f.footing)}</span></>}</dd></div>
          <div><dt className="t-label">Footings, all {qty.toLocaleString('en-CA')}</dt><dd className="mt-1">{c.totalFooting === null ? '—' : volumeLabel(c.totalFooting)}</dd></div>
          <div><dt className="t-label">Plinths, all {qty.toLocaleString('en-CA')}</dt><dd className="mt-1">{c.totalPlinths === null ? <span className="text-muted">{c.plinths.length ? `${volumeLabel(c.plinthsKnown * qty)} known · incomplete` : 'No plinths'}</span> : volumeLabel(c.totalPlinths)}</dd></div>
          <div><dt className="t-label">Total concrete</dt><dd className="mt-1 font-medium">{c.total === null ? <span className="font-normal text-muted">Not available · {c.totalKnown > 0 ? `${volumeLabel(c.totalKnown)} known` : 'nothing calculable yet'}</span> : volumeLabel(c.total)}</dd></div>
        </dl>

        <div className="overflow-x-auto">
          <table className="card-table w-full min-w-[520px] border-collapse text-left">
            <thead><tr className="border-b border-line">{['Anchorage type', 'Plinths per foundation', `Total plinths (× ${qty.toLocaleString('en-CA')})`, 'Concrete (all)'].map((h) => <th key={h} className="t-label py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {by.map((r) => (
                <tr key={r.typeId ?? 'none'} className="border-b border-line">
                  <td className="py-2 pr-4">{codeOf(state.anchorageTypes, r.typeId)}</td><td className="pr-4 tabular-nums">{r.plinths}</td><td className="pr-4 tabular-nums">{r.plinthsTotal.toLocaleString('en-CA')}</td>
                  <td className="pr-4 tabular-nums">{r.missing ? <span className="text-muted">{r.known ? `${volumeLabel(r.knownTotal)} + ` : ''}{r.missing} without dimensions</span> : volumeLabel(r.knownTotal)}</td>
                </tr>
              ))}
              {!by.length && <tr><td colSpan={4} className="py-3 text-muted">No plinths configured. Use Manage on the register to enter anchorage groups.</td></tr>}
              {by.length > 1 && <tr className="font-medium"><td className="py-2 pr-4">Total</td><td className="pr-4 tabular-nums">{c.plinths.length}</td><td className="pr-4 tabular-nums">{(c.plinths.length * qty).toLocaleString('en-CA')}</td><td /></tr>}
            </tbody>
          </table>
        </div>

        {c.plinths.length > 0 && (
          <div className="overflow-x-auto">
            <table className="card-table w-full min-w-[560px] border-collapse text-left">
              <thead><tr className="border-b border-line">{['Plinth', 'Anchorage', 'Dimensions', 'Volume (each)', ''].map((h, i) => <th key={i} className="t-label py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {c.plinths.map((r) => {
                  const p = plinths.find((x) => x.id === r.plinthId)!
                  return (
                    <tr key={r.plinthId} className="border-b border-line">
                      <td className="py-2 pr-4">Plinth {r.index}</td>
                      <td className="pr-4">{codeOf(state.anchorageTypes, r.anchorageTypeId)}</td>
                      <td className="pr-4">{r.dims ? <>{dimsLabel(r.dims)} <span className="text-xs text-muted">{r.source === 'plinth' ? '· own dimensions' : '· group default'}</span></> : <span className="text-muted">Not entered</span>}</td>
                      <td className="pr-4 tabular-nums">{r.net === null ? <span className="text-muted">—</span> : volumeLabel(r.net)}{r.net !== null && r.gross !== null && r.net !== r.gross && <span className="block text-xs text-muted">{volumeLabel(r.gross)} before deducting the part inside the footing</span>}</td>
                      <td>{access.can('structure.manage') && <Button variant="ghost" className="h-8 px-2 text-xs" aria-label={`Edit dimensions of plinth ${r.index}`} onClick={() => setEditing(p)}>Dimensions</Button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted">
          Poured so far: footings {footingsPoured} of {qty.toLocaleString('en-CA')} · plinths {plinthsPoured} of {(plinths.length * qty).toLocaleString('en-CA')}.{' '}
          <Link to={paths.pours(projectId)} className="underline underline-offset-4 hover:text-ink">{hasPours ? 'Open concrete pours' : 'Plan a concrete pour'}</Link>
        </p>
      </div>
      {editing && <PlinthDimsModal plinth={editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}

function PlinthDimsModal({ plinth, onClose }: { plinth: Plinth; onClose: () => void }) {
  const [d, setD] = useState<DimsDraft>(dimsDraft(plinth.dims))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const go = async (dims: ReturnType<typeof dimsFrom>) => {
    if ('error' in dims) { setError(dims.error); return }
    setSaving(true)
    const e = await constructionStore.run(setPlinthDims(plinth.id, dims.dims))
    setSaving(false)
    if (e) setError(e); else onClose()
  }
  return (
    <Modal title={`Plinth ${plinth.index} dimensions`} onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">These replace the anchorage group’s default for this plinth only. Clear them to use the group default again.</p>
        <DimsRow label="Plinth dimensions" value={d} onChange={setD} idPrefix="plinth" />
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex gap-2">
          <Button variant="primary" disabled={saving} onClick={() => void go(dimsFrom(d, 'Plinth dimensions'))}>{saving ? 'Saving…' : 'Save'}</Button>
          <Button disabled={saving || !plinth.dims} onClick={() => void go({ dims: null })}>Use group default</Button>
        </div>
      </div>
    </Modal>
  )
}
