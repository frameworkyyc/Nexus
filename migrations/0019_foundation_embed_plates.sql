-- Embed plates added directly to a foundation (no anchorage group, plinth or individual foundation needed): a library embed plate, a quantity, and
-- how the quantity counts: 'per-foundation' multiplies it by the foundation's quantity of physical foundations, 'total' uses it as the total across
-- all of them. component_id points at an anchorage_components row (not a foreign key, so the library stays editable; the app refuses to remove a
-- library embed plate that foundations use). Additive: nothing existing changes.
CREATE TABLE foundation_embeds (
  id            TEXT PRIMARY KEY,
  foundation_id TEXT NOT NULL REFERENCES foundations (id),
  component_id  TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  mode          TEXT NOT NULL DEFAULT 'per-foundation' CHECK (mode IN ('per-foundation','total')),
  seq           INTEGER NOT NULL
);
CREATE INDEX foundation_embeds_foundation ON foundation_embeds (foundation_id);

UPDATE schema_info SET value = '19' WHERE key = 'schema_version';
