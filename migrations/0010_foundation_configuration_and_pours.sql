-- Foundation configuration (anchorage groups, dimensions) and concrete pour planning. Additive only.
-- Existing foundations, plinths, anchorage assignments, activities and materials keep their ids and values.

-- Footing dimensions (optional). NULL = not entered, never zero. One unit applies to all three values.
ALTER TABLE foundations ADD COLUMN footing_length REAL CHECK (footing_length IS NULL OR footing_length > 0);
ALTER TABLE foundations ADD COLUMN footing_width  REAL CHECK (footing_width  IS NULL OR footing_width  > 0);
ALTER TABLE foundations ADD COLUMN footing_height REAL CHECK (footing_height IS NULL OR footing_height > 0);
ALTER TABLE foundations ADD COLUMN footing_unit   TEXT CHECK (footing_unit IS NULL OR footing_unit IN ('mm','cm','m','in','ft'));
-- Whether a plinth's height is measured above the footing, or from the bottom of the footing (the part inside the footing is then not counted twice).
ALTER TABLE foundations ADD COLUMN plinth_base TEXT NOT NULL DEFAULT 'above-footing' CHECK (plinth_base IN ('above-footing','from-footing-base'));

-- A foundation design says how many plinths use each anchorage type. Plinth rows stay the stable per-plinth records
-- (one set per designation, never one per physical foundation); a group links them to a type and default dimensions.
CREATE TABLE foundation_anchorage_groups (
  id              TEXT PRIMARY KEY,
  foundation_id   TEXT NOT NULL REFERENCES foundations (id),
  anchorage_type_id TEXT REFERENCES anchorage_types (id), -- NULL = not assigned yet
  plinth_count    INTEGER NOT NULL CHECK (plinth_count >= 1),
  length          REAL CHECK (length IS NULL OR length > 0),
  width           REAL CHECK (width  IS NULL OR width  > 0),
  height          REAL CHECK (height IS NULL OR height > 0),
  unit            TEXT CHECK (unit IS NULL OR unit IN ('mm','cm','m','in','ft')),
  seq             INTEGER NOT NULL
);
CREATE INDEX anchorage_groups_foundation ON foundation_anchorage_groups (foundation_id);

ALTER TABLE plinths ADD COLUMN group_id TEXT REFERENCES foundation_anchorage_groups (id);
ALTER TABLE plinths ADD COLUMN length REAL CHECK (length IS NULL OR length > 0);
ALTER TABLE plinths ADD COLUMN width  REAL CHECK (width  IS NULL OR width  > 0);
ALTER TABLE plinths ADD COLUMN height REAL CHECK (height IS NULL OR height > 0);
ALTER TABLE plinths ADD COLUMN unit   TEXT CHECK (unit IS NULL OR unit IN ('mm','cm','m','in','ft'));

-- Existing plinths become groups: one per foundation and anchorage assignment (an unknown assignment stays unassigned), in plinth order.
INSERT INTO foundation_anchorage_groups (id, foundation_id, anchorage_type_id, plinth_count, seq)
SELECT foundation_id || '-g' || ROW_NUMBER() OVER (PARTITION BY foundation_id ORDER BY first_idx), foundation_id, anchorage_type_id, n, ROW_NUMBER() OVER (ORDER BY foundation_id, first_idx)
FROM (SELECT foundation_id, anchorage_type_id, COUNT(*) AS n, MIN(idx) AS first_idx FROM plinths GROUP BY foundation_id, anchorage_type_id);

UPDATE plinths SET group_id = (
  SELECT g.id FROM foundation_anchorage_groups g
  WHERE g.foundation_id = plinths.foundation_id AND g.anchorage_type_id IS plinths.anchorage_type_id
);

-- Concrete pours. A pour belongs to a project; its items name physical components: footing or one plinth of unit N (1..quantity) of a foundation.
CREATE TABLE pours (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects (id),
  name           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('planned','scheduled','completed','cancelled')),
  pour_date      TEXT,
  waste_pct      REAL NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  notes          TEXT NOT NULL DEFAULT '',
  actual_m3      REAL CHECK (actual_m3 IS NULL OR actual_m3 >= 0),
  completed_date TEXT,
  created_at     TEXT NOT NULL DEFAULT '',
  created_by     TEXT NOT NULL DEFAULT '',
  seq            INTEGER NOT NULL
);

CREATE TABLE pour_items (
  id             TEXT PRIMARY KEY,
  pour_id        TEXT NOT NULL REFERENCES pours (id),
  foundation_id  TEXT NOT NULL REFERENCES foundations (id),
  unit_no        INTEGER NOT NULL CHECK (unit_no >= 1),
  component      TEXT NOT NULL CHECK (component IN ('footing','plinth')),
  plinth_id      TEXT REFERENCES plinths (id),
  component_key  TEXT NOT NULL, -- 'footing' or the plinth id: one row per component per pour
  planned_m3     REAL CHECK (planned_m3 IS NULL OR planned_m3 >= 0),
  poured_m3      REAL CHECK (poured_m3 IS NULL OR poured_m3 >= 0),
  completed_date TEXT,
  override_reason TEXT NOT NULL DEFAULT '',
  override_by    TEXT NOT NULL DEFAULT '',
  seq            INTEGER NOT NULL,
  CHECK ((component = 'footing' AND plinth_id IS NULL) OR (component = 'plinth' AND plinth_id IS NOT NULL))
);
CREATE UNIQUE INDEX pour_item_once_per_pour ON pour_items (pour_id, foundation_id, unit_no, component_key);
-- A physical component is completed at most once, across every pour: no duplicate completion, no double-counted concrete.
CREATE UNIQUE INDEX pour_item_completed_once ON pour_items (foundation_id, unit_no, component_key) WHERE completed_date IS NOT NULL;

UPDATE schema_info SET value = '10' WHERE key = 'schema_version';
