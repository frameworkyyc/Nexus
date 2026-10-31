import { useEffect } from 'react'
import { useMatch } from 'react-router-dom'
import { resolveProject } from '@/domains/construction/navigation'
import { useConstruction } from '@/domains/construction/store'

const KEY = 'nexus.lastProject'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = (id: string) => { try { localStorage.setItem(KEY, id) } catch { /* private mode: the choice just isn't remembered */ } }

/** The project the three project sections work in: the one in the URL, else the last one used, else the first. Remembered per browser. */
export function useProjectContext() {
  const { state } = useConstruction()
  const routeId = useMatch('/projects/:projectId/*')?.params.projectId
  const projects = state.projects
  const projectId = resolveProject(projects, routeId, read())
  useEffect(() => { if (routeId && projects.some((p) => p.id === routeId)) write(routeId) }, [routeId, projects])
  return { projectId, project: projects.find((p) => p.id === projectId) ?? null, projects }
}
