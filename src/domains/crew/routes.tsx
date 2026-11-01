import type { RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { Locked } from '@/layout/Locked'
import { CrewPage } from './CrewPage'

export const crewRoutes: RouteObject[] = [{ path: 'crew', element: <Locked id="crew"><CrewPage /></Locked>, handle: { crumb: () => <>Crew</> } satisfies CrumbHandle }]
