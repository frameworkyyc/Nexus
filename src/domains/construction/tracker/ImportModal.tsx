import { identity } from '@/app/identity'
import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { importTracker } from './commands'
import { fingerprint, importWorkbookFile, type ParsedTracker } from './import'
import { previewImport } from './selectors'
import { useTracker, useTrackerCommand } from './store'

/** Reads the workbook in the browser, shows what it found, and only imports once the user confirms. */
export function ImportButton({ label = 'Import workbook' }: { label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}><Upload size={14} strokeWidth={1.5} />{label}</Button>
      {open && <ImportModal onClose={() => setOpen(false)} />}
    </>
  )
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { run, saving } = useTrackerCommand()
  const { state } = useTracker()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ parsed: ParsedTracker; fileName: string; fileSize: number; sha256: string | null } | null>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null); setFound(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setFound({ parsed: await importWorkbookFile(bytes), fileName: file.name, fileSize: file.size, sha256: await fingerprint(bytes) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.')
    } finally { setBusy(false) }
  }
  const confirm = () => {
    if (!found) return
    run(importTracker(found.parsed, { fileName: found.fileName, fileSize: found.fileSize, sha256: found.sha256, importedAt: new Date().toISOString() }), onClose)
  }
  const c = found?.parsed.counts
  const pv = found ? previewImport(state, found.parsed) : null
  const review = found?.parsed.flags.filter((f) => f.severity === 'review').length ?? 0
  return (
    <Modal title="Import material tracker" onClose={onClose}>
      <div className="space-y-5 p-6 text-[13px]">
        <p className="text-muted">Choose the {identity.trackerName} material tracker workbook (.xlsx). It is read in this browser and stored on this device only — it is not uploaded anywhere. The workbook needs a “Material List” sheet and an “Anchorage Type” sheet.</p>
        <input ref={input} type="file" accept=".xlsx" className="sr-only" aria-label="Workbook file" onChange={(e) => choose(e.target.files?.[0])} />
        <Button onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Reading…' : found ? 'Choose a different file' : 'Choose workbook'}</Button>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        {found && c && (
          <div>
            <p className="font-medium">{found.fileName}</p>
            <dl className="mt-3 border-t border-line">
              {[
                ['Material requirement rows', c.materialRows], ['Workbook area summary rows (not requirements)', c.summaryRows], ['Anchorage Type sheet rows (reference)', c.anchorageRows],
                ['Cell comments kept', c.commentsRead], ['Blank formula rows skipped', c.blankRowsSkipped], ['Records flagged for review', review],
              ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line py-2"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
            </dl>
            {pv && state.meta && (
              <div className="mt-4">
                <p className="t-label mb-1.5">What re-importing would do</p>
                <dl className="border-t border-line">
                  {([['New lines', pv.newLines], ['Unchanged lines', pv.unchanged], ['Lines whose required quantity differs', pv.changedQty.length], ['Lines carrying your entries (kept exactly)', pv.preservedEntries], ['Lines no longer in the file but kept (hold entries)', pv.keptRemoved], ['Duplicate rows inside the file', pv.duplicatesInFile]] as [string, number][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line py-2"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
                </dl>
                {pv.changedQty.length > 0 && <ul className="mt-2 max-h-32 overflow-auto text-xs text-muted">{pv.changedQty.slice(0, 20).map((c) => <li key={c.id}>{c.area} · {c.component}: {c.from} → {c.to}</li>)}</ul>}
                <p className="mt-2 text-xs text-muted">Receipts, ordered quantities, notes, suppliers and materials you added are never overwritten. Required quantities follow the workbook, as before.</p>
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Statuses are kept as written. “Delivered” does not set any received quantity: receipts are entered in Nexus afterwards.
              {state.meta && ' Existing receipts, ordered quantities and notes are carried over to matching lines.'}
            </p>
            <div className="mt-5 flex gap-2"><Button variant="primary" disabled={saving} onClick={confirm}>{saving ? 'Saving…' : state.meta ? 'Re-import and merge' : 'Import'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
