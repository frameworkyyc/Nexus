import { Menu } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useProject } from '@/features/projects/store'

function useCrumbs() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean)
  const project = useProject(parts[0] === 'projects' ? parts[1] : undefined)
  if (parts.length === 0) return [{ label: 'Dashboard' }]
  if (parts[0] === 'projects') {
    const crumbs: { label: string; to?: string }[] = [{ label: 'Projects', to: parts[1] ? '/projects' : undefined }]
    if (parts[1]) crumbs.push({ label: project?.number ?? 'Not found' })
    return crumbs
  }
  return [{ label: 'Nexus' }]
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const crumbs = useCrumbs()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4 sm:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} aria-label="Open navigation" className="text-muted hover:text-ink lg:hidden">
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px]">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-neutral-300">/</span>}
              {c.to ? (
                <Link to={c.to} className="text-muted transition-colors hover:text-ink">{c.label}</Link>
              ) : (
                <span className={i === crumbs.length - 1 ? 'font-medium' : 'text-muted'}>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-[13px] text-muted sm:inline">Framework Demo Organization</span>
        <div aria-label="User avatar placeholder" className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-micro font-medium text-white">
          FW
        </div>
      </div>
    </header>
  )
}
