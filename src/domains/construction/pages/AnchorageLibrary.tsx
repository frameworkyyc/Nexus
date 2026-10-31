import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAccess } from '@/lib/access'
import { addAnchorageType, archiveAnchorageType, editAnchorageType } from '../commands'
import { constructionStore, useConstruction } from '../store'
import { useTracker } from '../tracker/store'
import { itemsOf } from '../tracker/requirements'
import type { AnchorageType } from '../types'
import { plateText } from '../plates'
import { AnchorageComponentsModal } from './AnchorageComponentsModal'

/**
 * The project's anchorage library: each type defined once, then selected by Materials (and plinths). Administrators add, rename and
 * archive; everyone can search. A code that appears only in an imported workbook is listed separately and can be added to the library.
 */
export function AnchorageLibrary() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const { state: tracker } = useTracker()
  const access = useAccess()
  const admin = access.can('structure.manage')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<AnchorageType | 'new' | null>(null)
  const [configuring, setConfiguring] = useState<AnchorageType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const types = state.anchorageTypes.filter((t) => (t.projectId ?? projectId) === projectId)
  const usedBy = (t: AnchorageType) => [...tracker.lines, ...tracker.manual].filter((l) => !l.archived && l.anchorageTypeId === t.id).length
  const plinths = (t: AnchorageType) => state.plinths.filter((p) => p.anchorageTypeId === t.id).length
  const q = query.trim().toLowerCase()
  const shown = types.filter((t) => (showArchived || !t.archived) && (!q || `${t.code} ${t.description}`.toLowerCase().includes(q))).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  const workbookOnly = useMemo(() => {
    const have = new Set(types.map((t) => t.code.toLowerCase()))
    return [...new Set([...tracker.lines.map((l) => l.anchorageType), ...tracker.anchorage.map((a) => a.anchorageType)].filter((c) => c && !have.has(c.toLowerCase())))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  }, [types, tracker.lines, tracker.anchorage])
  const run = async (p: Promise<string | null>) => { setError(await p) }

  return (
    <>
      <PageHeader title="Anchorage library" description="Anchorage types for this project. Define each once; Materials and plinths select from this list." actions={admin ? <Button variant="primary" onClick={() => setEditing('new')}><Plus size={14} strokeWidth={1.5} />Add anchorage type</Button> : undefined} />
      {error && <p role="alert" className="mb-3 border-l-2 border-bad pl-3 text-[13px]">{error}</p>}
      {types.length === 0 ? (
        <EmptyState title="No anchorage types yet" description={admin ? 'Add the anchorage types this project uses (for example AB-101). They then appear in the Materials form, with the ones used on a foundation listed first.' : 'No anchorage types have been added. An administrator can add them.'} action={admin ? <Button variant="primary" onClick={() => setEditing('new')}>Add anchorage type</Button> : undefined} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Input data-search className="sm:max-w-xs" type="search" aria-label="Search anchorage types" placeholder="Search code or description" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
          </div>
          {shown.length === 0 ? <EmptyState title="No anchorage types match" /> : (
            <div className="overflow-x-auto">
              <table className="card-table w-full min-w-[560px] border-collapse text-left text-[13px]">
                <thead><tr className="border-b border-line">{['Code', 'Description', 'Components', 'Used by', ''].map((h) => <th key={h} className="t-label py-3 pr-4 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className="border-b border-line">
                      <td className="py-3 pr-4 font-medium">{t.code}{t.archived && <span className="ml-2 text-xs font-normal text-muted">Archived</span>}</td>
                      <td className="py-3 pr-4 text-muted">{t.description || '—'}</td>
                      <td className="py-3 pr-4 text-muted">{componentsSummary(state.anchorageComponents ?? [], t.id)}</td>
                      <td className="py-3 pr-4 tabular-nums text-muted">{usedBy(t)} material{usedBy(t) === 1 ? '' : 's'} · {plinths(t)} plinth{plinths(t) === 1 ? '' : 's'}</td>
                      <td className="py-3 pr-4 text-right">{admin && <span className="flex justify-end gap-1"><Button variant="ghost" className="h-8 px-2" onClick={() => setEditing(t)}>Edit</Button><Button variant="ghost" className="h-8 px-2" aria-label={`Configure ${t.code}`} onClick={() => setConfiguring(t)}>Configure</Button><Button variant="ghost" className="h-8 px-2" onClick={() => void run(constructionStore.run(archiveAnchorageType(t.id, !t.archived)))}>{t.archived ? 'Restore' : 'Archive'}</Button></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {workbookOnly.length > 0 && (
        <section className="mt-10">
          <h2 className="t-title">In the imported workbook, not in the library</h2>
          <p className="mb-2 mt-1 max-w-2xl text-xs text-muted">These codes appear on imported material lines. They can still be selected in Materials; add them here to manage them as library entries.</p>
          <ul className="border-t border-line text-[13px]">
            {workbookOnly.map((c) => (
              <li key={c} className="flex items-center justify-between gap-3 border-b border-line py-2.5"><span>{c}</span>{admin && <Button variant="ghost" className="h-8 px-2" onClick={() => void run(constructionStore.run(addAnchorageType(projectId, c, '')))}>Add to library</Button>}</li>
            ))}
          </ul>
        </section>
      )}
      {(state.libraryEmbedPlates ?? []).some((x) => x.projectId === projectId) && (
        <section className="mt-8" aria-label="Embed plates saved to the library">
          <h2 className="t-label mb-1">Embed plates saved to the library</h2>
          <p className="mb-2 text-xs text-muted">Created in a foundation’s Embed plates section and saved for reuse. They have no anchorage type; any foundation can choose them.</p>
          <ul className="divide-y divide-line border-y border-line text-[13px]">
            {(state.libraryEmbedPlates ?? []).filter((x) => x.projectId === projectId).map((x) => <li key={x.id} className="py-2">{plateText(x)}</li>)}
          </ul>
        </section>
      )}
      {configuring && <AnchorageComponentsModal type={configuring} onClose={() => setConfiguring(null)} />}
      {editing && <AnchorageModal projectId={projectId} type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function AnchorageModal({ projectId, type, onClose }: { projectId: string; type: AnchorageType | null; onClose: () => void }) {
  const [code, setCode] = useState(type?.code ?? '')
  const [description, setDescription] = useState(type?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async (another: boolean) => {
    setSaving(true)
    const err = await constructionStore.run(type ? editAnchorageType(type.id, { code, description }) : addAnchorageType(projectId, code, description))
    setSaving(false)
    setError(err)
    if (err) return
    if (another && !type) { setCode(''); setDescription('') } else onClose()
  }
  return (
    <Modal title={type ? `Edit ${type.code}` : 'Add anchorage type'} onClose={onClose}>
      <form className="space-y-4 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); void save(false) }}>
        <Field label="Code *"><Input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setError(null) }} placeholder="e.g. AB-101" /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 4 × 3/4 in anchor bolts, 18 in embed" /></Field>
        {type && <p className="text-xs text-muted">Renaming the code updates it everywhere: materials and plinths point at this record, not at the text.</p>}
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <div className="flex flex-wrap gap-2"><Button variant="primary" type="submit" disabled={saving || !code.trim()}>{saving ? 'Saving…' : type ? 'Save changes' : 'Add'}</Button>{!type && <Button disabled={saving || !code.trim()} onClick={() => void save(true)}>Add &amp; add another</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}

/** "4 × M25 × 900 mm bolts · 1 plywood template": what one anchorage is made of, in a line. */
function componentsSummary(all: import('../types').AnchorageComponent[], typeId: string): string {
  const mine = all.filter((c) => c.anchorageTypeId === typeId)
  if (mine.length === 0) return 'Not configured'
  const parts: string[] = []
  for (const c of mine) for (const it of itemsOf(c)) if (it.category === 'bolt' || it.category === 'sole-plate' || it.category === 'top-plate' || it.category === 'template' || it.category === 'embed-plate') parts.push(`${it.each} × ${it.category === 'bolt' ? `${it.spec.split(',')[0]} bolt${it.each === 1 ? '' : 's'}` : it.name.toLowerCase()}`)
  return parts.join(' · ')
}
