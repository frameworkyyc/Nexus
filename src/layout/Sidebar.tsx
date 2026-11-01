import { ChevronRight, Lock, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { applyLocks, containsCurrent, isCurrent, primarySections, toolNodes, type NavNode, type NavSection } from '@/app/navTree'
import { useProjectContext } from '@/app/projectContext'
import { sectionOf } from '@/domains/construction/navigation'
import { useConstruction } from '@/domains/construction/store'
import { signOut, useBackend } from '@/lib/dataSource'
import { useMediaQuery } from '@/lib/useMedia'

const WIDE = '(min-width: 1024px)'
const KEY = 'nexus.sidebar'
const readPref = () => { try { const v = localStorage.getItem(KEY); return v === '1' ? true : v === '0' ? false : null } catch { return null } }
const writePref = (collapsed: boolean) => { try { localStorage.setItem(KEY, collapsed ? '1' : '0') } catch { /* not remembered */ } }

const row = (active: boolean) => `flex h-9 items-center gap-3 rounded-nx px-3 text-[13px] transition-colors ${active ? 'bg-white/10 text-sidebar-ink' : 'text-neutral-400 hover:bg-white/5 hover:text-sidebar-ink'}`
const subRow = (active: boolean) => `${row(active)} !h-8 !px-2 text-[12.5px]`

/** A module that is switched off in production: not a link, with a lock and "Coming Soon". */
function LockedTag() {
  return <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-sidebar-muted"><Lock size={11} strokeWidth={1.5} aria-hidden="true" />Coming Soon</span>
}

function FutureTag() {
  return <span className="ml-auto shrink-0 rounded-full border border-sidebar-line px-1.5 py-px text-[9px] uppercase tracking-wide text-sidebar-muted">Future</span>
}

/** One entry with optional children. Its row opens the page; the chevron opens and closes the pages inside it. */
function Entry({ node, gap = false, active, open, onToggle, pathname, search, onNavigate }: { node: NavNode; gap?: boolean; active: boolean; open: boolean; onToggle: () => void; pathname: string; search: string; onNavigate: () => void }) {
  const Icon = node.icon
  const kids = node.children ?? []
  if (node.locked) {
    return (
      <li className={gap ? 'mt-3' : undefined}>
        <div aria-disabled="true" title="Coming Soon" className={`${row(false)} cursor-not-allowed opacity-60 hover:!bg-transparent hover:!text-neutral-400`}>
          {Icon && <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />}
          <span className="truncate">{node.label}</span><LockedTag />
        </div>
      </li>
    )
  }
  return (
    <li className={gap ? 'mt-3' : undefined}>
      <div className="flex items-center">
        <Link to={node.to} onClick={onNavigate} aria-current={isCurrent(node, pathname, search) ? 'page' : undefined} className={`${row(active)} min-w-0 flex-1`}>
          {Icon && <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />}
          <span className="truncate">{node.label}</span>{node.future && <FutureTag />}
        </Link>
        {kids.length > 0 && (
          <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`} className="grid h-9 w-8 shrink-0 place-items-center text-sidebar-muted hover:text-sidebar-ink">
            <ChevronRight size={14} strokeWidth={1.5} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && kids.length > 0 && (
        <ul className="ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-sidebar-line pl-2" aria-label={node.label}>
          {kids.map((c) => {
            const here = isCurrent(c, pathname, search)
            return (
              <li key={c.id}>
                <Link to={c.to} onClick={onNavigate} title={c.label} aria-current={here ? 'page' : undefined} className={subRow(here)}>
                  <span className="truncate">{c.label}</span>{c.future && <FutureTag />}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export interface SidebarViewProps {
  sections: NavSection[]
  tools: NavNode[]
  pathname: string
  search: string
  /** Icons only (a rail). */
  rail: boolean
  onToggle: () => void
  onNavigate: () => void
  footer: string
  /** Shown as a close button instead of the collapse toggle (the sidebar is a temporary overlay). */
  overlay?: boolean
  /** Present only for WorkOS sign-in: ends the Nexus session. */
  onSignOut?: () => void
}

/** The persistent left sidebar: the four primary sections (each expandable to its pages), then the secondary Tools group. Pure: the connected Sidebar below feeds it. */
export function SidebarView({ sections, tools, pathname, search, rail, onToggle, onNavigate, footer, overlay = false, onSignOut }: SidebarViewProps) {
  const here = sectionOf(pathname)
  // Groups that own a part of the app (Status, Foundation, Fleet) are active anywhere inside it; everything else only on its own pages.
  const isActive = (n: NavNode, section?: string) => (section ? here === section : containsCurrent(n, pathname, search))
  const inside = (n: NavNode) => !!n.children && ((!!(n as NavSection).section && sectionOf(pathname) === (n as NavSection).section) || containsCurrent(n, pathname, search))
  // A group opens by itself when you are inside it, and stays as you left it otherwise.
  const shape = [...sections, ...tools].map((n) => `${n.id}:${n.children?.length ?? 0}`).join('|')
  const [open, setOpen] = useState<Set<string>>(() => new Set([...sections, ...tools].filter(inside).map((n) => n.id)))
  // Moving to another page opens the group it is in and closes the rest, so the sidebar never grows into one long list. Toggles you make stay until you navigate.
  useEffect(() => {
    const here = new Set([...sections, ...tools].filter(inside).map((n) => n.id))
    setOpen((prev) => (prev.size === here.size && [...here].every((id) => prev.has(id)) ? prev : here))
  // `shape` changes when the project (and so its areas) finishes loading, so a deep link still opens the right group.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, shape])
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  if (rail) {
    const icon = (n: NavNode, active: boolean, gap = false) => {
      const Icon = n.icon!
      if (n.locked) return <li key={n.id} className={gap ? 'mt-3' : undefined}><span aria-disabled="true" aria-label={`${n.label} (Coming Soon)`} title={`${n.label} · Coming Soon`} className="relative grid h-9 w-10 cursor-not-allowed place-items-center rounded-nx text-neutral-600"><Icon size={16} strokeWidth={1.5} aria-hidden="true" /><Lock size={9} strokeWidth={2} className="absolute bottom-1.5 right-2" aria-hidden="true" /></span></li>
      return (
        <li key={n.id} className={gap ? 'mt-3' : undefined}>
          <Link to={n.to} title={n.label} aria-label={n.label} aria-current={isCurrent(n, pathname, search) ? 'page' : undefined} className={`grid h-9 w-10 place-items-center rounded-nx transition-colors ${active ? 'bg-white/10 text-sidebar-ink' : 'text-neutral-400 hover:bg-white/5 hover:text-sidebar-ink'}`}><Icon size={17} strokeWidth={1.5} aria-hidden="true" /></Link>
        </li>
      )
    }
    return (
      <div className="flex h-full flex-col items-center bg-sidebar text-sidebar-ink">
        <div className="grid h-14 w-full shrink-0 place-items-center border-b border-sidebar-line">
          <button type="button" onClick={onToggle} aria-label="Expand navigation" title="Expand navigation" className="grid h-9 w-9 place-items-center rounded-nx text-sidebar-muted hover:bg-white/5 hover:text-sidebar-ink"><PanelLeftOpen size={18} strokeWidth={1.5} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Primary" className="w-full flex-1 overflow-y-auto px-2 py-4">
          <ul className="space-y-0.5">{sections.map((s) => icon(s, isActive(s, s.section), s.id === 'op-materials' || s.id === 'foundation'))}</ul>
          <ul className="mt-4 space-y-0.5 border-t border-sidebar-line pt-4" aria-label="Tools">{tools.map((t) => icon(t, containsCurrent(t, pathname, search)))}</ul>
        </nav>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-ink">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-line px-5">
        <Link to="/" onClick={onNavigate} aria-label="Nexus home" className="leading-none">
          <div className="text-[15px] font-semibold tracking-[0.28em]">NEXUS</div>
          <div className="mt-1.5 text-micro tracking-wide text-sidebar-muted">by Framework</div>
        </Link>
        <button type="button" onClick={onToggle} aria-label={overlay ? 'Close navigation' : 'Collapse navigation'} title={overlay ? 'Close navigation' : 'Collapse navigation'} className="text-sidebar-muted hover:text-sidebar-ink">
          {overlay ? <X size={18} strokeWidth={1.5} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.5} aria-hidden="true" />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav aria-label="Primary">
          <ul className="space-y-0.5">
            {sections.map((s) => <Entry key={s.id} node={s} gap={s.id === 'op-materials' || s.id === 'foundation'} active={isActive(s, s.section)} open={open.has(s.id)} onToggle={() => toggle(s.id)} pathname={pathname} search={search} onNavigate={onNavigate} />)}
          </ul>
        </nav>
        <p className="mb-1 mt-6 px-3 text-micro uppercase tracking-wide text-sidebar-muted">Tools</p>
        <nav aria-label="Tools">
          <ul className="space-y-0.5">
            {tools.map((t) => <Entry key={t.id} node={t} active={containsCurrent(t, pathname, search)} open={open.has(t.id)} onToggle={() => toggle(t.id)} pathname={pathname} search={search} onNavigate={onNavigate} />)}
          </ul>
        </nav>
      </div>
      <div className="border-t border-sidebar-line px-5 py-4 text-micro text-sidebar-muted">{footer}{onSignOut && <button type="button" onClick={onSignOut} className="mt-2 block underline underline-offset-4 hover:text-sidebar-ink">Sign out</button>}</div>
    </div>
  )
}

/**
 * Desktop and iPad. Wide screens (1024px and up) keep the sidebar open, with a toggle that shrinks it to an icon rail (remembered). Narrower
 * screens keep the rail and open the full sidebar over the page when asked. Phones use the bottom bar instead (see AppShell).
 */
export function Sidebar() {
  const { projectId } = useProjectContext()
  const { state } = useConstruction()
  const { mode, environment, via } = useBackend()
  const { pathname, search } = useLocation()
  const wide = useMediaQuery(WIDE)
  const [pref, setPref] = useState<boolean | null>(readPref)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const collapsed = wide ? pref === true : !overlayOpen
  const areas = state.areas.filter((a) => a.projectId === projectId && !a.archived).sort((a, b) => a.sequence - b.sequence).map((a) => ({ id: a.id, name: a.name }))
  const sections = applyLocks(primarySections(projectId, areas), environment)
  const tools = applyLocks(toolNodes(projectId, mode === 'server'), environment)
  const footer = mode === 'server' ? `Saved project data${environment ? ` · ${environment}` : ''}` : IS_PUBLIC_DEMO ? 'Demo Environment · sample data only' : 'Demonstration data · fictional records'
  const overlay = !wide && overlayOpen

  useEffect(() => {
    if (!overlay) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOverlayOpen(false)
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [overlay])

  const toggle = () => { if (wide) { const next = !(pref === true); setPref(next); writePref(next) } else setOverlayOpen((o) => !o) }
  const view = (rail: boolean, ov: boolean) => (
    <SidebarView sections={sections} tools={tools} pathname={pathname} search={search} rail={rail} overlay={ov} onToggle={toggle} onNavigate={() => !wide && setOverlayOpen(false)} footer={footer} onSignOut={via === 'workos' ? () => void signOut() : undefined} />
  )
  return (
    <>
      <aside aria-label="Navigation" className={`relative z-30 h-full shrink-0 transition-[width] ${collapsed || overlay ? 'w-14' : 'w-60'}`}>
        {overlay ? view(true, false) : view(collapsed, false)}
      </aside>
      {overlay && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/50" onClick={() => setOverlayOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-label="Navigation" className="fixed inset-y-0 left-0 z-50 w-60 shadow-xl">{view(false, true)}</div>
        </>
      )}
    </>
  )
}
