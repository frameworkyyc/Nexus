import type { RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { Locked } from '@/layout/Locked'
import { SafetyPage } from './SafetyPage'

export const safetyRoutes: RouteObject[] = [{ path: 'safety', element: <Locked id="safety"><SafetyPage /></Locked>, handle: { crumb: () => <>Safety</> } satisfies CrumbHandle }]
