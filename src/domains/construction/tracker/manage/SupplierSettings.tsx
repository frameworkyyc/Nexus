import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess } from '@/lib/access'
import { addSupplier, archiveSupplier, renameSupplier, setPreferredSupplier } from '../commands'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../selectors'
import { trackerStore } from '../store'
import { useMaterialRefs } from './useMaterialRefs'

/**
 * Supplier directory and the preferred supplier suggested for each material category. Admins change them; everyone else can read them.
 * A preference only pre-fills the Supplier field when entering a new material: changing it never touches an existing material.
 */
export function SupplierSettings({ onClose }: { onClose: () => void }) {
  const access = useAccess()
  const refs = useMaterialRefs()
  const admin = access.can('materials.configure')
  const [name, setName] = useState('')
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (p: Promise<string | null>) => { const e = await p; setError(e); return e }
  return (
    <Modal title="Suppliers & defaults" onClose={onClose} wide>
      <div className="space-y-8 p-6 text-[13px]">
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <section>
          <h3 className="t-label mb-1">Preferred supplier by category</h3>
          <p className="mb-3 text-xs text-muted">Suggested automatically when a category is chosen on a new material; the person entering it can always choose another. Categories left empty have no suggestion.{!admin && ' Only an administrator can change these.'}</p>
          <ul className="border-t border-line">
            {CATEGORY_ORDER.map((c) => (
              <li key={c} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 border-b border-line py-2.5">
                <span>{CATEGORY_LABEL[c]}</span>
                <Select aria-label={`Preferred supplier for ${CATEGORY_LABEL[c]}`} disabled={!admin} value={refs.preferred[c] ?? ''} onChange={(e) => void run(trackerStore.run(setPreferredSupplier(c, e.target.value || null)))}>
                  <option value="">None</option>
                  {refs.suppliers.filter((s) => !s.archived || s.id === refs.preferred[c]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="t-label mb-1">Supplier directory</h3>
          <p className="mb-3 text-xs text-muted">One entry per supplier: names that differ only by capitalization, spacing, punctuation or “Inc./Ltd.” are treated as the same supplier.</p>
          <ul className="border-t border-line">
            {refs.suppliers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5">
                {rename?.id === s.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void run(trackerStore.run(renameSupplier(s.id, rename.name))).then((err) => !err && setRename(null)) }}>
                    <Input aria-label="Supplier name" autoFocus value={rename.name} onChange={(e) => setRename({ id: s.id, name: e.target.value })} />
                    <Button variant="primary" type="submit">Save</Button><Button variant="ghost" onClick={() => setRename(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <span className={s.archived ? 'text-muted line-through' : ''}>{s.name}{Object.values(refs.preferred).includes(s.id) && <span className="ml-2 text-xs text-muted">preferred</span>}</span>
                    {admin && (
                      <span className="flex gap-1">
                        <Button variant="ghost" className="h-8 px-2" onClick={() => setRename({ id: s.id, name: s.name })}>Rename</Button>
                        <Button variant="ghost" className="h-8 px-2" onClick={() => void run(trackerStore.run(archiveSupplier(s.id, !s.archived)))}>{s.archived ? 'Restore' : 'Archive'}</Button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
            {refs.suppliers.length === 0 && <li className="py-3 text-muted">No suppliers yet.</li>}
          </ul>
          {access.can('suppliers.add') && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(trackerStore.run(addSupplier(name))).then((err) => !err && setName('')) }}>
              <Field label="New supplier"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" /></Field>
              <div className="flex items-end"><Button variant="primary" type="submit" disabled={!name.trim()}>Add supplier</Button></div>
            </form>
          )}
        </section>
      </div>
    </Modal>
  )
}
