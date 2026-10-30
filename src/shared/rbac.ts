/**
 * Role-based access control, shared by the Worker (which enforces it) and the browser (which only uses it to decide which
 * controls to show). The browser's copy of a role is never trusted: every mutation is re-checked on the server against the
 * role stored in the database for the verified identity.
 *
 * Roles are explicit assignments (table `user_roles`). Nothing is inferred from an email address or from being signed in.
 */
export const ROLES = ['viewer', 'editor', 'admin'] as const
export type Role = (typeof ROLES)[number]
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)

export const ROLE_LABEL: Record<Role, string> = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin' }
export const ROLE_SUMMARY: Record<Role, string> = {
  viewer: 'Can view, search, filter, open details and read history. Cannot change anything.',
  editor: 'Viewer, plus add and edit materials, update quantities, record deliveries, add notes and use bulk edits. Cannot archive, manage access or configuration.',
  admin: 'Editor, plus archive materials, void receipts, manage material configuration and manage who has access.',
}

export type Permission =
  | 'view'
  | 'materials.add' | 'materials.edit' | 'materials.receive' | 'materials.bulk' | 'materials.import'
  | 'materials.archive' | 'materials.void-receipt' | 'materials.configure'
  | 'data.edit' // any other module's records, until those modules get their own permissions
  | 'access.manage'

const VIEWER: Permission[] = ['view']
const EDITOR: Permission[] = [...VIEWER, 'materials.add', 'materials.edit', 'materials.receive', 'materials.bulk', 'materials.import', 'data.edit']
const ADMIN: Permission[] = [...EDITOR, 'materials.archive', 'materials.void-receipt', 'materials.configure', 'access.manage']
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = { viewer: VIEWER, editor: EDITOR, admin: ADMIN }

export const can = (role: Role | null | undefined, permission: Permission) => !!role && ROLE_PERMISSIONS[role].includes(permission)

/** What each saved-data command needs. Anything not listed needs `data.edit` — unknown commands fail closed to editors and above. */
const MATERIALS_COMMANDS: Record<string, Permission> = {
  addMaterials: 'materials.add',
  editMaterial: 'materials.edit',
  bulkEditMaterials: 'materials.bulk',
  addReceipt: 'materials.receive',
  confirmNoReceipts: 'materials.receive',
  removeReceipt: 'materials.void-receipt',
  setOrdered: 'materials.edit',
  setNotes: 'materials.edit',
  acknowledgeFlag: 'materials.edit',
  importTracker: 'materials.import',
  archiveMaterials: 'materials.archive',
}

export function permissionForCommand(module: string, name: string): Permission {
  if (module === 'materials') return MATERIALS_COMMANDS[name] ?? 'materials.configure'
  return 'data.edit'
}
