import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { useAccess } from '@/lib/access'
import { anchorageFor, foundationsOfArea, legacyIssues, type LegacyIssue } from '../catalog'
import { editMaterial } from '../commands'
import { trackerStore } from '../store'
import type { TrackerLine } from '../types'
import type { MaterialRefs } from './useMaterialRefs'

const FIELD_LABEL = { area: 'Area', foundation: 'Foundation', anchorage: 'Anchorage type', supplier: 'Supplier' } as const
const PATCH_KEY = { area: 'areaId', foundation: 'foundationId', anchorage: 'anchorageTypeId', supplier: 'supplierId' } as const

/**
 * Values typed before materials used project records. Nothing is changed automatically: an exact, unambiguous match can be linked with
 * one click (or all at once), anything else needs a record chosen. The original text stays on the material until it is linked.
 */
export function ReconcileModal({ lines, refs, onClose }: { lines: TrackerLine[]; refs: MaterialRefs; onClose: () => void }) {
  const access = useAccess()
  const canEdit = access.can('materials.edit')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const issues = useMemo(() => lines.filter((l) => !l.archived).flatMap((l) => legacyIssues(l, refs.catalog, refs.suppliers)), [lines, refs])
  const byId = new Map(lines.map((l) => [l.id, l]))

  const link = async (i: LegacyIssue, id: string) => {
    setBusy(true)
    const err = await trackerStore.run(editMaterial(i.lineId, { [PATCH_KEY[i.field]]: id }))
    setBusy(false)
    setError(err)
  }
  const linkAll = async () => {
    setBusy(true); setError(null)
    // Areas first, then foundations, so a foundation is linked inside its (now linked) area.
    for (const field of ['area', 'foundation', 'anchorage', 'supplier'] as const) {
      for (const i of issues.filter((x) => x.field === field && x.matchId)) {
        const err = await trackerStore.run(editMaterial(i.lineId, { [PATCH_KEY[i.field]]: i.matchId as string }))
        if (err) { setError(err); setBusy(false); return }
      }
    }
    setBusy(false)
  }
  const options = (i: LegacyIssue) => {
    const l = byId.get(i.lineId)
    if (i.field === 'area') return refs.catalog.areas.map((a) => ({ value: a.id, label: a.name }))
    if (i.field === 'foundation') return foundationsOfArea(refs.catalog, l?.areaId ?? refs.catalog.areas.find((a) => a.name.toLowerCase() === (l?.area ?? '').toLowerCase())?.id).map((f) => ({ value: f.id, label: f.number, hint: f.description || undefined }))
    if (i.field === 'anchorage') return anchorageFor(refs.catalog, l?.foundationId).map((a) => ({ value: a.id, label: a.code, hint: a.description || undefined }))
    return refs.activeSuppliers.map((s) => ({ value: s.id, label: s.name }))
  }
  const exact = issues.filter((i) => i.matchId).length
  return (
    <Modal title="Values not linked to project records" onClose={onClose} wide>
      <div className="space-y-4 p-6 text-[13px]">
        <p className="text-muted">These were entered as text. They are kept as written and keep showing; linking one ties it to the project record so renames follow and filters agree. Nothing is linked unless you do it, and a foundation can only be linked inside the material’s area.</p>
        {!canEdit && <p role="status" className="border-l-2 border-warn pl-3">Your role can view this list but not change materials.</p>}
        {canEdit && exact > 0 && <Button variant="primary" disabled={busy} onClick={() => void linkAll()}>Link all {exact} exact match{exact === 1 ? '' : 'es'}</Button>}
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        {issues.length === 0 ? <p>Everything is linked.</p> : (
          <ul className="border-t border-line">
            {issues.map((i) => (
              <li key={`${i.lineId}-${i.field}`} className="space-y-2 border-b border-line py-3">
                <p><span className="font-medium">{byId.get(i.lineId)?.component}</span> <span className="text-muted">· {FIELD_LABEL[i.field]} “{i.value}”</span></p>
                {canEdit && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <SearchSelect label={`${FIELD_LABEL[i.field]} for ${byId.get(i.lineId)?.component}`} value="" options={options(i)} placeholder={i.matchLabel ? `Exact match: ${i.matchLabel}` : 'Choose the matching record'} onChange={(id) => id && void link(i, id)} />
                    {i.matchId && <Button disabled={busy} onClick={() => void link(i, i.matchId as string)}>Link to {i.matchLabel}</Button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
