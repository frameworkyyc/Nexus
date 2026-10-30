import type { AuthEnv, Identity } from './auth'
import type { D1 } from './db'
import { HttpError } from './service'
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

export interface Actor { email: string; role: Role | null }

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
    const row = await db.prepare('SELECT role FROM user_roles WHERE email = ?').bind(email).first<{ role: string }>()
    if (row && isRole(row.role)) return { email, role: row.role }
    const initial = normalizeEmail(env.INITIAL_ADMIN_EMAIL)
    if (initial && initial === email) {
      const anyAdmin = await db.prepare("SELECT 1 AS x FROM user_roles WHERE role = 'admin' LIMIT 1").first()
      if (!anyAdmin) {
        const at = now.toISOString()
        await db.batch([
          db.prepare('INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(email, 'admin', 'bootstrap:INITIAL_ADMIN_EMAIL', at),
          db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, NULL, ?)').bind(at, 'bootstrap:INITIAL_ADMIN_EMAIL', email, 'admin'),
        ])
        return { email, role: 'admin' }
      }
    }
  } catch { /* table missing or database unavailable: no role */ }
  return { email, role: null }
}

export function requirePermission(actor: Actor, permission: Permission): void {
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
    const admins = await db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'").first<{ n: number }>()
    if (Number(admins?.n ?? 0) <= 1) throw new HttpError(409, 'There must always be at least one administrator.', 'last-admin')
  }
  const at = now.toISOString()
  const stmts = [
    roleRaw === null
      ? db.prepare('DELETE FROM user_roles WHERE email = ?').bind(target)
      : db.prepare('INSERT INTO user_roles (email, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at').bind(target, roleRaw, actor.email, at),
    db.prepare('INSERT INTO role_audit (at, actor, target, from_role, to_role) VALUES (?, ?, ?, ?, ?)').bind(at, actor.email, target, current?.role ?? null, roleRaw),
  ]
  await db.batch(stmts)
  return listRoles(db)
}
