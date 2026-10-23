export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad' | 'muted'

const dot: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  info: 'bg-info',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  muted: 'border border-neutral-300 bg-transparent',
}

/** Semantic colour is confined to the dot; the label stays neutral. */
export function StatusBadge({ tone, label, className = '' }: { tone: Tone; label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-[13px] ${className}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[tone]}`} />
      {label}
    </span>
  )
}
