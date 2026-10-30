import type { Row, RowSet } from '../db'
import { supplierKey } from '@/domains/construction/tracker/suppliers'
import type { Allocation, ComponentCategory, Delivery, DeliveryLine, GroupRef, OrderLine, PurchaseOrder, AnchorageSheetRow, AuditEntry, ImportFlag, ImportMeta, QuantityCalc, RequirementPart, TrackerLine, TrackerState, WorkbookSummaryRow } from '@/domains/construction/tracker/types'

const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export interface MaterialsWriteContext {
  /** Existing batch rows, oldest first. */
  batches: Row[]
  /** The batch new source rows belong to: the new import, or the latest existing one for everyday edits. */
  currentBatchId: string
  isImport: boolean
  /** `${table}:${id}` → batch that last supplied the row. Everyday edits never move a row to another batch. */
  prevBatch: Record<string, string>
}

/**
 * TrackerState → rows. Source facts (material_lines, summary and anchorage rows, flags) and operational edits
 * (material_line_ops, material_receipts, flag_acknowledgements) are separate tables.
 * Every import batch is kept; each source row points at the batch that last supplied it.
 */
export function materialsToRows(state: TrackerState, ctx: MaterialsWriteContext): RowSet {
  const meta = state.meta
  const batchRows = [...ctx.batches]
  if (ctx.isImport && meta && ctx.currentBatchId && !batchRows.some((b) => b.id === ctx.currentBatchId)) {
    batchRows.push({ id: ctx.currentBatchId, file_name: meta.fileName, file_size: meta.fileSize, sha256: meta.sha256, imported_at: meta.importedAt, counts_json: JSON.stringify(meta.counts), seq: batchRows.length })
  }
  const batch = (table: string, id: string, removed = false) =>
    ctx.isImport && !removed ? ctx.currentBatchId : ctx.prevBatch[`${table}:${id}`] ?? ctx.currentBatchId
  return {
    material_import_batches: batchRows,
    suppliers: (state.suppliers ?? []).map((x, seq): Row => ({ id: x.id, name: x.name, name_key: supplierKey(x.name), archived: x.archived ? 1 : 0, created_at: x.createdAt ?? '', created_by: x.createdBy ?? '', seq })),
    category_suppliers: Object.entries(state.preferredSuppliers ?? {}).map(([category, supplier_id]): Row => ({ category, supplier_id: String(supplier_id) })),
    material_lines: state.lines.map((l, seq): Row => ({
      id: l.id, batch_id: batch('material_lines', l.id, !!l.sourceRemoved), source_sheet: l.source.sheet, source_row: l.source.row, area: l.area, footing_type: l.footingType, anchorage_type: l.anchorageType, footings: l.footings, plinths: l.plinths, bolts: l.bolts,
      component: l.component, category: l.category, required_qty: l.requiredQty, calc_json: JSON.stringify(l.calc), source_status: l.sourceStatus, source_comments_json: JSON.stringify(l.sourceNotes), source_removed: l.sourceRemoved ? 1 : 0, seq,
    })),
    material_line_ops: state.lines.filter((l) => l.orderedQty !== null || l.confirmedNoReceipts || l.notes || l.unit || l.supplier || l.supplierId || l.poRef || l.expectedDate || l.archived).map((l): Row => ({
      line_id: l.id, ordered_qty: l.orderedQty, confirmed_no_receipts: l.confirmedNoReceipts ? 1 : 0, notes: l.notes, unit: l.unit ?? '', supplier: l.supplier ?? '', supplier_id: l.supplierId || null, po_ref: l.poRef ?? '', expected_date: l.expectedDate || null, archived: l.archived ? 1 : 0,
    })),
    material_receipts: state.lines.flatMap((l) => l.receipts.map((r, seq): Row => ({ id: r.id, line_id: l.id, receipt_date: r.date, qty: r.qty, reference: r.reference, note: r.note, recorded_by: r.by ?? '', recorded_at: r.at ?? '', seq }))),
    manual_materials: (state.manual ?? []).map((l, seq): Row => ({
      id: l.id, area: l.area, location: l.footingType, anchorage_ref: l.anchorageType, category: l.category, name: l.component, description: l.description ?? '', specification: l.specification ?? '', area_id: l.areaId || null, foundation_id: l.foundationId || null, anchorage_type_id: l.anchorageTypeId || null, size: l.size ?? '',
      required_qty: l.requiredQty, unit: l.unit ?? 'ea', supplier: l.supplier ?? '', supplier_id: l.supplierId || null, po_ref: l.poRef ?? '', expected_date: l.expectedDate || null, claimed_status: l.sourceStatus, ordered_qty: l.orderedQty,
      confirmed_no_receipts: l.confirmedNoReceipts ? 1 : 0, notes: l.notes, archived: l.archived ? 1 : 0, created_at: l.createdAt ?? '', created_by: l.createdBy ?? '',
      origin: l.origin === 'anchorage' ? 'anchorage' : 'manual', derive_key: l.deriveKey ?? null, qty_basis: l.basis ?? 'fixed', qty_each: l.qtyEach ?? null,
      calc_json: l.origin === 'anchorage' || (l.basis && l.basis !== 'fixed') ? JSON.stringify({ calc: l.calc, breakdown: l.breakdown ?? [] }) : '', requirement_removed: l.requirementRemoved ? 1 : 0, seq,
    })),
    manual_material_receipts: (state.manual ?? []).flatMap((l) => l.receipts.map((r, seq): Row => ({ id: r.id, material_id: l.id, receipt_date: r.date, qty: r.qty, reference: r.reference, note: r.note, recorded_by: r.by ?? '', recorded_at: r.at ?? '', seq }))),
    purchase_orders: (state.orders ?? []).map((o, seq): Row => ({ id: o.id, po_number: o.number, supplier_id: o.supplierId || null, supplier: o.supplier, order_date: o.date, expected_date: o.expectedDate || null, notes: o.notes, cancelled: o.cancelled ? 1 : 0, created_at: o.createdAt, created_by: o.createdBy, seq })),
    purchase_order_lines: (state.orderLines ?? []).map((l, seq): Row => ({ id: l.id, order_id: l.orderId, group_key: l.key, area_id: l.areaId || null, area: l.area, category: l.category, name: l.name, specification: l.specification, size: l.size, unit: l.unit, qty: l.qty, seq })),
    procurement_deliveries: (state.deliveries ?? []).map((d, seq): Row => ({ id: d.id, order_id: d.orderId || null, delivery_date: d.date, reference: d.reference, note: d.note, received_by: d.by, received_at: d.at, seq })),
    procurement_delivery_lines: (state.deliveryLines ?? []).map((l, seq): Row => ({ id: l.id, delivery_id: l.deliveryId, order_line_id: l.orderLineId || null, group_key: l.key, area_id: l.areaId || null, area: l.area, category: l.category, name: l.name, specification: l.specification, size: l.size, unit: l.unit, qty: l.qty, seq })),
    material_allocations: (state.allocations ?? []).map((a, seq): Row => ({ id: a.id, group_key: a.key, foundation_id: a.foundationId, qty: a.qty, allocated_by: a.by, allocated_at: a.at, seq })),
    material_audit: (state.history ?? []).map((h, seq): Row => ({ id: h.id, at: h.at, actor: h.by, action: h.action, material_id: h.materialId, label: h.label, summary: h.summary, changes_json: JSON.stringify(h.changes), seq })),
    workbook_summary_rows: state.summary.map((r, seq): Row => ({ id: r.id, batch_id: batch('workbook_summary_rows', r.id), source_sheet: r.source.sheet, source_row: r.source.row, area: r.area, item: r.item, total_qty: r.totalQty, status: r.status, seq })),
    anchorage_sheet_rows: state.anchorage.map((a, seq): Row => ({ id: a.id, batch_id: batch('anchorage_sheet_rows', a.id), source_sheet: a.source.sheet, source_row: a.source.row, footing_type: a.footingType, anchorage_type: a.anchorageType, footings: a.footings, plinths: a.plinths, bolts: a.bolts, component: a.component, category: a.category, required_qty: a.requiredQty, calc_json: JSON.stringify(a.calc), grade: a.grade, source_status: a.sourceStatus, seq })),
    import_flags: state.flags.map((f, seq): Row => ({ id: f.id, batch_id: batch('import_flags', f.id), code: f.code, severity: f.severity, source_sheet: f.source.sheet, source_row: f.source.row, line_id: f.lineId ?? null, message: f.message, seq })),
    flag_acknowledgements: Object.entries(state.acknowledged).map(([flag_id, a]): Row => ({ flag_id, ack_date: a.date, note: a.note })),
  }
}

