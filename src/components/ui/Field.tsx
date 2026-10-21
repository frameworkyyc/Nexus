import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const control =
  'rounded-nx border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-neutral-400 transition-colors hover:border-neutral-400 focus:border-ink focus:outline-none'

/** Controls fill their container unless the caller sets an explicit width. */
const fill = (className: string) => (/(^|\s)(?:\w+:)?w-/.test(className) ? '' : 'w-full')

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="t-label mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-9 ${fill(className)} ${control} ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`py-2 ${fill(className)} ${control} ${className}`} {...rest} />
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`h-9 ${fill(className)} ${control} ${className}`} {...rest} />
}

const compact =
  'h-7 rounded-nx border border-transparent bg-transparent px-1.5 text-[13px] text-ink transition-colors hover:border-line focus:border-ink focus:bg-surface focus:outline-none disabled:cursor-not-allowed disabled:text-muted'

/** Table-cell controls: look like text until hovered or focused. */
export function CompactSelect({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${compact} ${className}`} {...rest} />
}

export function CompactInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${compact} ${className}`} {...rest} />
}
