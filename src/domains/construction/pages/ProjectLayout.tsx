import { identity } from '@/app/identity'
import { RotateCcw } from 'lucide-react'
import { Outlet, useLocation, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { paths } from '../paths'
import { useIsServer } from '@/lib/dataSource'
import { resetDemoData, useConstruction } from '../store'

export function ResetDemoButton() {
  const reset = () => {
    if (window.confirm(`Reset all ${identity.trackerName} demonstration data to its original state? Your edits will be lost.`)) resetDemoData()
  }
  return (
    <Button variant="ghost" onClick={reset} className="h-8 whitespace-nowrap px-2">
      <RotateCcw size={13} strokeWidth={1.5} />
      Reset demo data
    </Button>
  )
}

/**
 * Wraps every project page. Navigation between the project's sections lives in the header (Progress, Management, Foundation) and the
 * More menu; this layout only checks that the project exists, limits summary-tracked projects to their overview and carries the footer.
 */
export function ProjectLayout() {
  const { projectId = '' } = useParams()
  const { state } = useConstruction()
  const server = useIsServer()
  const { pathname } = useLocation()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <EmptyState title="Project not found" />
  // Summary-tracked projects have no areas or foundations: show the project page only.
  if (project.tracking === 'summary') {
    return (
      <>
        {pathname === paths.project(projectId) || pathname === paths.progress(projectId) ? <Outlet /> : <EmptyState title="No detailed tracking" description="This project does not have areas or foundations set up." />}
        <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <p className="text-xs text-muted">Demonstration data — fictional records.</p>
          <ResetDemoButton />
        </footer>
      </>
    )
  }
  return (
    <>
      <Outlet />
      <footer className="mt-16 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {server ? <p className="text-xs text-muted">Saved project data. Changes are stored on the server and shown on every device.</p> : <p className="text-xs text-muted">Demonstration data — fictional records, not for construction.</p>}
        {!server && <ResetDemoButton />}
      </footer>
    </>
  )
}
