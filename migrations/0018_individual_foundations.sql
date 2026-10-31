-- Individual foundations within a foundation designation (for example A-1, A-2, B-1, B-2 within OP1-01-01) and the embed plates each needs.
-- Optional and additive: a foundation with no rows here behaves exactly as before. An individual foundation inherits the designation's footing,
-- anchorage configuration and quantity; it only adds an identifier and its own embed plates, chosen from the Anchorage Library's embed plate
-- components (component_id points at an anchorage_components row; it is not a foreign key so the library can still be edited, and the app
-- refuses to remove a library embed plate that individual foundations use).
CREATE TABLE foundation_units (
  id            TEXT PRIMARY KEY,
  foundation_id TEXT NOT NULL REFERENCES foundations (id),
  label         TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL,
  UNIQUE (foundation_id, label)
);
CREATE INDEX foundation_units_foundation ON foundation_units (foundation_id);

CREATE TABLE foundation_unit_embeds (
  id           TEXT PRIMARY KEY,
  unit_id      TEXT NOT NULL REFERENCES foundation_units (id),
  component_id TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty >= 1),
  seq          INTEGER NOT NULL
);
CREATE INDEX foundation_unit_embeds_unit ON foundation_unit_embeds (unit_id);

UPDATE schema_info SET value = '18' WHERE key = 'schema_version';
