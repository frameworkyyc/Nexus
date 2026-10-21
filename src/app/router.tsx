import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/layout/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { NotFoundPage } from './NotFoundPage'

/** Add new modules as child routes under the shell. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
