import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useAccess, setSimulatedRole } from '@/lib/access'
import { api } from '@/lib/api'
import { useBackend } from '@/lib/dataSource'
import { ROLES, ROLE_LABEL, ROLE_SUMMARY, isRole, type Role } from '@/shared/rbac'

/** Shows who is acting and in what role. In the browser-only demo it is a clearly labelled simulation; with saved data it reflects the server. */
export function AccessBar() {
  const a = useAccess()
  const { readOnly } = useBackend()
  const [manage, setManage] = useState(false)
  if (readOnly) return null // the public view-only site has no sign-in, roles or access management
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
      {a.can('access.manage') && <Button variant="ghost" className="h-8 px-2" onClick={() => setManage(true)}>Manage access</Button>}
      {manage && <AccessModal onClose={() => setManage(false)} />}
    </div>
  )
}

interface RoleRow { email: string; role: Role; assignedBy: string; assignedAt: string }

function AccessModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<RoleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const load = (p: Promise<{ roles: RoleRow[] }>) => p.then((r) => { setRows(r.roles); setError(null) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load access.'))
  useEffect(() => { void load(api('GET', '/api/roles')) }, [])
  const save = (target: string, next: Role | null) => load(api('POST', '/api/roles', { email: target, role: next }))
  return (
    <Modal title="Manage access" onClose={onClose}>
      <div className="space-y-5 p-6 text-[13px]">
        <p className="text-muted">Roles are explicit assignments kept on the server. Signing in does not grant a role, and nobody is an administrator unless assigned.</p>
        {error && <p role="alert" className="border-l-2 border-bad pl-3">{error}</p>}
        <ul className="border-t border-line">
          {(rows ?? []).map((r) => (
            <li key={r.email} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5">
              <span className="min-w-0 break-all">{r.email}</span>
              <span className="flex items-center gap-2">
                <Select aria-label={`Role for ${r.email}`} className="!h-8 !w-auto" value={r.role} onChange={(e) => isRole(e.target.value) && save(r.email, e.target.value)}>{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</Select>
                <Button variant="ghost" className="h-8 px-2" onClick={() => window.confirm(`Remove all access for ${r.email}?`) && save(r.email, null)}>Remove</Button>
              </span>
            </li>
          ))}
          {rows?.length === 0 && <li className="py-3 text-muted">Nobody has a role yet.</li>}
        </ul>
        <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { void save(email.trim(), role).then(() => setEmail('')) } }}>
          <Input type="email" aria-label="Email address" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select aria-label="New role" value={role} onChange={(e) => isRole(e.target.value) && setRole(e.target.value)}>{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}</Select>
          <Button variant="primary" type="submit" disabled={!email.trim()}>Assign</Button>
        </form>
        <dl className="space-y-1 text-xs text-muted">{ROLES.map((r) => <div key={r}><dt className="inline font-medium text-ink">{ROLE_LABEL[r]}: </dt><dd className="inline">{ROLE_SUMMARY[r]}</dd></div>)}</dl>
      </div>
    </Modal>
  )
}
