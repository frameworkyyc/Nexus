import { createBrowserRouter } from 'react-router-dom'
import { constructionRoutes } from '@/domains/construction/routes'
import { dataRoutes } from '@/domains/data/routes'
import { fleetRoutes } from '@/domains/fleet/routes'
import { AppShell } from '@/layout/AppShell'
import { NotFoundPage } from './NotFoundPage'

/** Add new modules as child routes under the shell. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [...constructionRoutes, ...fleetRoutes, ...dataRoutes, { path: '*', element: <NotFoundPage /> }],
  },
])
