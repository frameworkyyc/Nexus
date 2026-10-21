export interface ActivityItem {
  id: string
  projectId: string
  text: string
  when: string
}

/** Fictional activity feed (demonstration data). */
export const ACTIVITY: ActivityItem[] = [
  { id: 'a1', projectId: 'prj_02', text: 'Mechanical design package issued for review', when: '2 hours ago' },
  { id: 'a2', projectId: 'prj_01', text: 'Structural steel erection reached 60% complete', when: 'Yesterday' },
  { id: 'a3', projectId: 'prj_03', text: 'Project placed on hold pending client approval', when: '2 days ago' },
  { id: 'a4', projectId: 'prj_04', text: 'Demolition scope confirmed with client', when: '4 days ago' },
  { id: 'a5', projectId: 'prj_05', text: 'Final handover documentation delivered', when: '1 week ago' },
]
