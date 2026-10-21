export type ProjectStatus = 'planning' | 'active' | 'on-hold' | 'completed'

export interface Project {
  id: string
  number: string
  name: string
  client: string
  location: string
  description: string
  startDate: string // ISO yyyy-mm-dd
  targetDate: string // ISO yyyy-mm-dd
  status: ProjectStatus
  progress: number // 0–100
}

export type ProjectInput = Omit<Project, 'id'>

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  'on-hold': 'On hold',
  completed: 'Completed',
}

export const STATUSES = Object.keys(STATUS_LABEL) as ProjectStatus[]
