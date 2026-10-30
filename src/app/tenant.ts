import { identity } from './identity'
import { IS_PUBLIC_DEMO } from './bundle'
import { useConstruction } from '@/domains/construction/store'
import { useBackend } from '@/lib/dataSource'

const initialsOf = (email?: string) => {
  const name = (email ?? '').split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!name) return ''
  const parts = name.split(' ')
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase()
}

/**
 * Who this installation belongs to and who is signed in. The organization is the one created during setup (from the database);
 * the public demo shows its fictional one. Initials come from the signed-in account; nothing is invented.
 */
export function useTenant() {
  const { state } = useConstruction()
  const backend = useBackend()
  if (IS_PUBLIC_DEMO) return { organization: identity.organization, userInitials: identity.userInitials }
  return { organization: state.company.name, userInitials: initialsOf(backend.user) }
}
