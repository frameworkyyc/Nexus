-- Embed plates created inside the foundation form: plate size (thickness x width x length) and optional headed studs, with no anchorage type needed.
-- "Foundation specific" plates keep their specification on the foundation_embeds row itself (component_id is empty). "Saved to the library" plates
-- live in library_embed_plates, per project, and can be chosen by any foundation. Additive: existing embed plates (component_id pointing at an
-- anchorage type's embed plate) are untouched.
ALTER TABLE foundation_embeds ADD COLUMN thickness REAL CHECK (thickness IS NULL OR thickness > 0);
ALTER TABLE foundation_embeds ADD COLUMN width REAL CHECK (width IS NULL OR width > 0);
ALTER TABLE foundation_embeds ADD COLUMN length REAL CHECK (length IS NULL OR length > 0);
ALTER TABLE foundation_embeds ADD COLUMN plate_unit TEXT NOT NULL DEFAULT 'mm' CHECK (plate_unit IN ('mm','in'));
ALTER TABLE foundation_embeds ADD COLUMN stud_count INTEGER CHECK (stud_count IS NULL OR stud_count >= 1);
ALTER TABLE foundation_embeds ADD COLUMN stud_diameter REAL CHECK (stud_diameter IS NULL OR stud_diameter > 0);
ALTER TABLE foundation_embeds ADD COLUMN stud_length REAL CHECK (stud_length IS NULL OR stud_length > 0);

CREATE TABLE library_embed_plates (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id),
  thickness     REAL NOT NULL CHECK (thickness > 0),
  width         REAL NOT NULL CHECK (width > 0),
  length        REAL NOT NULL CHECK (length > 0),
  unit          TEXT NOT NULL DEFAULT 'mm' CHECK (unit IN ('mm','in')),
  stud_count    INTEGER CHECK (stud_count IS NULL OR stud_count >= 1),
  stud_diameter REAL CHECK (stud_diameter IS NULL OR stud_diameter > 0),
  stud_length   REAL CHECK (stud_length IS NULL OR stud_length > 0),
  created_at    TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);
CREATE INDEX library_embed_plates_project ON library_embed_plates (project_id);

UPDATE schema_info SET value = '20' WHERE key = 'schema_version';
