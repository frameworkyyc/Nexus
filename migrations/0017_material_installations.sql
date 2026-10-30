-- Installation tracking: how much of a consolidated material requirement has actually been installed. Recorded separately from ordering, delivery
-- and allocation (installing never changes what was received or allocated). Additive: nothing existing changes. The area, category and
-- specification are copied onto each record so it stays readable if the requirement later changes.
CREATE TABLE material_installations (
  id            TEXT PRIMARY KEY,
  group_key     TEXT NOT NULL,
  area_id       TEXT,
  area          TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',
  name          TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  size          TEXT NOT NULL DEFAULT '',
  unit          TEXT NOT NULL DEFAULT 'ea',
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  install_date  TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  recorded_by   TEXT NOT NULL DEFAULT '',
  recorded_at   TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);
CREATE INDEX material_installations_group ON material_installations (group_key);

UPDATE schema_info SET value = '17' WHERE key = 'schema_version';
