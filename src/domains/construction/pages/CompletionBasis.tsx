import { AlertCircle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { COMPLETION_BASES, DEFAULT_BASIS, basisFigures, basisWarning, isBasis, type BasisResult, type CompletionBasis } from '../completionBasis'

/** The chosen basis is one preference for every completion figure, remembered in this browser; the default is the existing calculation. */
const KEY = 'nexus.completionBasis'
const read = (): CompletionBasis => { try { const v = localStorage.getItem(KEY); return isBasis(v) ? v : DEFAULT_BASIS } catch { return DEFAULT_BASIS } }
let current = read()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
function choose(b: CompletionBasis) {
  current = b
  try { localStorage.setItem(KEY, b) } catch { /* private mode: the choice just isn't remembered */ }
  listeners.forEach((fn) => fn())
}

export function useCompletionBasis(): [CompletionBasis, (b: CompletionBasis) => void] {
  return [useSyncExternalStore(subscribe, () => current, () => DEFAULT_BASIS), choose]
}

/** Three-way switch above the progress figures: full names on wide screens, short names filling the width on a phone. Says what the chosen basis means. */
export function CompletionBasisSelector({ className = '' }: { className?: string }) {
  const [basis, setBasis] = useCompletionBasis()
  const chosen = COMPLETION_BASES.find((b) => b.id === basis)!
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}>
      <span id="completion-basis-label" className="t-label">Completion basis</span>
      <div role="group" aria-labelledby="completion-basis-label" className="grid w-full grid-cols-3 gap-0.5 rounded-nx border border-line p-0.5 text-[13px] sm:inline-grid sm:w-auto">
        {COMPLETION_BASES.map((b) => (
          <button key={b.id} type="button" aria-pressed={basis === b.id} onClick={() => setBasis(b.id)} className={`h-9 rounded-[5px] px-3 transition-colors phone:h-11 ${basis === b.id ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink'}`}>
            <span className="sm:hidden">{b.short}</span><span className="hidden sm:inline">{b.label}</span>
          </button>
        ))}
      </div>
      <p className="w-full max-w-2xl text-xs leading-relaxed text-muted">{chosen.description}</p>
    </div>
  )
}

/** "62" or "—" when the basis cannot give a figure. */
export const percentText = (r: BasisResult) => (r.percent === null ? '—' : String(r.percent))

/** The selected basis and the figures behind the percentage, plus what is left out when volumes are missing. */
export function BasisFigures({ result, className = '' }: { result: BasisResult; className?: string }) {
  const label = COMPLETION_BASES.find((b) => b.id === result.basis)!.label
  const warning = basisWarning(result)
  return (
    <span className={`block text-xs text-muted ${className}`}>
      <span className="tabular-nums">{label} · {basisFigures(result)}</span>
      {warning && <span role="note" className="mt-1 flex items-start gap-1.5 leading-snug"><AlertCircle size={13} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" /><span>{warning}</span></span>}
    </span>
  )
}
