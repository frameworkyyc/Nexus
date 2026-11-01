import { UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { useAccess } from '@/lib/access'
import { api } from '@/lib/api'
import { useIsServer } from '@/lib/dataSource'
import { ROLES, ROLE_LABEL, ROLE_SUMMARY, isRole, type Role } from '@/shared/rbac'
import { useConstruction } from '../store'

type Status = 'invited' | 'active' | 'revoked'
type Delivery = 'sent' | 'failed' | 'existing_user' | 'not_configured'
interface Member { email: string; role: Role; status: Status; projectIds: string[]; assignedBy: string; assignedAt: string; lastSeenAt: string | null; signedIn?: boolean; invitation?: { delivery: Delivery | null; sentAt: string | null; expiresAt: string | null } }
interface Invitations { enabled: boolean; signInUrl: string | null }
const day = (iso: string) => iso.slice(0, 10)
/** What to tell the administrator about a member's invitation email. */
function invitationText(m: Member, now = Date.now()): string {
  const i = m.invitation
  if (m.status === 'revoked') return '—'
  if (m.signedIn) return `Signed in${m.lastSeenAt ? ` ${day(m.lastSeenAt)}` : ''}`
  if (!i || !i.delivery || i.delivery === 'not_configured') return m.status === 'invited' ? 'Not sent (manual)' : '—'
  if (i.delivery === 'failed') return 'Email failed — resend'
  if (i.delivery === 'existing_user') return 'Already has a sign-in — share the link'
  const expired = i.expiresAt && Date.parse(i.expiresAt) < now
  return `${expired ? 'Expired' : 'Emailed'} ${i.sentAt ? day(i.sentAt) : ''}${!expired && i.expiresAt ? ` · expires ${day(i.expiresAt)}` : ''}`
}

const STATUS: Record<Status, { label: string; tone: Tone }> = { invited: { label: 'Invited', tone: 'info' }, active: { label: 'Active', tone: 'ok' }, revoked: { label: 'Revoked', tone: 'bad' } }

/**
 * Setup → Team Members (administrators). Invitations are manual: nothing is emailed, so tell the person and make sure Cloudflare Access lets them
 * sign in. The server decides what each person can do; revoking takes effect on their very next request.
 */
export function TeamMembers() {
  const access = useAccess()
  const server = useIsServer()
  const { state } = useConstruction()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invitations>({ enabled: false, signInUrl: null })
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Member | 'new' | null>(null)
  const projects = state.projects.map((p) => ({ id: p.id, name: p.name }))
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Unknown project'

  const call = useCallback(async (path: string, body?: unknown) => {
    try {
      const r = body === undefined ? await api<{ members: Member[]; invitations?: Invitations }>('GET', path) : await api<{ members: Member[]; invitations?: Invitations }>('POST', path, body)
      setMembers(r.members)
      if (r.invitations) setInvites(r.invitations)
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.')
      return false
    }
  }, [])
  const canManage = server && access.can('access.manage')
  useEffect(() => { if (canManage) void call('/api/members') }, [canManage, call])

  if (!server) return <><PageHeader title="Team members" /><EmptyState title="Not available here" description="Team members are managed on the saved-data version of Nexus." /></>
  if (!canManage) return <><PageHeader title="Team members" /><EmptyState title="Administrators only" description="Only an administrator can invite people or change who has access." /></>

  const order: Record<Status, number> = { active: 0, invited: 1, revoked: 2 }
  const rows = [...(members ?? [])].sort((a, b) => order[a.status] - order[b.status] || a.email.localeCompare(b.email))
  const resend = async (m: Member) => {
    setNotice(null)
    if (await call('/api/members/resend', { email: m.email })) setNotice(`Invitation sent again to ${m.email}.`)
  }
  const canResend = (m: Member) => invites.enabled && (m.status === 'invited' || (m.status === 'active' && !m.signedIn))
  const projectsText = (m: Member) => (m.role === 'admin' ? 'All projects' : m.projectIds.length === 0 ? 'No projects' : m.projectIds.map(nameOf).join(', '))

  return (
    <>
      <PageHeader title="Team members" description="Invite people, set what they can do and which projects they see, and revoke access." actions={<Button variant="primary" onClick={() => setEditing('new')}><UserPlus size={14} strokeWidth={1.5} />Invite member</Button>} />
      {error && <p role="alert" className="mb-3 border-l-2 border-bad pl-3 text-[13px]">{error}</p>}
      {notice && <p role="status" className="mb-3 border-l-2 border-ok pl-3 text-[13px]">{notice}</p>}
      <p className="mb-4 max-w-2xl text-xs text-muted">{invites.enabled
        ? 'WorkOS emails each invitation with a link to sign in with an emailed code. Nobody can sign up without being invited here. They become Active the first time they sign in.'
        : 'Invitations are manual: no email is sent. Tell the person, and make sure Cloudflare Access allows their email to sign in. They become Active the first time they do.'}{invites.signInUrl && <> Sign-in link: <span className="select-all break-all text-ink">{invites.signInUrl}</span></>}</p>
      {members === null ? <p className="text-muted">Loading…</p> : rows.length === 0 ? <EmptyState title="No team members yet" /> : (
        <div className="overflow-x-auto">
          <table className="card-table w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead><tr className="border-b border-line">{['Member', 'Status', 'Invitation', 'Permission', 'Projects', ''].map((h) => <th key={h} className="t-label py-3 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.email} className="border-b border-line">
                  <td className="py-3 pr-4 font-medium break-all">{m.email}{m.email === access.user?.toLowerCase() && <span className="ml-2 text-xs font-normal text-muted">You</span>}</td>
                  <td className="py-3 pr-4"><StatusBadge tone={STATUS[m.status].tone} label={STATUS[m.status].label} /></td>
                  <td className="py-3 pr-4 text-muted">{invitationText(m)}</td>
                  <td className="py-3 pr-4">{ROLE_LABEL[m.role]}</td>
                  <td className="py-3 pr-4 text-muted">{projectsText(m)}</td>
                  <td className="py-3 pr-4 text-right">
                    <span className="flex justify-end gap-1">
                      {canResend(m) && <Button variant="ghost" className="h-8 px-2" aria-label={`Resend invitation to ${m.email}`} onClick={() => void resend(m)}>Resend invitation</Button>}
                      {m.status !== 'revoked' && <Button variant="ghost" className="h-8 px-2" aria-label={`Edit ${m.email}`} onClick={() => setEditing(m)}>Edit</Button>}
                      {m.status === 'revoked'
                        ? <Button variant="ghost" className="h-8 px-2" aria-label={`Restore ${m.email}`} onClick={() => void call('/api/members/restore', { email: m.email })}>Restore</Button>
                        : m.email !== access.user?.toLowerCase() && <Button variant="ghost" className="h-8 px-2" aria-label={`Revoke ${m.email}`} onClick={() => window.confirm(`Revoke ${m.email}? They lose access immediately.`) && void call('/api/members/revoke', { email: m.email })}>Revoke</Button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="mt-6 max-w-2xl space-y-1 text-xs text-muted">{ROLES.map((r) => <div key={r}><dt className="inline font-medium text-ink">{ROLE_LABEL[r]}: </dt><dd className="inline">{ROLE_SUMMARY[r]}</dd></div>)}</dl>
      {editing && <MemberModal member={editing === 'new' ? null : editing} projects={projects} onClose={() => setEditing(null)} onSave={async (body, invite) => { const ok = await call(invite ? '/api/members/invite' : '/api/members/update', body); if (ok) setEditing(null); return ok }} />}
    </>
  )
}

function MemberModal({ member, projects, onClose, onSave }: { member: Member | null; projects: { id: string; name: string }[]; onClose: () => void; onSave: (body: Record<string, unknown>, invite: boolean) => Promise<boolean> }) {
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState<Role>(member?.role ?? 'viewer')
  const [picked, setPicked] = useState<Set<string>>(new Set(member?.projectIds ?? []))
  const [saving, setSaving] = useState(false)
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const submit = async () => { setSaving(true); await onSave({ email, role, projectIds: [...picked] }, !member); setSaving(false) }
  return (
    <Modal title={member ? `Edit ${member.email}` : 'Invite member'} onClose={onClose}>
      <form className="space-y-4 p-6 text-[13px]" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {!member && <Field label="Email *"><Input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>}
        <Field label="Permission"><Select aria-label="Permission" value={role} onChange={(e) => isRole(e.target.value) && setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        <p className="-mt-2 text-xs text-muted">{ROLE_SUMMARY[role]}</p>
        {role === 'admin' ? <p className="text-xs text-muted">Administrators can open every project.</p> : (
          <fieldset>
            <legend className="mb-1 font-medium">Projects</legend>
            {projects.length === 0 ? <p className="text-xs text-muted">There are no projects yet.</p> : projects.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />{p.name}</label>
            ))}
            {picked.size === 0 && projects.length > 0 && <p className="mt-1 text-xs text-muted">With no project selected this person can sign in but sees nothing.</p>}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2"><Button variant="primary" type="submit" disabled={saving || (!member && !email.trim())}>{saving ? 'Saving…' : member ? 'Save changes' : 'Invite'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  )
}
