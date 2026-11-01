import type { AuthEnv, Identity } from './auth'
import type { D1 } from './db'
import { HttpError } from './service'
import { InviteError, type Invitations } from './workos'
import { revokeSessionsOf } from './session'
import { can, isRole, permissionForCommand, ROLES, type Permission, type Role } from '@/shared/rbac'

export interface RoleEnv extends AuthEnv {
  /**
   * Email of the first administrator. Used only while the database holds no administrator at all, and only for a request whose
   * identity was verified by Cloudflare Access: it is a deliberate, operator-set provisioning step, not a guess.
   */
  INITIAL_ADMIN_EMAIL?: string
  /** Role given to the local development identity (localhost only). Defaults to admin there. Ignored everywhere else. */
  DEV_BYPASS_ROLE?: string
}

/**
 * `projects` is the set of projects the actor may see and change: 'all' for administrators (and when absent), otherwise the assigned ids.
 * `revoked` marks a member whose access an administrator withdrew: they have no role at all, whatever Cloudflare Access says.
 */
export interface Actor { email: string; role: Role | null; projects?: 'all' | string[]; revoked?: boolean }
export type MemberStatus = 'invited' | 'active' | 'revoked'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const normalizeEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '')

/**
 * The role stored for a verified identity, or null (no access). A missing table, an unreadable database or an unknown email all
 * give null: with nothing explicit on record, nobody can change or even read operational data.
 */
export async function resolveActor(db: D1 | undefined, env: RoleEnv, who: Identity, now: Date): Promise<Actor> {
  if (who.via === 'dev') return { email: who.email, role: isRole(env.DEV_BYPASS_ROLE) ? env.DEV_BYPASS_ROLE : env.DEV_BYPASS_ROLE === 'none' ? null : 'admin' }
  const email = normalizeEmail(who.email)
  if (!db || !EMAIL.test(email)) return { email, role: null }
  try {
    const row = await db.prepare('SELECT role, status FROM user_roles WHERE email = ?').bind(email).first<{ role: string; status: string }>()
    if (row && row.status === 'revoked') return { email, role: null, revoked: true }
    if (row && isRole(row.role)) {
      // First sign-in of an invited member: they become active.
      if (row.status === 'invited') await db.prepare("UPDATE user_roles SET status = 'active', last_seen_at = ? WHERE email = ? AND status = 'invited'").bind(now.toISOString(), email).run()
      return { email, role: row.role, projects: row.role === 'admin' ? 'all' : await projectsOf(db, email) }
    }
    const initial = normalizeEmail(env.INITIAL_ADMIN_EMAIL)
    if (initial && initial === email) {
      const anyAdmin = await db.prepare("SELECT 1 AS x FROM user_roles WHERE role = 'admin' AND status <> 'revoked' LIMIT 1").first()
      if (!anyAdmin) {
        const at = now.toISOString()
        await db.batch([
          db.prepare('INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(email, 'admin', 'bootstrap:INITIAL_ADMIN_EMAIL', at),
          db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, NULL, ?)').bind(at, 'bootstrap:INITIAL_ADMIN_EMAIL', email, 'admin'),
        ])
        return { email, role: 'admin', projects: 'all' }
      }
    }
  } catch { /* table missing or database unavailable: no role */ }
  return { email, role: null }
}

async function projectsOf(db: D1, email: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT project_id FROM user_projects WHERE email = ? ORDER BY project_id').bind(email).all<{ project_id: string }>()
  return results.map((r) => r.project_id)
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (actor.revoked) throw new HttpError(403, 'Your access to Nexus has been revoked. Contact an administrator.', 'revoked')
  if (!actor.role) throw new HttpError(403, 'No access has been assigned to this account. Ask an administrator to give you a role.', 'no-role')
  if (!can(actor.role, permission)) throw new HttpError(403, `Your role (${actor.role}) is not allowed to do this.`, 'forbidden')
}
export const requireCommandPermission = (actor: Actor, module: string, name: string) => requirePermission(actor, permissionForCommand(module, name))

export interface RoleRow { email: string; role: Role; assignedBy: string; assignedAt: string }

export async function listRoles(db: D1): Promise<RoleRow[]> {
  const { results } = await db.prepare('SELECT email, role, assigned_by, assigned_at FROM user_roles ORDER BY email').all<{ email: string; role: Role; assigned_by: string; assigned_at: string }>()
  return results.map((r) => ({ email: r.email, role: r.role, assignedBy: r.assigned_by, assignedAt: r.assigned_at }))
}

