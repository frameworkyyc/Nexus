import type { Row, RowSet } from './db'

/**
 * What the public, view-only site is allowed to show. This is an explicit policy applied to the saved rows BEFORE they are turned into
 * application state, so a hidden value never reaches the response however the interface changes later. A test requires every table column
 * whose name could hold personal or internal information to be classified here (hidden) or reviewed as public.
 */

/** Tables whose rows are never public. Suppliers and the change history name people and business relationships. */
export const HIDDEN_TABLES = ['suppliers', 'category_suppliers', 'material_audit'] as const

/** Columns blanked in every table that has them: who did something, free-text notes, contacts, vehicle identifiers, suppliers and PO numbers. */
export const HIDDEN_COLUMNS: Record<string, string | number | null> = {
  // people: who recorded, received, reviewed or created something
  created_by: '', recorded_by: '', received_by: '', allocated_by: '', submitted_by: '', reviewed_by: '', override_by: '', actor: '',
  // internal notes and free-text reasons
  notes: '', note: '', status_note: '', review_note: '', resolution_note: '', override_reason: '', end_reason: '', source_comments_json: '[]',
  // contacts
  contact_name: '', contact_email: '', contact_phone: '',
  // vehicle identifiers
  vin: null, licence_plate: null,
  // suppliers and purchase-order numbers (business relationships), delivery slip references, import file details, internal job number
  supplier: '', supplier_id: null, po_ref: '', po_number: '', reference: '', file_name: '', file_size: 0, sha256: '', job_number: '',
}

/** Column names that look sensitive but were reviewed and are public: names of things on the project, not of people. */
export const REVIEWED_PUBLIC = ['name', 'legal_name', 'name_key', 'plate_unit', 'batch_id', 'description', 'location', 'client', 'website'] as const

/** Names that would need a decision if a new column used them. Used by the completeness test, not at run time. */
export const SENSITIVE_NAME = /email|phone|contact|note|_by$|^by$|actor|vin$|plate$|supplier|^po_|password|token|secret|reason|comment|owner|assign|file|sha|reference|job_number|user/

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

/** The rows the public site may see: hidden tables emptied, hidden columns blanked. */
export function redactRows(rows: RowSet): RowSet {
  const out: RowSet = {}
  for (const [table, list] of Object.entries(rows)) {
    if ((HIDDEN_TABLES as readonly string[]).includes(table)) { out[table] = []; continue }
    out[table] = list.map((r): Row => {
      const copy: Row = {}
      for (const [k, v] of Object.entries(r)) copy[k] = k in HIDDEN_COLUMNS ? HIDDEN_COLUMNS[k] : v
      return copy
    })
  }
  return out
}

/** A last safety net on the finished response: any text that looks like an e-mail address is removed, wherever it came from. */
export function stripEmails<T>(value: T): T {
  if (typeof value === 'string') return (EMAIL.test(value) ? value.replace(new RegExp(EMAIL.source, 'gi'), '') : value) as unknown as T
  if (Array.isArray(value)) return value.map(stripEmails) as unknown as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripEmails(v)])) as T
  return value
}
