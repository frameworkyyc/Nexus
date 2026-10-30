import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { addFleetCategory, setFleetCategoryArchived, updateFleetCategory } from './commands'
import { categoriesOf, fmtMeter } from './meter'
import { fleetStore, useFleet } from './store'
import type { MeterUnit } from './types'

/**
 * Fleet settings: the organization's asset categories and their default lifespans (for example Trucks, 180,000 km; Excavators, 12,000 h).
 * Everyone can read them; changing them is an Admin task (the server enforces it). An asset's own estimate always takes priority.
 */
export function FleetSettingsModal({ onClose }: { onClose: () => void }) {
  const { state } = useFleet()
  const manage = useAccess().can('structure.manage')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<MeterUnit>('km')
  const [life, setLife] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string; life: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cats = [...categoriesOf(state)].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
  const used = (id: string) => state.vehicles.filter((v) => v.categoryId === id).length
  const num = (t: string) => (t.trim() === '' ? null : Number(t.replace(/,/g, '')))
  const exec = async (r: Parameters<typeof fleetStore.run>[0], done?: () => void) => {
    setBusy(true); setError('')
    const e = await fleetStore.run(r)
    setBusy(false)
    if (e !== null) setError(e); else done?.()
  }
  return (
    <Modal title="Fleet settings" onClose={onClose}>
      <div className="space-y-5 p-6 text-[13px]">
        <div>
          <h3 className="t-label">Default lifespans by asset category</h3>
          <p className="mt-1 text-muted">Each asset in a category uses its category’s default for the Vehicle Lifespan gauge, unless the asset has its own estimate. A planning figure only: reaching it never marks an asset unsafe.</p>
        </div>
        {manage && (
          <form className="space-y-3 rounded-nx border border-line p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void exec(addFleetCategory(name, unit, num(life)), () => { setName(''); setLife('') }) }}>
            <Field label="New category"><Input aria-label="Category name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trucks" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Counts"><Select aria-label="Category meter unit" value={unit} onChange={(e) => setUnit(e.target.value as MeterUnit)}><option value="km">Kilometres</option><option value="h">Operating hours</option></Select></Field>
              <Field label={`Default lifespan (${unit === 'h' ? 'hours' : 'km'})`}><Input aria-label="Default lifespan" inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} placeholder="e.g. 180000" /></Field>
            </div>
            <Button variant="primary" type="submit" disabled={busy || !name.trim()}>Add category</Button>
          </form>
        )}
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        {cats.length === 0 ? <p className="text-muted">No categories yet.{manage ? '' : ' An administrator can add them.'}</p> : (
          <ul className="divide-y divide-line border-y border-line">
            {cats.map((c) => (
              <li key={c.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 py-2">
                {editing?.id === c.id ? (
                  <form className="flex flex-1 flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void exec(updateFleetCategory(c.id, { name: editing.name, defaultLife: num(editing.life) }), () => setEditing(null)) }}>
                    <div className="min-w-[10rem] flex-1"><Input aria-label={`Rename ${c.name}`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                    <div className="w-36"><Input aria-label={`Default lifespan of ${c.name}`} inputMode="numeric" value={editing.life} onChange={(e) => setEditing({ ...editing, life: e.target.value })} placeholder="No default" /></div>
                    <Button variant="primary" type="submit" disabled={busy}>Save</Button>
                    <Button type="button" onClick={() => { setEditing(null); setError('') }}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1"><span className={c.archived ? 'text-muted' : 'font-medium'}>{c.name}</span>{c.archived && <span className="ml-2 text-xs text-muted">Archived</span>}</span>
                    <span className="tabular-nums">{c.defaultLife === null ? <span className="text-muted">No default</span> : fmtMeter(c.defaultLife, c.meterUnit)}</span>
                    <span className="text-xs text-muted">{used(c.id)} asset{used(c.id) === 1 ? '' : 's'}</span>
                    {manage && <button type="button" className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => { setError(''); setEditing({ id: c.id, name: c.name, life: c.defaultLife === null ? '' : String(c.defaultLife) }) }}>Edit</button>}
                    {manage && <button type="button" className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => void exec(setFleetCategoryArchived(c.id, !c.archived))}>{c.archived ? 'Restore' : 'Archive'}</button>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Assign an asset to a category, or give it its own estimate, from the asset’s page (Lifespan settings).</p>
      </div>
    </Modal>
  )
}
