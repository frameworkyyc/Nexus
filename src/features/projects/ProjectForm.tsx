import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { STATUSES, STATUS_LABEL, type ProjectInput } from './types'

interface Props {
  initial: ProjectInput
  submitLabel: string
  onSubmit: (value: ProjectInput) => void
  onCancel: () => void
}

export function ProjectForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [v, setV] = useState(initial)
  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setV((s) => ({ ...s, [key]: value }))
  const dateError = v.startDate && v.targetDate && v.targetDate < v.startDate

  function submit(e: FormEvent) {
    e.preventDefault()
    if (dateError) return
    onSubmit({ ...v, name: v.name.trim(), client: v.client.trim(), location: v.location.trim(), description: v.description.trim() })
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 px-6 py-6">
        <p className="text-xs text-muted">Demonstration data — stored only in this browser.</p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Project number">
            <Input value={v.number} onChange={(e) => set('number', e.target.value)} required />
          </Field>
          <Field label="Status">
            <Select value={v.status} onChange={(e) => set('status', e.target.value as ProjectInput['status'])}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Project name">
          <Input value={v.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Client">
            <Input value={v.client} onChange={(e) => set('client', e.target.value)} required />
          </Field>
          <Field label="Location">
            <Input value={v.location} onChange={(e) => set('location', e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Start date">
            <Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} required />
          </Field>
          <Field label="Target completion">
            <Input type="date" value={v.targetDate} onChange={(e) => set('targetDate', e.target.value)} required />
          </Field>
        </div>
        {dateError && <p className="text-xs text-warn">Target completion must be on or after the start date.</p>}
        <Field label={`Progress — ${v.progress}%`}>
          <input
            type="range" min={0} max={100} step={1} value={v.progress}
            onChange={(e) => set('progress', Number(e.target.value))}
            className="h-9 w-full accent-ink"
          />
        </Field>
        <Field label="Description">
          <Textarea rows={4} value={v.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
