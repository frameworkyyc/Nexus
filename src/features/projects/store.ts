import { useSyncExternalStore } from 'react'
import { SEED_PROJECTS } from './mockData'
import type { Project, ProjectInput } from './types'

/**
 * Centralized demo data layer. All reads and writes go through here so a real
 * API client can replace it later without touching the UI.
 * Persistence is browser-local (localStorage) and demonstration-only.
 */
const STORAGE_KEY = 'nexus.demo.projects.v1'

function load(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Project[]
  } catch {
    /* fall through to seed */
  }
  return SEED_PROJECTS
}

let projects: Project[] = load()
const listeners = new Set<() => void>()

function commit(next: Project[]) {
  projects = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable; keep in memory */
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProjects(): Project[] {
  return useSyncExternalStore(subscribe, () => projects)
}

export function useProject(id: string | undefined): Project | undefined {
  return useProjects().find((p) => p.id === id)
}

export function nextProjectNumber(): string {
  const year = new Date().getFullYear()
  const max = projects.reduce((m, p) => Math.max(m, Number(p.number.split('-')[2]) || 0), 0)
  return `NX-${year}-${String(max + 1).padStart(3, '0')}`
}

export function createProject(input: ProjectInput): Project {
  const project = { ...input, id: `prj_${crypto.randomUUID().slice(0, 8)}` }
  commit([project, ...projects])
  return project
}

export function updateProject(id: string, input: ProjectInput) {
  commit(projects.map((p) => (p.id === id ? { ...input, id } : p)))
}

export function resetDemoData() {
  commit(SEED_PROJECTS)
}
