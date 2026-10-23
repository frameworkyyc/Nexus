import type { RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { SafetyPage } from './SafetyPage'

export const safetyRoutes: RouteObject[] = [{ path: 'safety', element: <SafetyPage />, handle: { crumb: () => <>Safety</> } satisfies CrumbHandle }]
