-- Materials management and role-based access. Additive only: no existing row is changed or removed.

-- Workbook lines stay exactly as imported. Nexus-side details about them live beside the operational edits.
ALTER TABLE material_line_ops ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE material_line_ops ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE material_line_ops ADD COLUMN po_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE material_line_ops ADD COLUMN expected_date TEXT;
ALTER TABLE material_line_ops ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));
-- Who recorded a receipt: the verified identity at the time, or empty when none was available. Never guessed.
ALTER TABLE material_receipts ADD COLUMN recorded_by TEXT NOT NULL DEFAULT '';

-- Materials entered in Nexus (not in the workbook). Own identifiers (mm-…), never mixed into the imported lines.
CREATE TABLE manual_materials (
  id            TEXT PRIMARY KEY,
  area          TEXT NOT NULL,
  location      TEXT NOT NULL DEFAULT '',   -- foundation / installation location
  anchorage_ref TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  size          TEXT NOT NULL DEFAULT '',
  required_qty  INTEGER NOT NULL CHECK (required_qty >= 0),
  unit          TEXT NOT NULL DEFAULT 'ea',
  supplier      TEXT NOT NULL DEFAULT '',
  po_ref        TEXT NOT NULL DEFAULT '',
  expected_date TEXT,
  claimed_status TEXT NOT NULL DEFAULT '',  -- '' | Pending | Delivered: a claim, never a receipt
  ordered_qty   INTEGER CHECK (ordered_qty IS NULL OR ordered_qty >= 0),
  confirmed_no_receipts INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_no_receipts IN (0,1)),
  notes         TEXT NOT NULL DEFAULT '',
  archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);
CREATE INDEX manual_materials_area ON manual_materials (area);

CREATE TABLE manual_material_receipts (
  id           TEXT PRIMARY KEY,
  material_id  TEXT NOT NULL REFERENCES manual_materials (id),
  receipt_date TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  reference    TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  recorded_by  TEXT NOT NULL DEFAULT '',
  seq          INTEGER NOT NULL
);
CREATE INDEX manual_material_receipts_material ON manual_material_receipts (material_id);

-- Append-only history of material changes. Written only by the server, in the same transaction as the change.
CREATE TABLE material_audit (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  material_id TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL,
  changes_json TEXT NOT NULL DEFAULT '[]',
  seq         INTEGER NOT NULL
);
CREATE INDEX material_audit_material ON material_audit (material_id);
CREATE TRIGGER material_audit_no_update BEFORE UPDATE ON material_audit BEGIN SELECT RAISE(ABORT, 'material_audit is append-only'); END;

-- Explicit, server-managed role assignments. Being signed in grants no role.
CREATE TABLE user_roles (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL
);
CREATE TABLE role_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,
  target    TEXT NOT NULL,
  from_role TEXT,
  to_role   TEXT
);

UPDATE schema_info SET value = '5' WHERE key = 'schema_version';
