-- Material entry uses project records instead of free text. Additive only: existing text values, ids and relationships are untouched.

-- Foundations can be archived (hidden from pickers and the default register view). Nothing about them is deleted.
ALTER TABLE foundations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));

-- Central supplier directory. name_key is the normalised name (case, spacing, punctuation and legal suffixes removed) so
-- "Nucor", "NUCOR Inc." and "nucor" cannot exist twice. Designed to be reused by Purchasing / Procurement later.
CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  seq        INTEGER NOT NULL
);

-- Preferred supplier per material category: a suggestion used when entering new materials, never applied to existing records.
CREATE TABLE category_suppliers (
  category    TEXT PRIMARY KEY CHECK (category IN ('bolt','nut','washer','sole-plate','template','embed-plate','other')),
  supplier_id TEXT NOT NULL REFERENCES suppliers (id)
);

-- The only preference confirmed so far: Anchor Bolts -> Nucor. Added only when nothing is configured for that category.
INSERT OR IGNORE INTO suppliers (id, name, name_key, archived, created_at, created_by, seq) VALUES ('sup-nucor', 'Nucor', 'nucor', 0, '', 'migration 0006', 0);
INSERT OR IGNORE INTO category_suppliers (category, supplier_id) VALUES ('bolt', 'sup-nucor');

-- Materials reference project records by stable id. The text columns stay as the value as entered / as last saved (legacy and display fallback).
ALTER TABLE manual_materials ADD COLUMN area_id TEXT REFERENCES areas (id);
ALTER TABLE manual_materials ADD COLUMN foundation_id TEXT REFERENCES foundations (id);
ALTER TABLE manual_materials ADD COLUMN anchorage_type_id TEXT;   -- construction anchorage type id, or 'wb:<code>' for a workbook anchorage code
ALTER TABLE manual_materials ADD COLUMN supplier_id TEXT REFERENCES suppliers (id);
ALTER TABLE material_line_ops ADD COLUMN supplier_id TEXT REFERENCES suppliers (id);

UPDATE schema_info SET value = '6' WHERE key = 'schema_version';
