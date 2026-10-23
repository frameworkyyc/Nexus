import { createBrowserRouter } from 'react-router-dom'
import { IS_PUBLIC_DEMO } from './bundle'
import { crewRoutes } from '@/domains/crew/routes'
import { safetyRoutes } from '@/domains/safety/routes'
import { constructionRoutes } from '@/domains/construction/routes'
import { dataRoutes } from '@/domains/data/routes'
import { fleetRoutes } from '@/domains/fleet/routes'
import { AppShell } from '@/layout/AppShell'
import { NotFoundPage } from './NotFoundPage'

/** Add new modules as child routes under the shell. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [...constructionRoutes, ...fleetRoutes, ...crewRoutes, ...safetyRoutes, ...(IS_PUBLIC_DEMO ? [] : dataRoutes), { path: '*', element: <NotFoundPage /> }],
  },
])
