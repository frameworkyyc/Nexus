import type { ISODate } from '@/lib/date'
import type { FleetState } from './types'
import { currentAssignment } from './selectors'

export type Result = { state: FleetState; error?: undefined } | { error: string; state?: undefined }
export type Reducer = (s: FleetState) => Result

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * Moves a vehicle to another project (or unassigns it with projectId = null). The earlier assignment is closed, not
 * rewritten, so the vehicle's history stays intact. `validProjectIds` comes from the project registry.
 */
export const reassignVehicle = (vehicleId: string, projectId: string | null, validProjectIds: string[], today: ISODate): Reducer => (s) => {
  if (!s.vehicles.some((v) => v.id === vehicleId)) return { error: 'Vehicle not found.' }
  if (projectId !== null && !validProjectIds.includes(projectId)) return { error: 'That project does not exist.' }
  const current = currentAssignment(s, vehicleId)
  if ((current?.projectId ?? null) === projectId) return { error: 'The vehicle is already assigned there.' }
  const closed = s.assignments.map((a) => (a === current ? { ...a, endDate: today } : a))
  const assignments = projectId === null ? closed : [...closed, { id: nextId('asg'), vehicleId, projectId, startDate: today, endDate: null }]
  return { state: { ...s, assignments } }
}
