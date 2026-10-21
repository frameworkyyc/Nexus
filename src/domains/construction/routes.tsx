import { Outlet, useParams, type RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { AnchoragePage } from './pages/AnchoragePage'
import { AreaPage, RegisterPage } from './pages/AreaPage'
import { FabricationPage } from './pages/FabricationPage'
import { FoundationPage } from './pages/FoundationPage'
import { HandoverPage } from './pages/HandoverPage'
import { IssuesPage } from './pages/IssuesPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { OverviewPage, ProjectsPage } from './pages/OverviewPage'
import { ProjectDashboard } from './pages/ProjectDashboard'
import { ProjectLayout } from './pages/ProjectLayout'
import { useConstruction } from './store'

const text = (label: string): CrumbHandle => ({ crumb: () => <>{label}</> })

function ProjectCrumb() {
  const { projectId } = useParams()
  const { state } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId)
  return <>{project ? `${project.name} · Job ${project.jobNumber}` : 'Project'}</>
}
function AreaCrumb() {
  const { areaId } = useParams()
  const { idx } = useConstruction()
  return <>{idx.area.get(areaId ?? '')?.name ?? 'Area'}</>
}
function FoundationCrumb() {
  const { foundationId } = useParams()
  const { idx } = useConstruction()
  return <>{idx.foundation.get(foundationId ?? '')?.number ?? 'Foundation'}</>
}

export const constructionRoutes: RouteObject[] = [
  { index: true, element: <OverviewPage />, handle: text('Overview') },
  {
    path: 'projects',
    handle: text('Projects'),
    children: [
      { index: true, element: <ProjectsPage /> },
      {
        path: ':projectId',
        element: <ProjectLayout />,
        handle: { crumb: ProjectCrumb } satisfies CrumbHandle,
        children: [
          { index: true, element: <ProjectDashboard /> },
          { path: 'register', element: <RegisterPage />, handle: text('Foundation register') },
          { path: 'materials', element: <MaterialsPage />, handle: text('Materials') },
          { path: 'fabrication', element: <FabricationPage />, handle: text('Fabrication') },
          { path: 'anchorage', element: <AnchoragePage />, handle: text('Anchorage types') },
          { path: 'handover', element: <HandoverPage />, handle: text('Handover') },
          { path: 'issues', element: <IssuesPage />, handle: text('Issues') },
          {
            path: 'areas/:areaId',
            element: <Outlet />,
            handle: { crumb: AreaCrumb } satisfies CrumbHandle,
            children: [
              { index: true, element: <AreaPage /> },
              { path: 'foundations/:foundationId', element: <FoundationPage />, handle: { crumb: FoundationCrumb } satisfies CrumbHandle },
            ],
          },
        ],
      },
    ],
  },
]
