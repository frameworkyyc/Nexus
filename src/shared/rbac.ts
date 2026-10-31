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
  admin: 'Editor, plus archive materials, void receipts, preferred suppliers, foundations and areas, and manage who has access.',
}

export type Permission =
  | 'view'
  | 'materials.add' | 'materials.edit' | 'materials.receive' | 'materials.bulk' | 'materials.import'
  | 'materials.archive' | 'materials.void-receipt' | 'materials.configure'
  | 'suppliers.add' | 'structure.manage'
  | 'data.edit' // any other module's records, until those modules get their own permissions
  | 'access.manage'

const VIEWER: Permission[] = ['view']
const EDITOR: Permission[] = [...VIEWER, 'materials.add', 'materials.edit', 'materials.receive', 'materials.bulk', 'materials.import', 'suppliers.add', 'data.edit']
const ADMIN: Permission[] = [...EDITOR, 'materials.archive', 'materials.void-receipt', 'materials.configure', 'structure.manage', 'access.manage']
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
  createPurchaseOrder: 'materials.edit',
  setPurchaseOrderNumber: 'materials.edit',
  setPurchaseOrderSupplier: 'materials.edit',
  addOrderLines: 'materials.edit',
  cancelPurchaseOrder: 'materials.void-receipt',
  recordDelivery: 'materials.receive',
  voidDelivery: 'materials.void-receipt',
  setAllocations: 'materials.receive',
  recordInstallation: 'materials.receive',
  voidInstallation: 'materials.void-receipt',
  addSupplier: 'suppliers.add',
  renameSupplier: 'materials.configure',
  archiveSupplier: 'materials.configure',
  setPreferredSupplier: 'materials.configure',
}

/** Foundation and area setup is an Admin task; everything else in construction stays at `data.edit`. */
const CONSTRUCTION_COMMANDS: Record<string, Permission> = { createOrganization: 'structure.manage', updateOrganization: 'structure.manage', createProject: 'structure.manage', updateProject: 'structure.manage', createFoundation: 'structure.manage', renameFoundation: 'structure.manage', editFoundation: 'structure.manage', archiveFoundation: 'structure.manage', createArea: 'structure.manage', addFoundations: 'structure.manage', editArea: 'structure.manage', archiveArea: 'structure.manage', addAnchorageType: 'structure.manage', editAnchorageType: 'structure.manage', archiveAnchorageType: 'structure.manage', configureFoundation: 'structure.manage', setAnchorageComponents: 'structure.manage', setFoundationUnits: 'structure.manage', setPlinthDims: 'structure.manage', recordPourOverride: 'structure.manage' }

/** Anyone who can edit fleet records may add an accessory type; renaming and archiving types, and the organization's fleet categories and default lifespans, are Admin tasks. */
const FLEET_COMMANDS: Record<string, Permission> = { renameAccessoryType: 'structure.manage', setAccessoryTypeArchived: 'structure.manage', addFleetCategory: 'structure.manage', updateFleetCategory: 'structure.manage', setFleetCategoryArchived: 'structure.manage' }

export function permissionForCommand(module: string, name: string): Permission {
  if (module === 'materials') return MATERIALS_COMMANDS[name] ?? 'materials.configure'
  if (module === 'fleet') return FLEET_COMMANDS[name] ?? 'data.edit'
  if (module === 'construction') return CONSTRUCTION_COMMANDS[name] ?? 'data.edit'
  return 'data.edit'
}
