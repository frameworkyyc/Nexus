import type { RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { CrewPage } from './CrewPage'

export const crewRoutes: RouteObject[] = [{ path: 'crew', element: <CrewPage />, handle: { crumb: () => <>Crew</> } satisfies CrumbHandle }]
