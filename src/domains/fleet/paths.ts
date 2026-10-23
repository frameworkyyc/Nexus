/** Fleet URLs. A vehicle is one record with two entrances: the organization fleet and a project's fleet. */
export const fleetPaths = {
  org: () => '/fleet',
  orgVehicle: (vehicleId: string) => `/fleet/${vehicleId}`,
  project: (projectId: string) => `/projects/${projectId}/fleet`,
  projectVehicle: (projectId: string, vehicleId: string) => `/projects/${projectId}/fleet/${vehicleId}`,
  /** The vehicle dashboard within the context the user came from. */
  vehicle: (vehicleId: string, projectId?: string) => (projectId ? `/projects/${projectId}/fleet/${vehicleId}` : `/fleet/${vehicleId}`),
}
