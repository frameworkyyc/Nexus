import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { addDocument } from './actions'
import { useConstruction, useRun } from './store'
import type { DocumentKind } from './types'

const KINDS: DocumentKind[] = ['design', 'drawing', 'quotation', 'survey', 'inspection', 'test-report', 'other']

/** Adds a placeholder document record. No file is stored and nothing here is a controlled document. */
export function DocumentModal({ onClose, onCreated, defaultKind = 'other' }: { onClose: () => void; onCreated?: (id: string) => void; defaultKind?: DocumentKind }) {
  const { today } = useConstruction()
  const run = useRun()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DocumentKind>(defaultKind)
  const [revision, setRevision] = useState('A')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    let id = ''
    if (run(addDocument(title, kind, revision, today, (x) => (id = x))) === null) {
      onCreated?.(id)
      onClose()
    }
  }
  return (
    <Modal title="Add document record" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5 px-6 py-6">
        <p className="text-xs leading-relaxed text-muted">Creates a placeholder record only. No file is attached, and nothing recorded here is an approved-for-construction document.</p>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
          <Field label="Revision"><Input value={revision} onChange={(e) => setRevision(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit">Add record</Button></div>
      </form>
    </Modal>
  )
}