/** Assigns or removes (role = null) one account's role. The last administrator can never be removed or demoted. */
export async function setRole(db: D1, actor: Actor, targetRaw: unknown, roleRaw: unknown, now: Date): Promise<RoleRow[]> {
  requirePermission(actor, 'access.manage')
  const target = normalizeEmail(targetRaw)
  if (!EMAIL.test(target)) throw new HttpError(400, 'Enter a valid email address.', 'bad-request')
  if (roleRaw !== null && !isRole(roleRaw)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}.`, 'bad-request')
  const current = await db.prepare('SELECT role FROM user_roles WHERE email = ?').bind(target).first<{ role: string }>()
  if (current?.role === 'admin' && roleRaw !== 'admin') {
    const admins = await db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin' AND status <> 'revoked'").first<{ n: number }>()
    if (Number(admins?.n ?? 0) <= 1) throw new HttpError(409, 'There must always be at least one administrator.', 'last-admin')
  }
  const at = now.toISOString()
  const stmts = [
    ...(roleRaw === null ? [db.prepare('DELETE FROM user_projects WHERE email = ?').bind(target)] : []),
    roleRaw === null
      ? db.prepare('DELETE FROM user_roles WHERE email = ?').bind(target)
      : db.prepare('INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at').bind(target, roleRaw, actor.email, at),
    db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, ?, ?)').bind(at, actor.email, target, current?.role ?? null, roleRaw),
  ]
  await db.batch(stmts)
  return listRoles(db)
}

/* ── Team members: invitations, permissions, project access, revocation ─────────────────────────────────────────────────────────── */

export type InvitationDelivery = 'sent' | 'failed' | 'existing_user' | 'not_configured'
export interface Member {
  email: string; role: Role; status: MemberStatus; projectIds: string[]; assignedBy: string; assignedAt: string; lastSeenAt: string | null
  /** Has signed in through WorkOS at least once. */
  signedIn: boolean
  /** What is known about the WorkOS invitation email. delivery null = none was ever sent. */
  invitation: { delivery: InvitationDelivery | null; sentAt: string | null; expiresAt: string | null }
}

export async function listMembers(db: D1): Promise<Member[]> {
  const [{ results: rows }, { results: links }] = await Promise.all([
    db.prepare('SELECT email, role, status, assigned_by, assigned_at, last_seen_at, workos_user_id, invitation_delivery, invitation_sent_at, invitation_expires_at FROM user_roles ORDER BY email').all<{ email: string; role: Role; status: MemberStatus; assigned_by: string; assigned_at: string; last_seen_at: string | null; workos_user_id: string | null; invitation_delivery: InvitationDelivery | null; invitation_sent_at: string | null; invitation_expires_at: string | null }>(),
    db.prepare('SELECT email, project_id FROM user_projects ORDER BY project_id').all<{ email: string; project_id: string }>(),
  ])
  return rows.map((r) => ({ email: r.email, role: r.role, status: r.status, projectIds: r.role === 'admin' ? [] : links.filter((l) => l.email === r.email).map((l) => l.project_id), assignedBy: r.assigned_by, assignedAt: r.assigned_at, lastSeenAt: r.last_seen_at, signedIn: !!r.workos_user_id, invitation: { delivery: r.invitation_delivery, sentAt: r.invitation_sent_at, expiresAt: r.invitation_expires_at } }))
}

async function validProjectIds(db: D1, raw: unknown): Promise<string[]> {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) throw new HttpError(400, 'Projects must be a list of project ids.', 'bad-request')
  const ids = [...new Set(raw as string[])]
  if (ids.length === 0) return []
  const { results } = await db.prepare('SELECT id FROM projects').all<{ id: string }>()
  const known = new Set(results.map((r) => r.id))
  const bad = ids.find((i) => !known.has(i))
  if (bad) throw new HttpError(400, 'One of the selected projects does not exist.', 'bad-request')
  return ids
}

const projectStatements = (db: D1, email: string, ids: string[], by: string, at: string) => [
  db.prepare('DELETE FROM user_projects WHERE email = ?').bind(email),
  ...ids.map((id) => db.prepare('INSERT INTO user_projects (email, project_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(email, id, by, at)),
]
const auditStatement = (db: D1, at: string, actor: string, target: string, from: string | null, to: string | null) =>
  db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, ?, ?)').bind(at, actor, target, from, to)

async function memberRow(db: D1, email: string) {
  return db.prepare('SELECT role, status FROM user_roles WHERE email = ?').bind(email).first<{ role: Role; status: MemberStatus }>()
}
async function otherActiveAdmins(db: D1, email: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin' AND status <> 'revoked' AND email <> ?").bind(email).first<{ n: number }>()
  return Number(r?.n ?? 0)
}
const emailOf = (raw: unknown) => {
  const e = normalizeEmail(raw)
  if (!EMAIL.test(e)) throw new HttpError(400, 'Enter a valid email address.', 'bad-request')
  return e
}
const roleOf = (raw: unknown): Role => {
  if (!isRole(raw)) throw new HttpError(400, `Permission must be one of: ${ROLES.join(', ')}.`, 'bad-request')
  return raw
}

const INVITE_DAYS = 7
/** Asks WorkOS to email an invitation (when WorkOS sign-in is configured) and records what happened. A failure never undoes the membership: the admin can Resend. */
async function sendInvitation(db: D1, invites: Invitations | null, email: string, now: Date): Promise<void> {
  let delivery: InvitationDelivery = 'not_configured'
  let id: string | null = null
  let sentAt: string | null = null
  let expiresAt: string | null = null
  if (invites) {
    try {
      const r = await invites.create(email, INVITE_DAYS)
      id = r.id; sentAt = now.toISOString(); expiresAt = r.expiresAt ?? new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(); delivery = 'sent'
    } catch (e) {
      delivery = 'failed'
      // WorkOS refuses to invite someone who already has a sign-in: they just need the Nexus link, not an invitation.
      if (e instanceof InviteError && e.code === 'workos_rejected') { try { if ((await invites.findUserByEmail(email)).exists) delivery = 'existing_user' } catch { /* stays failed */ } }
    }
  }
  await db.prepare('UPDATE user_roles SET workos_invitation_id = ?, invitation_sent_at = ?, invitation_expires_at = ?, invitation_delivery = ? WHERE email = ?').bind(id, sentAt, expiresAt, delivery, email).run()
}

/** Adds a member as Invited. They become Active on their first verified sign-in. No email is sent: the administrator tells them. */
export async function inviteMember(db: D1, actor: Actor, input: { email?: unknown; role?: unknown; projectIds?: unknown }, now: Date, invites: Invitations | null = null): Promise<Member[]> {
  requirePermission(actor, 'access.manage')
  const email = emailOf(input.email)
  const role = roleOf(input.role)
  const projectIds = role === 'admin' ? [] : await validProjectIds(db, input.projectIds)
  const existing = await memberRow(db, email)
  if (existing && existing.status !== 'revoked') throw new HttpError(409, existing.status === 'invited' ? 'This person has already been invited.' : 'This person is already a member.', 'exists')
  const at = now.toISOString()
  await db.batch([
    db.prepare("INSERT INTO user_roles (email, role, assigned_by, assigned_at, status, last_seen_at) VALUES (?, ?, ?, ?, 'invited', NULL) ON CONFLICT(email) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at, status = 'invited', last_seen_at = NULL").bind(email, role, actor.email, at),
    ...projectStatements(db, email, projectIds, actor.email, at),
    auditStatement(db, at, actor.email, email, existing ? 'revoked' : null, `invited:${role}`),
  ])
  await sendInvitation(db, invites, email, now)
  return listMembers(db)
}

/** Changes a member's permission and/or the projects they can see. Revoked members must be restored first. */
export async function updateMember(db: D1, actor: Actor, input: { email?: unknown; role?: unknown; projectIds?: unknown }, now: Date): Promise<Member[]> {
  requirePermission(actor, 'access.manage')
  const email = emailOf(input.email)
  const current = await memberRow(db, email)
  if (!current) throw new HttpError(404, 'That person is not a member.', 'not-found')
  if (current.status === 'revoked') throw new HttpError(409, 'Restore this person’s access before changing it.', 'revoked')
  const role = input.role === undefined ? current.role : roleOf(input.role)
  if (current.role === 'admin' && role !== 'admin' && (await otherActiveAdmins(db, email)) === 0) throw new HttpError(409, 'There must always be at least one administrator.', 'last-admin')
  const projectIds = role === 'admin' ? [] : input.projectIds === undefined ? null : await validProjectIds(db, input.projectIds)
  const at = now.toISOString()
  await db.batch([
    db.prepare('UPDATE user_roles SET role = ? WHERE email = ?').bind(role, email),
    ...(role === 'admin' ? [db.prepare('DELETE FROM user_projects WHERE email = ?').bind(email)] : projectIds === null ? [] : projectStatements(db, email, projectIds, actor.email, at)),
    auditStatement(db, at, actor.email, email, current.role, role),
  ])
  return listMembers(db)
}

/** Withdraws access immediately: the very next request from this person is refused, whatever Cloudflare Access says. The record is kept. */
export async function revokeMember(db: D1, actor: Actor, input: { email?: unknown }, now: Date, invites: Invitations | null = null): Promise<Member[]> {
  requirePermission(actor, 'access.manage')
  const email = emailOf(input.email)
  if (email === normalizeEmail(actor.email)) throw new HttpError(409, 'You cannot revoke your own access.', 'self')
  const current = await memberRow(db, email)
  if (!current) throw new HttpError(404, 'That person is not a member.', 'not-found')
  if (current.status === 'revoked') return listMembers(db)
  if (current.role === 'admin' && (await otherActiveAdmins(db, email)) === 0) throw new HttpError(409, 'There must always be at least one administrator.', 'last-admin')
  const at = now.toISOString()
  const pending = await db.prepare('SELECT workos_invitation_id AS id FROM user_roles WHERE email = ?').bind(email).first<{ id: string | null }>()
  await db.batch([db.prepare("UPDATE user_roles SET status = 'revoked' WHERE email = ?").bind(email), auditStatement(db, at, actor.email, email, current.role, 'revoked')])
  // Every Nexus session ends now; a pending WorkOS invitation is withdrawn on a best-effort basis (the membership check already refuses them).
  await revokeSessionsOf(db, email, 'revoked', now)
  if (invites && pending?.id) { try { await invites.revoke(pending.id) } catch { /* the invitation can no longer be used to get in */ } }
  return listMembers(db)
}

/** Puts a revoked member back as Invited (they become Active on their next sign-in), with the permission and projects they had. */
export async function restoreMember(db: D1, actor: Actor, input: { email?: unknown }, now: Date, invites: Invitations | null = null): Promise<Member[]> {
  requirePermission(actor, 'access.manage')
  const email = emailOf(input.email)
  const current = await memberRow(db, email)
  if (!current) throw new HttpError(404, 'That person is not a member.', 'not-found')
  if (current.status !== 'revoked') return listMembers(db)
  const at = now.toISOString()
  await db.batch([db.prepare("UPDATE user_roles SET status = 'invited', last_seen_at = NULL WHERE email = ?").bind(email), auditStatement(db, at, actor.email, email, 'revoked', `restored:${current.role}`)])
  await sendInvitation(db, invites, email, now)
  return listMembers(db)
}

/**
 * Sends the invitation email again. WorkOS keeps the original expiry when it re-sends; if there is no live invitation (never sent, failed, expired or already used up) a new
 * one is created. Allowed for an invited member, or an active one who has never signed in through WorkOS (the first administrator).
 */
export async function resendInvitation(db: D1, actor: Actor, input: { email?: unknown }, now: Date, invites: Invitations | null = null): Promise<Member[]> {
  requirePermission(actor, 'access.manage')
  const email = emailOf(input.email)
  const row = await db.prepare('SELECT status, workos_user_id AS wid, workos_invitation_id AS id, invitation_delivery AS delivery, invitation_expires_at AS expires FROM user_roles WHERE email = ?').bind(email).first<{ status: MemberStatus; wid: string | null; id: string | null; delivery: InvitationDelivery | null; expires: string | null }>()
  if (!row) throw new HttpError(404, 'That person is not a member.', 'not-found')
  if (row.status === 'revoked') throw new HttpError(409, 'Restore this person’s access first.', 'revoked')
  if (row.status === 'active' && row.wid) throw new HttpError(409, 'This person has already signed in, so there is nothing to resend.', 'already-signed-in')
  if (!invites) throw new HttpError(409, 'Invitation emails are not set up for this environment. Share the sign-in link instead.', 'invitations-off')
  const live = row.id && row.delivery === 'sent' && (!row.expires || Date.parse(row.expires) > now.getTime())
  if (live) {
    try {
      const r = await invites.resend(row.id as string)
      await db.prepare("UPDATE user_roles SET invitation_sent_at = ?, invitation_expires_at = COALESCE(?, invitation_expires_at), invitation_delivery = 'sent' WHERE email = ?").bind(now.toISOString(), r.expiresAt, email).run()
      await db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, ?, ?)').bind(now.toISOString(), actor.email, email, null, 'invitation-resent').run()
      return listMembers(db)
    } catch { /* it can no longer be resent (used or expired): send a new one below */ }
  }
  await sendInvitation(db, invites, email, now)
  await db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, ?, ?)').bind(now.toISOString(), actor.email, email, null, 'invitation-resent').run()
  return listMembers(db)
}
