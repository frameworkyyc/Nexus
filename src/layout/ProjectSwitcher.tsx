import { Check, ChevronDown, FolderKanban } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { swapProject } from '@/domains/construction/navigation'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useProjectContext } from '@/app/projectContext'

/**
 * The project selector. It sets the context of Project Progress, Project Management and Foundation Overview; Fleet ignores it. Choosing a
 * project keeps you in the same section. On a phone it opens as a bottom sheet.
 */
export function ProjectSwitcher({ phone = false }: { phone?: boolean }) {
  const { project, projects } = useProjectContext()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || phone) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [open, phone])
  if (projects.length === 0) return null
  const choose = (id: string) => { setOpen(false); navigate(swapProject(pathname, id)) }
  const list = (
    <ul role="listbox" aria-label="Projects">
      {projects.map((p) => (
        <li key={p.id} role="option" aria-selected={p.id === project?.id}>
          <button type="button" onClick={() => choose(p.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-hover phone:min-h-[52px] phone:text-[16px] ${p.id === project?.id ? 'font-medium' : ''}`}>
            <span className="min-w-0"><span className="block truncate">{p.name}</span>{p.jobNumber && <span className="block text-xs text-muted">Job {p.jobNumber}</span>}</span>
            {p.id === project?.id && <Check size={15} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </li>
      ))}
      <li className="border-t border-line"><Link to="/projects" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-[13px] text-muted hover:bg-hover hover:text-ink phone:min-h-[52px] phone:py-3.5 phone:text-[16px]">All projects</Link></li>
    </ul>
  )
  const label = project?.name ?? 'Select project'
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Project: ${label}. Change project`}
        className={phone ? 'grid h-11 w-11 shrink-0 place-items-center text-ink' : 'flex h-9 max-w-[16rem] items-center gap-2 rounded-nx border border-line px-2.5 text-[13px] hover:border-ink lg:px-3'}>
        {phone ? <FolderKanban size={21} strokeWidth={1.75} aria-hidden="true" /> : <>
          <FolderKanban size={15} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="hidden truncate font-medium lg:inline">{label}</span>
          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden="true" />
        </>}
      </button>
      {open && (phone
        ? <BottomSheet title="Project" onClose={() => setOpen(false)}>{list}</BottomSheet>
        : <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-nx border border-line bg-surface shadow-lg">{list}</div>)}
    </div>
  )
}
