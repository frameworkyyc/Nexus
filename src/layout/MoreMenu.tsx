import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { moreItems } from '@/app/moreItems'
import { useProjectContext } from '@/app/projectContext'
import { useBackend } from '@/lib/dataSource'

/** Desktop and iPad "More" menu: setup, issues, crew, safety, backups and the other pages that are not primary sections. */
export function MoreMenu() {
  const { projectId } = useProjectContext()
  const { mode, environment } = useBackend()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [open])
  const items = moreItems(projectId, mode === 'server')
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="More" className="flex h-9 items-center gap-1.5 rounded-nx px-2.5 text-[13px] text-muted hover:bg-hover hover:text-ink">
        <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden="true" /><span className="hidden lg:inline">More</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-nx border border-line bg-surface shadow-lg">
          {items.map(({ id, label, to, icon: Icon }) => (
            <Link key={id} role="menuitem" to={to} onClick={() => setOpen(false)} className="flex h-10 items-center gap-3 px-4 text-[13px] hover:bg-hover"><Icon size={16} strokeWidth={1.5} className="text-muted" aria-hidden="true" />{label}</Link>
          ))}
          <p className="border-t border-line px-4 py-2.5 text-micro text-muted">{mode === 'server' ? `Saved project data${environment ? ` · ${environment}` : ''}` : IS_PUBLIC_DEMO ? 'Demo Environment · sample data only' : 'Demonstration data · fictional records'}</p>
        </div>
      )}
    </div>
  )
}
