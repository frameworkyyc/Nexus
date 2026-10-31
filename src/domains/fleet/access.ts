import type { FleetState } from './types'
import { currentAssignment } from './selectors'

/**
 * Access rules for Fleet, written as plain functions so a server can later enforce the same decisions.
 *
 * IMPORTANT: nothing here is enforced. Nexus is a browser-only demonstration with no sign-in, so every visitor is treated as
 * the demo fleet manager below and anyone with the app open can change anything. These rules describe the intended model; they
 * are not security until server-side authentication and authorization exist.
 */
export type FleetRole = 'fleet-manager' | 'project-supervisor' | 'project-user'
export interface FleetActor { id: string; name: string; role: FleetRole; projectIds: string[]; /** The public view-only site: may see everything the server sends, may change nothing. */ readOnly?: boolean }

export const ACCESS_ENFORCED = false
export const DEMO_ACTOR: FleetActor = { id: 'demo-user', name: 'Demo fleet manager', role: 'fleet-manager', projectIds: [] }
export const PUBLIC_ACTOR: FleetActor = { id: 'public', name: 'Public visitor', role: 'fleet-manager', projectIds: [], readOnly: true }

const assignedTo = (state: FleetState, actor: FleetActor, vehicleId: string) => {
  const a = currentAssignment(state, vehicleId)
  return !!a && actor.projectIds.includes(a.projectId)
}

/** Fleet managers see every vehicle; project roles see vehicles currently assigned to their projects. */
export const canView = (state: FleetState, actor: FleetActor, vehicleId: string) => actor.role === 'fleet-manager' || assignedTo(state, actor, vehicleId)

/** Managers and supervisors update records; other project users are view-only until that is made configurable. */
export const canUpdate = (state: FleetState, actor: FleetActor, vehicleId: string) =>
  !actor.readOnly && (actor.role === 'fleet-manager' || (actor.role === 'project-supervisor' && assignedTo(state, actor, vehicleId)))

/** Moving a vehicle between projects is an organization-level decision. */
export const canReassign = (actor: FleetActor) => !actor.readOnly && actor.role === 'fleet-manager'
export const canReview = (state: FleetState, actor: FleetActor, vehicleId: string) => canUpdate(state, actor, vehicleId)

export const visibleVehicles = (state: FleetState, actor: FleetActor) => state.vehicles.filter((v) => canView(state, actor, v.id))
