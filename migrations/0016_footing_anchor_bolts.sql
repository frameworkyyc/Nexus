-- Anchor bolts installed directly in a foundation's footings (no plinth or anchorage type needed): bolts per footing, size, thread configuration,
-- and nuts and washers per bolt. Required quantities are calculated as footing quantity x bolts per footing and merge with identical
-- specifications from the Anchorage Library. Additive: nothing existing changes.
CREATE TABLE foundation_bolts (
  id               TEXT PRIMARY KEY,
  foundation_id    TEXT NOT NULL REFERENCES foundations (id),
  qty              INTEGER NOT NULL CHECK (qty >= 1),
  spec             TEXT NOT NULL DEFAULT '',
  diameter         TEXT NOT NULL DEFAULT '',
  length           REAL CHECK (length IS NULL OR length > 0),
  length_unit      TEXT NOT NULL DEFAULT 'mm' CHECK (length_unit IN ('mm','in')),
  thread           TEXT CHECK (thread IS NULL OR thread IN ('both-ends','all-thread')),
  top_thread       REAL CHECK (top_thread IS NULL OR top_thread > 0),
  bottom_thread    REAL CHECK (bottom_thread IS NULL OR bottom_thread > 0),
  nuts_per_bolt    INTEGER NOT NULL DEFAULT 0 CHECK (nuts_per_bolt >= 0),
  washers_per_bolt INTEGER NOT NULL DEFAULT 0 CHECK (washers_per_bolt >= 0),
  nut_size         TEXT NOT NULL DEFAULT '',
  washer_size      TEXT NOT NULL DEFAULT '',
  seq              INTEGER NOT NULL
);
CREATE INDEX foundation_bolts_foundation ON foundation_bolts (foundation_id);

UPDATE schema_info SET value = '16' WHERE key = 'schema_version';
