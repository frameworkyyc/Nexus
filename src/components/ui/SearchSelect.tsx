import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface SelectOption { value: string; label: string; hint?: string; group?: string }

interface Props {
  /** Accessible name; also shown by the surrounding Field label. */
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** Adds a first row that clears the selection. */
  emptyLabel?: string
  /** Offers “Add <typed text>” when nothing matches (for example a new supplier). Typed text never becomes a value by itself. */
  onCreate?: (text: string) => void
  createLabel?: (text: string) => string
  className?: string
}

/**
 * Searchable single-choice list. Typing only filters: the value can only be one of the options (or empty when allowed), so records
 * are selected, never retyped. Keyboard: ↓ ↑ move, Enter selects, Esc closes, Home/End jump. Rows are 44px tall on touch screens.
 */
export function SearchSelect({ label, value, options, onChange, placeholder = 'Select…', disabled, emptyLabel, onCreate, createLabel, className = '' }: Props) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const selected = options.find((o) => o.value === value)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const found = options.filter((o) => !q || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
    const out: ({ kind: 'option'; o: SelectOption } | { kind: 'empty' } | { kind: 'create' })[] = []
    if (emptyLabel && !q) out.push({ kind: 'empty' })
    for (const o of found) out.push({ kind: 'option', o })
    if (onCreate && q && !options.some((o) => o.label.toLowerCase() === q)) out.push({ kind: 'create' })
    return out
  }, [options, query, emptyLabel, onCreate])

  useEffect(() => () => clearTimeout(blurTimer.current), [])
  useEffect(() => { setActive(0) }, [query, open])
  useEffect(() => { if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  useEffect(() => { if (open) list.current?.scrollIntoView({ block: 'nearest' }) }, [open])

  const close = () => { setOpen(false); setQuery('') }
  const pick = (i: number) => {
    const r = rows[i]
    if (!r) return
    if (r.kind === 'option') onChange(r.o.value)
    else if (r.kind === 'empty') onChange('')
    else onCreate?.(query.trim())
    close()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(rows.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Home' && open) { e.preventDefault(); setActive(0) }
    else if (e.key === 'End' && open) { e.preventDefault(); setActive(rows.length - 1) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close()
  }
  const groupOf = (i: number) => { const r = rows[i]; return r?.kind === 'option' ? r.o.group : undefined }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && rows.length ? `${id}-o${active}` : undefined}
          disabled={disabled} autoComplete="off" spellCheck={false} placeholder={selected ? undefined : placeholder} data-nosearch
          value={open ? query : selected?.label ?? ''}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true) }}
          onFocus={() => { clearTimeout(blurTimer.current); setOpen(true) }} onClick={() => { clearTimeout(blurTimer.current); setOpen(true) }} onBlur={() => { blurTimer.current = setTimeout(close, 120) }} onKeyDown={onKey}
          className="h-9 w-full rounded-nx border border-line bg-surface px-3 pr-9 text-[13px] text-ink transition-colors placeholder:text-neutral-400 hover:border-neutral-400 focus:border-ink focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 phone:h-11"
        />
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
      {open && (
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-nx border border-line bg-surface py-1 text-[13px] shadow-lg">
          {rows.length === 0 && <li className="px-3 py-2.5 text-muted" role="presentation">No match</li>}
          {rows.map((r, i) => {
            const heading = groupOf(i) && groupOf(i) !== groupOf(i - 1) ? groupOf(i) : null
            return (
              <li key={i} role="presentation">
                {heading && <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{heading}</p>}
                <div
                  id={`${id}-o${i}`} role="option" aria-selected={r.kind === 'option' && r.o.value === value} data-active={i === active}
                  onMouseDown={(e) => { e.preventDefault(); pick(i) }} onMouseEnter={() => setActive(i)}
                  className={`flex min-h-9 cursor-pointer items-center justify-between gap-3 px-3 py-1.5 phone:min-h-11 ${i === active ? 'bg-hover' : ''}`}
                >
                  {r.kind === 'option' ? (
                    <>
                      <span className="min-w-0"><span className="block truncate">{r.o.label}</span>{r.o.hint && <span className="block truncate text-xs text-muted">{r.o.hint}</span>}</span>
                      {r.o.value === value && <Check size={14} strokeWidth={1.5} aria-hidden />}
                    </>
                  ) : r.kind === 'empty' ? <span className="text-muted">{emptyLabel}</span> : <span className="flex items-center gap-2"><Plus size={14} strokeWidth={1.5} aria-hidden />{createLabel ? createLabel(query.trim()) : `Add “${query.trim()}”`}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
