import { Navigate, Outlet, type Params, type RouteObject } from 'react-router-dom'
import type { CrumbHandle } from '@/layout/TopBar'
import { AnchoragePage } from './pages/AnchoragePage'
import { AreaPage, RegisterPage } from './pages/AreaPage'
import { FabricationPage } from './pages/FabricationPage'
import { FoundationPage } from './pages/FoundationPage'
import { HandoverPage } from './pages/HandoverPage'
import { IssuesPage } from './pages/IssuesPage'
import { MaterialRecordsPage, MaterialsPage } from './pages/MaterialsPage'
import { AreasPage } from './pages/AreasPage'
import { PourPage } from './pages/PourPage'
import { PoursPage } from './pages/PoursPage'
import { ProcurementPage } from './procurement/ProcurementPage'
import { IS_PUBLIC_DEMO } from '@/app/bundle'
import { OverviewPage, ProjectsPage } from './pages/OverviewPage'
import { ProjectHome } from './pages/ProjectDashboard'
import { ProjectLayout } from './pages/ProjectLayout'
import { projectFleetRoutes } from '../fleet/routes'
import { DemoOnly } from './pages/DemoOnly'
import { useConstruction } from './store'
import { FoundationSelector, LegacyRedirect, ManageDiscipline, ProjectContextRedirect, RootRedirect, SetupHub } from './pages/Sections'
import { LEGACY_PROJECT_PATHS } from './navigation'
import { paths } from './paths'

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
  { index: true, element: <RootRedirect />, handle: text('Dashboard') },
  { path: 'overview', element: <OverviewPage />, handle: text('Company overview') },
  // The old global /procurement opens Procurement of the project in context.
  ...(IS_PUBLIC_DEMO ? [] : [{ path: 'procurement', element: <ProjectContextRedirect to={paths.procurement} />, handle: { legacy: true } }]),
  {
    path: 'projects',
    handle: text('Projects'),
    children: [
      { index: true, element: <ProjectsPage /> },
      {
        path: ':projectId',
        element: <ProjectLayout />,
        handle: { crumb: ProjectCrumb, noLink: true } satisfies CrumbHandle,
        children: [
          { index: true, element: <Navigate to="progress" replace /> },
          // ── Project Progress (Stage 2 adds the Materials dashboards; today these are the existing pages) ──
          {
            path: 'progress',
            handle: text('Project Status'),
            children: [
              { index: true, element: <ProjectHome /> },
              { path: 'materials', element: <MaterialsPage />, handle: text('Materials') },
              {
                path: ':areaId',
                element: <Outlet />,
                handle: { crumb: AreaCrumb } satisfies CrumbHandle,
                children: [{ index: true, element: <AreaPage /> }],
              },
            ],
          },
          // ── Operational pages (direct links from the sidebar; no Project Management parent page) ──
          {
            path: 'manage',
            children: [
              { index: true, element: <Navigate to="materials" replace /> }, // an old /manage bookmark
              { path: 'materials', handle: text('Procurement'), children: [
                { index: true, element: IS_PUBLIC_DEMO ? <MaterialsPage /> : <ProcurementPage /> },
                { path: 'records', element: <MaterialRecordsPage />, handle: text('Material records') },
              ] },
              { path: 'construction', element: <ManageDiscipline kind="construction" />, handle: text('Construction') },
              { path: 'survey', element: <ManageDiscipline kind="survey" />, handle: text('Survey') },
              { path: 'qaqc', element: <ManageDiscipline kind="qaqc" />, handle: text('QA/QC') },
              { path: 'civil', element: <ManageDiscipline kind="civil" />, handle: text('Civil / Earthworks') },
            ],
          },
          // ── Foundation Overview ──
          {
            path: 'foundation',
            handle: text('Foundation Overview'),
            children: [
              { index: true, element: <FoundationSelector /> },
              { path: ':foundationId', element: <FoundationPage />, handle: { crumb: FoundationCrumb } satisfies CrumbHandle },
            ],
          },
          // ── Setup (More menu) ──
          {
            path: 'setup',
            handle: text('Setup'),
            children: [
              { index: true, element: <SetupHub /> },
              { path: 'foundations', element: <RegisterPage />, handle: text('Foundations') },
              { path: 'areas', element: <AreasPage />, handle: text('Areas') },
              { path: 'anchorage', element: <AnchoragePage />, handle: text('Anchorage types') },
              { path: 'pours', handle: text('Concrete pours'), children: [{ index: true, element: <PoursPage /> }, { path: ':pourId', element: <PourPage />, handle: { crumb: PourCrumb } satisfies CrumbHandle }] },
            ],
          },
          // ── Other project pages, unchanged ──
          { path: 'fabrication', element: <DemoOnly><FabricationPage /></DemoOnly>, handle: text('Fabrication') },
          { path: 'handover', element: <DemoOnly><HandoverPage /></DemoOnly>, handle: text('Handover') },
          { path: 'issues', element: <IssuesPage />, handle: text('Issues') },
          ...projectFleetRoutes,
          // ── Paths from before the redesign: still work, and land on the new page ──
          ...LEGACY_PROJECT_PATHS.map((path) => ({ path, element: <LegacyRedirect />, handle: { legacy: true } })),
        ],
      },
    ],
  },
]
