import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-neutral-800 border border-ink',
  secondary: 'bg-surface text-ink border border-line hover:border-ink',
  ghost: 'text-muted hover:text-ink border border-transparent',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-nx px-4 text-[13px] font-medium transition-colors disabled:opacity-40 ${variants[variant]} ${className}`}
      {...rest}
    />
  )
}
