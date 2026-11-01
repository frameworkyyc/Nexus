import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TeamMembers } from '../pages/TeamMembers'

let manage = false
vi.mock('@/lib/access', () => ({ useAccess: () => ({ role: manage ? 'admin' : 'editor', simulated: false, user: 'a@example.com', can: () => manage }) }))
vi.mock('@/lib/dataSource', async (orig) => ({ ...(await orig<typeof import('@/lib/dataSource')>()), useIsServer: () => true }))
vi.mock('../store', () => ({ useConstruction: () => ({ state: { projects: [{ id: 'p1', name: 'Alpha' }] } }) }))

const render = () => renderToStaticMarkup(<MemoryRouter><TeamMembers /></MemoryRouter>)

describe('Setup → Team members', () => {
  it('is for administrators only', () => {
    manage = false
    expect(render()).toContain('Administrators only')
    expect(render()).not.toContain('Invite member')
  })

  it('offers invitations to administrators', () => {
    manage = true
    expect(render()).toContain('Invite member')
    expect(render()).toContain('Invitations are manual')
  })
})
