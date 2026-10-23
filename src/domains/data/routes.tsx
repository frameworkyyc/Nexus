import type { RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { DataPage } from './DataPage'

export const dataRoutes: RouteObject[] = [{ path: 'data', element: <DataPage />, handle: { crumb: () => <>Data & backups</> } satisfies CrumbHandle }]