const receiptOf = (x: Row) => ({ id: String(x.id), date: String(x.receipt_date), qty: Number(x.qty), reference: String(x.reference), note: String(x.note), ...(x.recorded_by ? { by: String(x.recorded_by) } : {}), ...(x.recorded_at ? { at: String(x.recorded_at) } : {}) })
const opDetails = (op: Row): Partial<TrackerLine> => ({
  ...(op.unit ? { unit: String(op.unit) } : {}), ...(op.supplier ? { supplier: String(op.supplier) } : {}), ...(op.supplier_id ? { supplierId: String(op.supplier_id) } : {}), ...(op.po_ref ? { poRef: String(op.po_ref) } : {}),
  ...(op.expected_date ? { expectedDate: String(op.expected_date) } : {}), ...(Number(op.archived) === 1 ? { archived: true } : {}),
})

const groupRef = (r: Row): GroupRef => ({ key: String(r.group_key), areaId: s(r.area_id), area: String(r.area), category: String(r.category) as ComponentCategory, name: String(r.name), specification: String(r.specification), size: String(r.size), unit: String(r.unit) })

export function materialsFromRows(rows: RowSet): TrackerState {
  const ops = new Map((rows.material_line_ops ?? []).map((r) => [String(r.line_id), r]))
  const receipts = new Map<string, Row[]>()
  for (const r of rows.material_receipts ?? []) receipts.set(String(r.line_id), [...(receipts.get(String(r.line_id)) ?? []), r])
  const batches = rows.material_import_batches ?? []
  const last = batches.at(-1)
  const lines = (rows.material_lines ?? []).map((r): TrackerLine => {
    const op = ops.get(String(r.id))
    return {
      id: String(r.id), source: { sheet: String(r.source_sheet), row: Number(r.source_row) }, area: String(r.area), footingType: String(r.footing_type), anchorageType: String(r.anchorage_type),
      footings: Number(r.footings), plinths: Number(r.plinths), bolts: Number(r.bolts), component: String(r.component), category: String(r.category) as TrackerLine['category'], requiredQty: Number(r.required_qty),
      calc: JSON.parse(String(r.calc_json)) as QuantityCalc, sourceStatus: String(r.source_status), sourceNotes: JSON.parse(String(r.source_comments_json)) as string[], ...(Number(r.source_removed) === 1 ? { sourceRemoved: true } : {}),
      orderedQty: op ? n(op.ordered_qty) : null, confirmedNoReceipts: op ? Number(op.confirmed_no_receipts) === 1 : false, notes: op ? String(op.notes) : '',
      receipts: (receipts.get(String(r.id)) ?? []).map(receiptOf),
      ...(op ? opDetails(op) : {}),
    }
  })
  const manualReceipts = new Map<string, Row[]>()
  for (const r of rows.manual_material_receipts ?? []) manualReceipts.set(String(r.material_id), [...(manualReceipts.get(String(r.material_id)) ?? []), r])
  const calcOf = (r: Row): { calc: QuantityCalc; breakdown: RequirementPart[] } | null => { try { return r.calc_json ? (JSON.parse(String(r.calc_json)) as { calc: QuantityCalc; breakdown: RequirementPart[] }) : null } catch { return null } }
  const manual = (rows.manual_materials ?? []).map((r): TrackerLine => ({
    id: String(r.id), origin: String(r.origin) === 'anchorage' ? 'anchorage' : 'manual', source: { sheet: 'Nexus', row: 0 }, area: String(r.area), footingType: String(r.location), anchorageType: String(r.anchorage_ref), footings: 0, plinths: 0, bolts: 0,
    component: String(r.name), category: String(r.category) as TrackerLine['category'], requiredQty: Number(r.required_qty), calc: calcOf(r)?.calc ?? { kind: 'entered', formula: null, expression: 'Entered in Nexus', recomputed: null },
    ...(String(r.qty_basis) !== 'fixed' ? { basis: String(r.qty_basis) as TrackerLine['basis'], qtyEach: n(r.qty_each) } : { qtyEach: n(r.qty_each) }), ...(r.derive_key ? { deriveKey: String(r.derive_key), breakdown: calcOf(r)?.breakdown ?? [] } : {}), ...(Number(r.requirement_removed) === 1 ? { requirementRemoved: true } : {}),
    sourceStatus: String(r.claimed_status), sourceNotes: [], orderedQty: n(r.ordered_qty), confirmedNoReceipts: Number(r.confirmed_no_receipts) === 1, notes: String(r.notes),
    description: String(r.description), specification: String(r.specification), size: String(r.size), unit: String(r.unit), supplier: String(r.supplier), areaId: s(r.area_id), foundationId: s(r.foundation_id), anchorageTypeId: s(r.anchorage_type_id), supplierId: s(r.supplier_id), poRef: String(r.po_ref), expectedDate: s(r.expected_date),
    archived: Number(r.archived) === 1, createdAt: String(r.created_at), createdBy: String(r.created_by), receipts: (manualReceipts.get(String(r.id)) ?? []).map(receiptOf),
  }))
  const history = (rows.material_audit ?? []).map((r): AuditEntry => ({ id: String(r.id), at: String(r.at), by: String(r.actor), action: String(r.action) as AuditEntry['action'], materialId: String(r.material_id), label: String(r.label), summary: String(r.summary), changes: JSON.parse(String(r.changes_json)) as AuditEntry['changes'] }))
  return {
    meta: last ? ({ fileName: String(last.file_name), fileSize: Number(last.file_size), sha256: s(last.sha256), importedAt: String(last.imported_at), counts: JSON.parse(String(last.counts_json)) } as ImportMeta) : null,
    lines, manual, history,
    orders: (rows.purchase_orders ?? []).map((r): PurchaseOrder => ({ id: String(r.id), number: String(r.po_number), supplierId: s(r.supplier_id), supplier: String(r.supplier), date: String(r.order_date), expectedDate: s(r.expected_date), notes: String(r.notes), ...(Number(r.cancelled) === 1 ? { cancelled: true } : {}), createdAt: String(r.created_at), createdBy: String(r.created_by) })),
    orderLines: (rows.purchase_order_lines ?? []).map((r): OrderLine => ({ id: String(r.id), orderId: String(r.order_id), ...groupRef(r), qty: Number(r.qty) })),
    deliveries: (rows.procurement_deliveries ?? []).map((r): Delivery => ({ id: String(r.id), orderId: s(r.order_id), date: String(r.delivery_date), reference: String(r.reference), note: String(r.note), by: String(r.received_by), at: String(r.received_at) })),
    deliveryLines: (rows.procurement_delivery_lines ?? []).map((r): DeliveryLine => ({ id: String(r.id), deliveryId: String(r.delivery_id), orderLineId: s(r.order_line_id), ...groupRef(r), qty: Number(r.qty) })),
    allocations: (rows.material_allocations ?? []).map((r): Allocation => ({ id: String(r.id), key: String(r.group_key), foundationId: String(r.foundation_id), qty: Number(r.qty), by: String(r.allocated_by), at: String(r.allocated_at) })),
    suppliers: (rows.suppliers ?? []).map((r) => ({ id: String(r.id), name: String(r.name), ...(Number(r.archived) === 1 ? { archived: true } : {}), createdAt: String(r.created_at), createdBy: String(r.created_by) })),
    preferredSuppliers: Object.fromEntries((rows.category_suppliers ?? []).map((r) => [String(r.category), String(r.supplier_id)])) as Partial<Record<ComponentCategory, string>>,
    summary: (rows.workbook_summary_rows ?? []).map((r): WorkbookSummaryRow => ({ id: String(r.id), source: { sheet: String(r.source_sheet), row: Number(r.source_row) }, area: String(r.area), item: String(r.item), totalQty: Number(r.total_qty), status: String(r.status) })),
    anchorage: (rows.anchorage_sheet_rows ?? []).map((r): AnchorageSheetRow => ({ id: String(r.id), source: { sheet: String(r.source_sheet), row: Number(r.source_row) }, footingType: String(r.footing_type), anchorageType: String(r.anchorage_type), footings: n(r.footings), plinths: n(r.plinths), bolts: n(r.bolts), component: String(r.component), category: String(r.category) as AnchorageSheetRow['category'], requiredQty: n(r.required_qty), calc: JSON.parse(String(r.calc_json)) as QuantityCalc, grade: n(r.grade), sourceStatus: String(r.source_status) })),
    flags: (rows.import_flags ?? []).map((r): ImportFlag => ({ id: String(r.id), code: String(r.code), severity: String(r.severity) as ImportFlag['severity'], source: { sheet: String(r.source_sheet), row: Number(r.source_row) }, ...(r.line_id ? { lineId: String(r.line_id) } : {}), message: String(r.message) })),
    acknowledged: Object.fromEntries((rows.flag_acknowledgements ?? []).map((r) => [String(r.flag_id), { date: String(r.ack_date), note: String(r.note) }])),
  }
}
