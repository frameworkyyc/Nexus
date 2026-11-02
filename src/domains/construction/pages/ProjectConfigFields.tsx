import { Field, Textarea } from '@/components/ui/Field'
import { MODULES, PROJECT_TEMPLATES, SCOPE_ITEMS, type ProjectSettingsInput } from '../projectSettings'
import type { ProjectTemplate } from '../types'

const CHECK = 'flex items-start gap-3 rounded-nx border border-line p-3 text-[13px] has-[:checked]:border-ink has-[:disabled]:opacity-60'

function Check({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label className={CHECK}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0"><span className="block font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  )
}
const Group = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <fieldset className="min-w-0 space-y-3 border-t border-line pt-5">
    <legend className="t-label mb-1 p-0">{title}</legend>
    {hint && <p className="text-xs text-muted">{hint}</p>}
    {children}
  </fieldset>
)
const GRID = 'grid gap-3 sm:grid-cols-2'

/** Starting point: picking a template only sets the switches below; every one stays editable. */
export function TemplatePicker({ value, onChange, disabled }: { value: ProjectTemplate; onChange: (t: ProjectTemplate) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Project template" className="grid gap-3 sm:grid-cols-3">
      {PROJECT_TEMPLATES.map((t) => (
        <label key={t.id} className={`${CHECK} cursor-pointer`}>
          <input type="radio" name="template" className="mt-0.5 h-4 w-4 shrink-0" checked={value === t.id} disabled={disabled} onChange={() => onChange(t.id)} />
          <span className="min-w-0"><span className="block font-medium">{t.label}</span><span className="block text-xs text-muted">{t.description}</span></span>
        </label>
      ))}
    </div>
  )
}

/**
 * The switches of a project: areas, modules and construction scope. Used when a project is created and in Project Settings.
 * `areaNames` (creation only) lists the areas to create when the project uses areas.
 */
export function ProjectConfigFields({ value, onChange, disabled, areaNames, onAreaNames }: {
  value: ProjectSettingsInput
  onChange: (v: ProjectSettingsInput) => void
  disabled?: boolean
  areaNames?: string
  onAreaNames?: (v: string) => void
}) {
  return (
    <div className="space-y-6">
      <Group title="Structure">
        <Check label="Use Project Areas" hint="Group foundations into areas, with an area dashboard, selectors and filters. Without areas, foundations belong directly to the project." checked={value.useAreas} disabled={disabled} onChange={(useAreas) => onChange({ ...value, useAreas })} />
        {onAreaNames && value.useAreas && (
          <Field label="Areas (optional, one per line)"><Textarea rows={3} value={areaNames ?? ''} onChange={(e) => onAreaNames(e.target.value)} placeholder={'e.g. Control Building\nPump House'} /></Field>
        )}
      </Group>
      <Group title="Modules" hint="Switch off what this project does not use. It disappears from the navigation, dashboards and progress; nothing recorded is deleted, and it returns when switched on.">
        <div className={GRID}>
          {MODULES.map((m) => <Check key={m.id} label={m.label} hint={m.description} checked={value.modules[m.id]} disabled={disabled} onChange={(on) => onChange({ ...value, modules: { ...value.modules, [m.id]: on } })} />)}
        </div>
      </Group>
      <Group title="Construction scope" hint={value.modules.progress ? 'Only these activities count toward construction completion. A project is complete when its own scope is.' : 'Construction Progress is switched off, so there is no construction scope.'}>
        <div className={GRID}>
          {SCOPE_ITEMS.map((i) => <Check key={i.id} label={i.label} checked={value.scopeItems[i.id]} disabled={disabled || !value.modules.progress} onChange={(on) => onChange({ ...value, scopeItems: { ...value.scopeItems, [i.id]: on } })} />)}
        </div>
      </Group>
    </div>
  )
}

