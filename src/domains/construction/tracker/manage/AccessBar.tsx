import { Link, useParams } from 'react-router-dom'
import { Select } from '@/components/ui/Field'
import { useAccess, setSimulatedRole } from '@/lib/access'
import { ROLES, ROLE_LABEL, isRole } from '@/shared/rbac'
import { paths } from '../../paths'

/** Shows who is acting and in what role. In the browser-only demo it is a clearly labelled simulation; with saved data it reflects the server. */
export function AccessBar() {
  const a = useAccess()
  const { projectId } = useParams()
  if (a.simulated) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-nx border border-dashed border-line px-3 py-2 text-xs text-muted" data-compact>
        <span className="font-medium text-ink">Simulated role (demo only)</span>
        <label className="flex items-center gap-2">
          <span className="sr-only">Simulated role</span>
          <Select aria-label="Simulated role" className="!h-8 !w-auto" value={a.role ?? 'viewer'} onChange={(e) => isRole(e.target.value) && setSimulatedRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </label>
        <span>Changes what this page shows so you can try each role. No sign-in exists here and it grants access to nothing real.</span>
      </div>
    )
  }
  if (a.role === null) {
    return <p role="status" className="mb-4 border-l-2 border-warn pl-3 text-[13px]">No access has been assigned to {a.user ?? 'this account'}. You can’t view or change materials until an administrator gives you a role.</p>
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted" data-compact>
      <span>Signed in as <span className="text-ink">{a.user}</span> · Role <span className="text-ink">{ROLE_LABEL[a.role]}</span></span>
      {a.can('access.manage') && projectId && <Link to={paths.team(projectId)} className="underline underline-offset-4 hover:text-ink">Manage team access</Link>}
    </div>
  )
}
