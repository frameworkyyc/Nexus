import { useParams, type RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { FleetOverview } from './pages/FleetOverview'
import { ProjectFleet } from './pages/ProjectFleet'
import { VehicleDashboard } from './pages/VehicleDashboard'
import { useFleet } from './store'

function VehicleCrumb() {
  const { vehicleId } = useParams()
  const { state } = useFleet()
  return <>{state.vehicles.find((v) => v.id === vehicleId)?.unitNumber ?? 'Vehicle'}</>
}

export const fleetRoutes: RouteObject[] = [
  {
    path: 'fleet',
    handle: { crumb: () => <>Fleet</> } satisfies CrumbHandle,
    children: [
      { index: true, element: <FleetOverview /> },
      { path: ':vehicleId', element: <VehicleDashboard />, handle: { crumb: VehicleCrumb } satisfies CrumbHandle },
    ],
  },
]

/** Fleet inside a project: mounted by the construction routes under /projects/:projectId/fleet. */
export const projectFleetRoutes: RouteObject[] = [
  {
    path: 'fleet',
    handle: { crumb: () => <>Fleet</> } satisfies CrumbHandle,
    children: [
      { index: true, element: <ProjectFleet /> },
      { path: ':vehicleId', element: <VehicleDashboard />, handle: { crumb: VehicleCrumb } satisfies CrumbHandle },
    ],
  },
]
