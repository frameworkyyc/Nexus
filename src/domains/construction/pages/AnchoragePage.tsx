import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { AnchorageLibrary } from './AnchorageLibrary'
import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { updateAnchorageType } from '../actions'
import { paths } from '../paths'
import { specLabel } from '../selectors'
import { useConstruction, useRun } from '../store'
import type { AnchorageType } from '../types'

export function AnchoragePage() {
  // The application keeps the project's library in the database; the fictional bolt/hardware view below is the public demo's.
  if (!IS_PUBLIC_DEMO) return <AnchorageLibrary />
  return <DemoAnchoragePage />
}

function DemoAnchoragePage() {
  const { projectId = '' } = useParams()
  const { state, idx } = useConstruction()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <PageHeader title="Anchorage type library" description="Each anchorage specification is defined once and referenced by any number of plinths. Values are demonstration data, not design data." />
      <div className="overflow-x-auto">
        <table className="card-table w-full min-w-[720px] border-collapse text-left">
          <thead><tr className="border-b border-line"><th className="w-6" />{['Type', 'Anchor bolts per plinth', 'Hardware per plinth', 'Used by'].map((h) => <th key={h} className="t-label py-3 pr-4 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {state.anchorageTypes.map((t) => {
              const used = state.plinths.filter((p) => p.anchorageTypeId === t.id)
              const foundations = new Set(used.map((p) => p.foundationId))
              const isOpen = open === t.id
              return (
                <Fragment key={t.id}>
                  <tr className="border-b border-line">
                    <td className="py-3.5"><button aria-expanded={isOpen} aria-label={`Toggle ${t.code}`} onClick={() => setOpen(isOpen ? null : t.id)} className="text-muted hover:text-ink"><ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} /></button></td>
                    <td className="py-3.5 pr-4 text-[13px] font-medium">{t.code}<span className="block text-xs font-normal text-muted">{t.description}</span></td>
                    <td className="py-3.5 pr-4 text-[13px]">{t.bolts.map((b) => `${b.qtyPerPlinth} × ${specLabel(idx.spec.get(b.specId)!)}`).join(', ')}</td>
                    <td className="py-3.5 pr-4 text-[13px] text-muted">{t.hardware.map((h) => `${h.qtyPerPlinth} ${h.kind}s ${h.size}`).join(', ')}</td>
                    <td className="py-3.5 pr-4 text-[13px] tabular-nums">{used.length} plinth{used.length === 1 ? '' : 's'} · {foundations.size} foundation{foundations.size === 1 ? '' : 's'}</td>
                  </tr>
                  {isOpen && <tr className="border-b border-line bg-canvas"><td /><td colSpan={4} className="py-4 pr-4"><TypeDetail type={t} projectId={projectId} /></td></tr>}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function TypeDetail({ type: t, projectId }: { type: AnchorageType; projectId: string }) {
  const { state, idx } = useConstruction()
  const run = useRun()
  const [description, setDescription] = useState(t.description)
  const [bolts, setBolts] = useState<Record<string, string>>(Object.fromEntries(t.bolts.map((b) => [b.specId, String(b.qtyPerPlinth)])))
  const [hw, setHw] = useState<Record<string, string>>(Object.fromEntries(t.hardware.map((h) => [`${h.kind}:${h.size}`, String(h.qtyPerPlinth)])))
  const used = state.plinths.filter((p) => p.anchorageTypeId === t.id)
  const save = () => run(updateAnchorageType(t.id, { description, boltQty: Object.fromEntries(Object.entries(bolts).map(([k, v]) => [k, Number(v)])), hardwareQty: Object.fromEntries(Object.entries(hw).map(([k, v]) => [k, Number(v)])) }))
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <label className="block"><span className="t-label mb-1 block">Description</span><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        {t.bolts.map((b) => {
          const s = idx.spec.get(b.specId)!
          return (
            <div key={b.specId} className="text-[13px]">
              <span className="t-label mb-1 block">Anchor bolt {s.id}</span>
              <p className="mb-1.5 text-muted">{s.diameter} diameter × {s.overallLength}" overall · top thread {s.topThread}" · bottom thread {s.bottomThread}" · {s.grade}</p>
              <label className="flex items-center gap-3">Quantity per plinth <Input className="h-8 w-20" type="number" min={0} value={bolts[b.specId]} onChange={(e) => setBolts({ ...bolts, [b.specId]: e.target.value })} /></label>
            </div>
          )
        })}
        {t.hardware.map((h) => (
          <label key={`${h.kind}${h.size}`} className="flex items-center gap-3 text-[13px] capitalize">{h.kind}s {h.size} per plinth <Input className="h-8 w-20" type="number" min={0} value={hw[`${h.kind}:${h.size}`]} onChange={(e) => setHw({ ...hw, [`${h.kind}:${h.size}`]: e.target.value })} /></label>
        ))}
        <p className="text-xs text-muted">Changing quantities updates the requirement on every plinth that uses {t.code}.</p>
        <Button variant="primary" onClick={save}>Save changes</Button>
      </div>
      <div>
        <span className="t-label mb-2 block">Referenced by</span>
        <ul className="max-h-64 overflow-y-auto text-[13px]">
          {used.map((p) => { const f = idx.foundation.get(p.foundationId)!; return <li key={p.id} className="flex gap-4 border-b border-line py-1.5"><Link className="underline-offset-4 hover:underline" to={paths.foundation(projectId, f, p.id)}>{f.number} · Plinth {p.index}</Link><span className="text-muted">{idx.area.get(f.areaId)?.name}</span></li> })}
          {!used.length && <li className="text-muted">Not used by any plinth.</li>}
        </ul>
      </div>
    </div>
  )
}
