import { describe, expect, it } from 'vitest'
import * as constructionActions from '@/domains/construction/actions'
import * as constructionCommands from '@/domains/construction/commands'
import * as trackerActions from '@/domains/construction/tracker/actions'
import * as trackerCommands from '@/domains/construction/tracker/commands'
import * as fleetActions from '@/domains/fleet/actions'
import * as fleetCommands from '@/domains/fleet/commands'
import { buildFleetSeed } from '@/domains/fleet/seed'
import { commandOf } from '@/lib/commandTag'
import { SERVER_COMMANDS } from '../registry'

const fns = (m: Record<string, unknown>) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort()

describe('command tagging', () => {
  it('every action creator is exported, tagged, from its module’s commands file (no call site can bypass the server)', () => {
    expect(fns(fleetCommands)).toEqual(fns(fleetActions))
    expect(fns(trackerCommands)).toEqual(fns(trackerActions))
    expect(fns(constructionCommands)).toEqual(fns(constructionActions))
  })

  it('a tagged reducer remembers its call and still behaves like the original', () => {
    const r = fleetCommands.recordOdometer('veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, '2026-10-21')
    expect(commandOf(r)).toEqual({ module: 'fleet', name: 'recordOdometer', args: ['veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, '2026-10-21'] })
    const plain = fleetActions.recordOdometer('veh-T6010', { date: '2026-10-21', reading: 12_000, note: '' }, '2026-10-21')
    expect(commandOf(plain)).toBeUndefined()
    const seed = buildFleetSeed()
    expect(r(seed).state?.odometer).toHaveLength(2)
    expect(plain(seed).state?.odometer).toHaveLength(2)
  })

  it('the server only accepts commands the browser can also send', () => {
    for (const name of Object.keys(SERVER_COMMANDS.fleet)) expect(fleetCommands).toHaveProperty(name)
    for (const name of Object.keys(SERVER_COMMANDS.materials)) expect(trackerCommands).toHaveProperty(name)
    for (const name of Object.keys(SERVER_COMMANDS.construction)) expect(constructionCommands).toHaveProperty(name)
  })

  it('destructive and demonstration-only actions are not accepted by the server', () => {
    expect(SERVER_COMMANDS.materials).not.toHaveProperty('clearTracker')
    for (const name of ['allocate', 'createPurchaseOrder', 'receiveDelivery', 'createFabrication', 'recordAcceptance', 'setReportedProgress', 'addDocument']) expect(SERVER_COMMANDS.construction).not.toHaveProperty(name)
    expect(Object.keys(SERVER_COMMANDS.construction).sort()).toEqual(['addAnchorageType', 'addFoundations', 'addPourItems', 'archiveAnchorageType', 'archiveArea', 'archiveFoundation', 'cancelPour', 'completePour', 'configureFoundation', 'createArea', 'createFoundation', 'createOrganization', 'createPour', 'createProject', 'editAnchorageType', 'editArea', 'editFoundation', 'recordPour', 'recordPourOverride', 'removePourItem', 'renameFoundation', 'setFoundationNotes', 'setPlinthDims', 'setPlinthNotes', 'setPourActual', 'setProjectStatus', 'updateActivity', 'updateOrganization', 'updatePour', 'updateProject'])
  })
})
