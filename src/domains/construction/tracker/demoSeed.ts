import { emptyTracker, type ComponentCategory, type Receipt, type TrackerLine, type TrackerState } from './types'

/**
 * FICTIONAL starting materials for the browser-only demo (Harbour Point). Imported only by the demo identity, so it is never part of
 * a build that shows real project data. The demo has no workbook; these are materials "entered in Nexus", with a mix of delivery
 * states so every part of the dashboard has something to show.
 */
const r = (id: string, date: string, qty: number, reference = ''): Receipt => ({ id, date, qty, reference, note: '' })

interface Seed {
  n: number; area: string; location: string; category: ComponentCategory; name: string; spec: string; size: string; qty: number; unit?: string
  supplier: string; po: string; expected?: string; receipts?: Receipt[]; claimed?: string; none?: boolean; archived?: boolean; notes?: string
}

const SEEDS: Seed[] = [
  { n: 1, area: 'Process Area A', location: 'F-1101', category: 'bolt', name: 'Anchor bolt 3/4" x 460 mm', spec: 'ASTM F1554 Gr.36, hot-dip galvanized', size: '3/4" x 460 mm', qty: 24, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-001', receipts: [r('rc-demo-1', '2026-10-06', 24, 'DN-4410')] },
  { n: 2, area: 'Process Area A', location: 'F-1101', category: 'nut', name: 'Heavy hex nut 3/4"', spec: 'ASTM A563 Gr.A, galvanized', size: '3/4"', qty: 48, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-001', expected: '2026-11-04', receipts: [r('rc-demo-2', '2026-10-06', 30, 'DN-4410')] },
  { n: 3, area: 'Process Area A', location: 'F-1101', category: 'washer', name: 'Plate washer 3/4"', spec: 'ASTM F436, galvanized', size: '3/4"', qty: 48, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-001', expected: '2026-11-04' },
  { n: 4, area: 'Process Area A', location: 'F-1101', category: 'template', name: 'Plywood template', spec: '19 mm plywood, drilled to bolt layout', size: '1200 x 1200 mm', qty: 1, unit: 'ea', supplier: 'Demo Lumber Yard', po: 'PO-DEMO-007', claimed: 'Delivered', notes: 'Reported delivered by the yard; receipt not yet entered (sample record).' },
  { n: 5, area: 'Process Area A', location: 'F-1102', category: 'bolt', name: 'Anchor bolt 1" x 600 mm', spec: 'ASTM F1554 Gr.55, hot-dip galvanized', size: '1" x 600 mm', qty: 16, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-002', receipts: [r('rc-demo-5a', '2026-10-08', 8, 'DN-4432'), r('rc-demo-5b', '2026-10-15', 4, 'DN-4471')] },
  { n: 6, area: 'Utility Area B', location: 'F-1201', category: 'sole-plate', name: 'T1 sole plate 6x300x300', spec: 'CSA G40.21 350W', size: '6 x 300 x 300 mm', qty: 4, supplier: 'Demo Steel Fabrication', po: 'PO-DEMO-011', expected: '2026-11-12' },
  { n: 7, area: 'Utility Area B', location: 'F-1201', category: 'bolt', name: 'Anchor bolt 3/4" x 460 mm', spec: 'ASTM F1554 Gr.36, hot-dip galvanized', size: '3/4" x 460 mm', qty: 32, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-003', expected: '2026-11-02', none: true },
  { n: 8, area: 'Utility Area B', location: 'F-1202', category: 'embed-plate', name: 'Embed plate 10x250x250', spec: 'CSA G40.21 300W, 4 studs', size: '10 x 250 x 250 mm', qty: 6, supplier: 'Demo Steel Fabrication', po: 'PO-DEMO-012', receipts: [r('rc-demo-8', '2026-10-14', 6)] },
  { n: 9, area: 'Pipe Rack C', location: 'F-1301', category: 'bolt', name: 'Anchor bolt 1-1/4" x 750 mm', spec: 'ASTM F1554 Gr.105, hot-dip galvanized', size: '1-1/4" x 750 mm', qty: 20, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-004', expected: '2026-11-18' },
  { n: 10, area: 'Pipe Rack C', location: 'F-1301', category: 'nut', name: 'Heavy hex nut 1-1/4"', spec: 'ASTM A563 Gr.DH, galvanized', size: '1-1/4"', qty: 40, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-004', expected: '2026-11-18' },
  { n: 11, area: 'Shelter D', location: 'F-1401', category: 'template', name: 'Plywood template', spec: '19 mm plywood, drilled to bolt layout', size: '900 x 900 mm', qty: 2, supplier: 'Demo Lumber Yard', po: 'PO-DEMO-008', receipts: [r('rc-demo-11', '2026-10-13', 2)] },
  { n: 12, area: 'Shelter D', location: 'F-1401', category: 'other', name: 'Non-shrink grout 25 kg bag', spec: 'CSA A23.1 Type 10', size: '25 kg', qty: 12, unit: 'bag', supplier: 'Demo Building Supply', po: 'PO-DEMO-020', receipts: [r('rc-demo-12', '2026-10-16', 6, 'DN-9012')] },
  { n: 13, area: 'Electrical Building E', location: 'F-1501', category: 'bolt', name: 'Anchor bolt 5/8" x 300 mm', spec: 'ASTM F1554 Gr.36', size: '5/8" x 300 mm', qty: 8, supplier: 'Sample Fastener Supply', po: 'PO-DEMO-005', archived: true, notes: 'Superseded by a design change (sample record).' },
]

export function demoTrackerSeed(): TrackerState {
  const manual = SEEDS.map((s): TrackerLine => ({
    id: `mm-demo-${String(s.n).padStart(3, '0')}`, origin: 'manual', source: { sheet: 'Nexus', row: 0 }, area: s.area, footingType: s.location, anchorageType: '', footings: 0, plinths: 0, bolts: 0,
    component: s.name, category: s.category, requiredQty: s.qty, calc: { kind: 'entered', formula: null, expression: 'Entered in Nexus', recomputed: null }, sourceStatus: s.claimed ?? '', sourceNotes: [],
    orderedQty: null, receipts: s.receipts ?? [], confirmedNoReceipts: !!s.none, notes: s.notes ?? '',
    description: '', specification: s.spec, size: s.size, unit: s.unit ?? 'ea', supplier: s.supplier, poRef: s.po, expectedDate: s.expected ?? null, archived: !!s.archived, createdAt: '2026-10-01T00:00:00.000Z', createdBy: '',
  }))
  return { ...emptyTracker(), manual }
}
