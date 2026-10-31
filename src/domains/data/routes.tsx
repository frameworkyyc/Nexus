import type { RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { Navigate } from 'react-router-dom'
import { useBackend } from '@/lib/dataSource'
import { DataPage } from './DataPage'

/** Backups, restore and moving data are operator tools: the public view-only site sends visitors back to the start. */
function DataRoute() { const { readOnly } = useBackend(); return readOnly ? <Navigate to="/" replace /> : <DataPage /> }

export const dataRoutes: RouteObject[] = [{ path: 'data', element: <DataRoute />, handle: { crumb: () => <>Data & backups</> } satisfies CrumbHandle }]
