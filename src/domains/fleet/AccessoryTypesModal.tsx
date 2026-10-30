import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { accessoryTypeUsage, typesOf } from './accessoryTypes'
import { addAccessoryType, renameAccessoryType, setAccessoryTypeArchived } from './commands'
import { fleetStore, useFleet } from './store'

/**
 * The organization's accessory type directory. Everyone who can see Fleet can read it; adding, renaming and archiving are Admin tasks
 * (the server re-checks that). Types are never deleted: archiving hides one from new entries while existing accessories keep it.
 */
export function AccessoryTypesModal({ onClose }: { onClose: () => void }) {
  const { state } = useFleet()
  const access = useAccess()
  const manage = access.can('structure.manage')
  const [saving] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const usage = accessoryTypeUsage(state)
  const types = [...typesOf(state)].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
  const exec = async (r: Parameters<typeof fleetStore.run>[0], done?: () => void) => {
    setError('')
    const err = await fleetStore.run(r)
    if (err !== null) setError(err); else done?.()
  }
  return (
    <Modal title="Accessory types" onClose={onClose}>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">Shared by every vehicle and piece of equipment. Each accessory is still its own record; renaming a type renames it everywhere, and a type in use can be archived but never deleted.</p>
        {manage && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void exec(addAccessoryType(name), () => setName('')) }}>
            <Input aria-label="New accessory type name" placeholder="New accessory type" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="primary" type="submit" disabled={saving || !name.trim()}>Add type</Button>
          </form>
        )}
        {error && <p role="alert" className="text-[13px] text-status-bad">{error}</p>}
        {types.length === 0 ? <p className="text-muted">No accessory types yet.{manage ? '' : ' An administrator can add them, or an editor can add one while adding an accessory.'}</p> : (
          <ul className="divide-y divide-line border-y border-line">
            {types.map((t) => (
              <li key={t.id} className="flex min-h-11 flex-wrap items-center gap-3 py-2">
                {editing?.id === t.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void exec(renameAccessoryType(t.id, editing.name), () => setEditing(null)) }}>
                    <Input autoFocus aria-label={`Rename ${t.name}`} value={editing.name} onChange={(e) => setEditing({ id: t.id, name: e.target.value })} />
                    <Button variant="primary" type="submit" disabled={saving}>Save</Button>
                    <Button type="button" onClick={() => { setEditing(null); setError('') }}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1"><span className={t.archived ? 'text-muted' : 'font-medium'}>{t.name}</span>{t.archived && <span className="ml-2 text-xs text-muted">Archived</span>}</span>
                    <span className="text-xs text-muted">{usage.get(t.id) ?? 0} {(usage.get(t.id) ?? 0) === 1 ? 'accessory' : 'accessories'}</span>
                    {manage && <button type="button" className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => { setError(''); setEditing({ id: t.id, name: t.name }) }}>Rename</button>}
                    {manage && <button type="button" className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => void exec(setAccessoryTypeArchived(t.id, !t.archived))}>{t.archived ? 'Restore' : 'Archive'}</button>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
