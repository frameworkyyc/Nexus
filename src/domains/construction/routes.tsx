import { Outlet, type Params, type RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { AnchoragePage } from './pages/AnchoragePage'
import { AreaPage, RegisterPage } from './pages/AreaPage'
import { FabricationPage } from './pages/FabricationPage'
import { FoundationPage } from './pages/FoundationPage'
import { HandoverPage } from './pages/HandoverPage'
import { IssuesPage } from './pages/IssuesPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { AreasPage } from './pages/AreasPage'
import { PourPage } from './pages/PourPage'
import { PoursPage } from './pages/PoursPage'
import { ProcurementIndex, ProcurementPage } from './procurement/ProcurementPage'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { OverviewPage, ProjectsPage } from './pages/OverviewPage'
import { ProjectHome } from './pages/ProjectDashboard'
import { ProjectLayout } from './pages/ProjectLayout'
import { projectFleetRoutes } from '../fleet/routes'
import { DemoOnly } from './pages/DemoOnly'
import { useConstruction } from './store'

const text = (label: string): CrumbHandle => ({ crumb: () => <>{label}</> })

function ProjectCrumb({ params }: { params: Params<string> }) {
  const { projectId } = params
  const { state } = useConstruction()
  const project = state.projects.find((p) => p.id === projectId)
  return <>{project ? `${project.name}${project.jobNumber ? ` · Job ${project.jobNumber}` : ''}` : 'Project'}</>
}
function AreaCrumb({ params }: { params: Params<string> }) {
  const { areaId } = params
  const { idx } = useConstruction()
  return <>{idx.area.get(areaId ?? '')?.name ?? 'Area'}</>
}
function PourCrumb({ params }: { params: Params<string> }) {
  const { state } = useConstruction()
  return <>{(state.pours ?? []).find((p) => p.id === params.pourId)?.name ?? 'Pour'}</>
}

function FoundationCrumb({ params }: { params: Params<string> }) {
  const { foundationId } = params
  const { idx } = useConstruction()
  return <>{idx.foundation.get(foundationId ?? '')?.number ?? 'Foundation'}</>
}

export const constructionRoutes: RouteObject[] = [
  { index: true, element: <OverviewPage />, handle: text('Dashboard') },
  ...(IS_PUBLIC_DEMO ? [] : [{ path: 'procurement', element: <ProcurementIndex />, handle: text('Procurement') }]),
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
          { index: true, element: <ProjectHome /> },
          { path: 'register', element: <RegisterPage />, handle: text('Foundation register') },
          { path: 'materials', element: <MaterialsPage />, handle: text('Materials') },
          ...(IS_PUBLIC_DEMO ? [] : [{ path: 'procurement', element: <ProcurementPage />, handle: text('Procurement') }]),
          { path: 'pours', handle: text('Concrete pours'), children: [{ index: true, element: <PoursPage /> }, { path: ':pourId', element: <PourPage />, handle: { crumb: PourCrumb } satisfies CrumbHandle }] },
          { path: 'fabrication', element: <DemoOnly><FabricationPage /></DemoOnly>, handle: text('Fabrication') },
          { path: 'anchorage', element: <AnchoragePage />, handle: text('Anchorage types') },
          { path: 'handover', element: <DemoOnly><HandoverPage /></DemoOnly>, handle: text('Handover') },
          { path: 'issues', element: <IssuesPage />, handle: text('Issues') },
          ...projectFleetRoutes,
          { path: 'areas', element: <AreasPage />, handle: text('Areas') },
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
