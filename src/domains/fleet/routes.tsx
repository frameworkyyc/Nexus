import { useParams, type RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { FleetOverview } from './pages/FleetOverview'
import { VehicleDetails } from './pages/VehicleDetails'
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
      { path: ':vehicleId', element: <VehicleDetails />, handle: { crumb: VehicleCrumb } satisfies CrumbHandle },
    ],
  },
]
