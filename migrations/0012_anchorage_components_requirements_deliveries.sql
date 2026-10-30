-- Anchorage configuration, calculated material requirements and delivery confirmation. Additive only: no existing row, id or value changes.

-- What each anchorage type is made of: anchor bolt configurations (several per type are allowed), sole plates, plywood templates and embed plates.
-- Nuts and washers are defined on the bolt they belong to. Quantities are per anchorage (per plinth that uses the type).
CREATE TABLE anchorage_components (
  id                TEXT PRIMARY KEY,
  anchorage_type_id TEXT NOT NULL REFERENCES anchorage_types (id),
  kind              TEXT NOT NULL CHECK (kind IN ('bolt','sole-plate','template','embed-plate')),
  qty               INTEGER NOT NULL CHECK (qty >= 1),
  label             TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  size              TEXT NOT NULL DEFAULT '',
  diameter          TEXT NOT NULL DEFAULT '',
  length            REAL CHECK (length IS NULL OR length > 0),
  length_unit       TEXT NOT NULL DEFAULT 'mm' CHECK (length_unit IN ('mm','in')),
  thread            TEXT CHECK (thread IS NULL OR thread IN ('both-ends','all-thread')),
  top_thread        REAL CHECK (top_thread IS NULL OR top_thread > 0),
  bottom_thread     REAL CHECK (bottom_thread IS NULL OR bottom_thread > 0),
  nuts_per_bolt     INTEGER NOT NULL DEFAULT 0 CHECK (nuts_per_bolt >= 0),
  washers_per_bolt  INTEGER NOT NULL DEFAULT 0 CHECK (washers_per_bolt >= 0),
  nut_size          TEXT NOT NULL DEFAULT '',
  washer_size       TEXT NOT NULL DEFAULT '',
  seq               INTEGER NOT NULL
);
CREATE INDEX anchorage_components_type ON anchorage_components (anchorage_type_id);

-- Materials: where a required quantity comes from. 'manual' rows are entered by people; 'anchorage' rows are requirements calculated from the
-- anchorage library and the foundations (one per area and specification, found again by derive_key so they are never duplicated). Orders, receipts,
-- suppliers and notes live on the same row either way and are never touched when a requirement is recalculated.
ALTER TABLE manual_materials ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','anchorage'));
ALTER TABLE manual_materials ADD COLUMN derive_key TEXT;
CREATE UNIQUE INDEX manual_materials_derive_key ON manual_materials (derive_key) WHERE derive_key IS NOT NULL;
-- A quantity entered "per anchorage / per plinth / per footing" is multiplied by the foundation's actual counts; 'fixed' is the total as entered.
ALTER TABLE manual_materials ADD COLUMN qty_basis TEXT NOT NULL DEFAULT 'fixed' CHECK (qty_basis IN ('fixed','per-anchorage','per-plinth','per-footing'));
ALTER TABLE manual_materials ADD COLUMN qty_each INTEGER CHECK (qty_each IS NULL OR qty_each >= 0);
-- The calculation shown beside the total, and what it is made of.
ALTER TABLE manual_materials ADD COLUMN calc_json TEXT NOT NULL DEFAULT '';
-- A calculated requirement that no longer applies (the configuration changed) but already has orders or deliveries: kept, never deleted.
ALTER TABLE manual_materials ADD COLUMN requirement_removed INTEGER NOT NULL DEFAULT 0 CHECK (requirement_removed IN (0,1));

-- Delivery confirmation records when it happened, as well as who (recorded_by) and the delivery date.
ALTER TABLE manual_material_receipts ADD COLUMN recorded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE material_receipts ADD COLUMN recorded_at TEXT NOT NULL DEFAULT '';

UPDATE schema_info SET value = '12' WHERE key = 'schema_version';
