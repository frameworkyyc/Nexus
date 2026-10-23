import { identity } from '@/app/identity'
import type { ConstructionState } from './types'

/** Nothing loaded yet. Used only while saved records are being fetched; the app does not render pages until they arrive. */
export const emptyConstruction = (): ConstructionState => ({
  company: { id: identity.companyId, name: identity.organization }, projects: [], projectIssues: [], areas: [], foundations: [], plinths: [], boltSpecs: [], anchorageTypes: [], bulkMaterials: [], suppliers: [],
  purchaseOrders: [], deliveries: [], allocations: [], plinthReady: [], fabrication: [], activities: [], documents: [], deficiencies: [], handover: [], crews: [], people: [], rotationAnchor: '2026-01-01',
})
