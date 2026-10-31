-- Top plates: a new anchorage component kind (a plate with no centre hole) with thickness, width and length.
-- SQLite cannot widen a CHECK constraint in place, so anchorage_components (and the small category_suppliers table, whose category list also
-- needs 'top-plate') are rebuilt: every existing row is copied across unchanged, in the same order, with the new columns empty. Nothing is
-- deleted or altered. Nothing else references these tables by foreign key.

CREATE TABLE anchorage_components_new (
  id                TEXT PRIMARY KEY,
  anchorage_type_id TEXT NOT NULL REFERENCES anchorage_types (id),
  kind              TEXT NOT NULL CHECK (kind IN ('bolt','sole-plate','top-plate','template','embed-plate')),
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
  seq               INTEGER NOT NULL,
  center_hole       REAL CHECK (center_hole IS NULL OR center_hole > 0),
  stud_count        INTEGER CHECK (stud_count IS NULL OR stud_count >= 1),
  stud_diameter     REAL CHECK (stud_diameter IS NULL OR stud_diameter > 0),
  stud_length       REAL CHECK (stud_length IS NULL OR stud_length > 0),
  thickness         REAL CHECK (thickness IS NULL OR thickness > 0),
  width             REAL CHECK (width IS NULL OR width > 0)
);
INSERT INTO anchorage_components_new (id, anchorage_type_id, kind, qty, label, spec, size, diameter, length, length_unit, thread, top_thread, bottom_thread, nuts_per_bolt, washers_per_bolt, nut_size, washer_size, seq, center_hole, stud_count, stud_diameter, stud_length)
  SELECT id, anchorage_type_id, kind, qty, label, spec, size, diameter, length, length_unit, thread, top_thread, bottom_thread, nuts_per_bolt, washers_per_bolt, nut_size, washer_size, seq, center_hole, stud_count, stud_diameter, stud_length FROM anchorage_components;
DROP TABLE anchorage_components;
ALTER TABLE anchorage_components_new RENAME TO anchorage_components;
CREATE INDEX anchorage_components_type ON anchorage_components (anchorage_type_id);

CREATE TABLE category_suppliers_new (
  category    TEXT PRIMARY KEY CHECK (category IN ('bolt','nut','washer','sole-plate','top-plate','template','embed-plate','other')),
  supplier_id TEXT NOT NULL REFERENCES suppliers (id)
);
INSERT INTO category_suppliers_new (category, supplier_id) SELECT category, supplier_id FROM category_suppliers;
DROP TABLE category_suppliers;
ALTER TABLE category_suppliers_new RENAME TO category_suppliers;

UPDATE schema_info SET value = '24' WHERE key = 'schema_version';
