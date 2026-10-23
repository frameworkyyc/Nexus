-- Nexus operational schema, version 1.
-- Conventions: TEXT ids (stable, client-visible); ISO-8601 dates as TEXT; booleans as INTEGER 0/1;
-- `seq` preserves the order in which records were created (the application relies on creation order for tie-breaks).
-- Source facts (what a workbook said) and operational edits (what people recorded in Nexus) live in separate tables.

CREATE TABLE schema_info (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Append-only record of every accepted change (command). Also gives retried requests an answer without re-applying them.
CREATE TABLE change_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    TEXT NOT NULL UNIQUE,
  module        TEXT NOT NULL,
  command       TEXT NOT NULL,
  args_json     TEXT NOT NULL,
  actor         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  result_version INTEGER NOT NULL
);
CREATE INDEX change_log_module ON change_log (module, id);

-- One counter per module; bumped by every accepted change so clients can tell when they are out of date.
CREATE TABLE module_versions (
  module  TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO module_versions (module, version) VALUES ('fleet', 0), ('materials', 0), ('construction', 0);

-- Optimistic-concurrency guard. A write batch starts with an INSERT that violates this CHECK when the module changed since it was
-- read, which rolls the whole batch back. The table never holds rows.
CREATE TABLE write_guard (
  stale INTEGER NOT NULL CHECK (stale = 0)
);

/* ── Construction ─────────────────────────────────────────────────────── */

CREATE TABLE companies (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies (id),
  name            TEXT NOT NULL,
  job_number      TEXT NOT NULL,
  client          TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  scope           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL CHECK (status IN ('planning','active','at-risk','delayed','on-hold','complete')),
  status_note     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE areas (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  name       TEXT NOT NULL,
  sequence   INTEGER NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE foundations (
  id          TEXT PRIMARY KEY,
  area_id     TEXT NOT NULL REFERENCES areas (id),
  number      TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  seq         INTEGER NOT NULL,
  UNIQUE (area_id, number)
);

CREATE TABLE plinths (
  id            TEXT PRIMARY KEY,
  foundation_id TEXT NOT NULL REFERENCES foundations (id),
  idx           INTEGER NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL,
  UNIQUE (foundation_id, idx)
);

-- Only activities a person has recorded are stored. A foundation with no row for an activity has not had it recorded:
-- the application treats that as "not started", never as complete.
CREATE TABLE activities (
  id            TEXT PRIMARY KEY, -- `${ownerId}:${key}`
  scope         TEXT NOT NULL CHECK (scope IN ('footing','plinth')),
  activity_key  TEXT NOT NULL,
  foundation_id TEXT NOT NULL REFERENCES foundations (id),
  plinth_id     TEXT REFERENCES plinths (id),
  status        TEXT NOT NULL CHECK (status IN ('not-started','in-progress','complete','pending-review','approved','blocked')),
  planned_date  TEXT,
  actual_date   TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);
CREATE INDEX activities_foundation ON activities (foundation_id);

/* ── Fleet ────────────────────────────────────────────────────────────── */

CREATE TABLE vehicles (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies (id),
  unit_number   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  year          INTEGER NOT NULL,
  make          TEXT NOT NULL,
  model         TEXT NOT NULL,
  vin           TEXT,
  licence_plate TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);

CREATE TABLE vehicle_assignments (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles (id),
  project_id TEXT NOT NULL REFERENCES projects (id),
  start_date TEXT,
  end_date   TEXT,
  seq        INTEGER NOT NULL
);
CREATE INDEX vehicle_assignments_vehicle ON vehicle_assignments (vehicle_id);

CREATE TABLE odometer_readings (
  id            TEXT PRIMARY KEY,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles (id),
  reading_date  TEXT, -- NULL = a verified value supplied without a date
  reading       INTEGER NOT NULL CHECK (reading > 0),
  unit          TEXT NOT NULL CHECK (unit IN ('km','mi')),
  review        TEXT NOT NULL CHECK (review IN ('valid','needs-review','accepted','rejected')),
  flag          TEXT,
  corrects_id   TEXT,
  note          TEXT NOT NULL DEFAULT '',
  review_note   TEXT NOT NULL DEFAULT '',
  reviewed_date TEXT,
  seq           INTEGER NOT NULL
);
CREATE INDEX odometer_vehicle ON odometer_readings (vehicle_id);

CREATE TABLE service_targets (
  id             TEXT PRIMARY KEY,
  vehicle_id     TEXT NOT NULL REFERENCES vehicles (id),
  odometer       INTEGER NOT NULL CHECK (odometer > 0),
  set_date       TEXT,
  note           TEXT NOT NULL DEFAULT '',
  service_type   TEXT,
  warn_within_km INTEGER,
  seq            INTEGER NOT NULL
);

CREATE TABLE maintenance_records (
  id           TEXT PRIMARY KEY,
  vehicle_id   TEXT NOT NULL REFERENCES vehicles (id),
  service_date TEXT NOT NULL,
  service_type TEXT NOT NULL,
  odometer     INTEGER,
  description  TEXT NOT NULL DEFAULT '',
  condition    TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  seq          INTEGER NOT NULL
);

CREATE TABLE tire_sets (
  id               TEXT PRIMARY KEY,
  vehicle_id       TEXT NOT NULL REFERENCES vehicles (id),
  manufacturer     TEXT NOT NULL,
  model            TEXT NOT NULL,
  size             TEXT,
  classes_json     TEXT NOT NULL DEFAULT '[]',
  studded          TEXT NOT NULL CHECK (studded IN ('yes','no','unknown')),
  origin           TEXT NOT NULL DEFAULT '',
  active           INTEGER NOT NULL CHECK (active IN (0,1)),
  install_date     TEXT,
  install_odometer INTEGER,
  removal_date     TEXT,
  removal_odometer INTEGER,
  condition        TEXT NOT NULL CHECK (condition IN ('unknown','good','fair','worn','replace')),
  notes            TEXT NOT NULL DEFAULT '',
  seq              INTEGER NOT NULL
);
-- At most one active set per vehicle.
CREATE UNIQUE INDEX tire_sets_one_active ON tire_sets (vehicle_id) WHERE active = 1;

CREATE TABLE tread_measurements (
  id            TEXT PRIMARY KEY,
  tire_set_id   TEXT NOT NULL REFERENCES tire_sets (id),
  measured_date TEXT,
  odometer      INTEGER,
  depth_mm      REAL NOT NULL CHECK (depth_mm >= 0),
  note          TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);

CREATE TABLE accessories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  cost          REAL CHECK (cost IS NULL OR cost >= 0),
  warranty      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);

CREATE TABLE accessory_placements (
  id               TEXT PRIMARY KEY, -- `${accessoryId}:${seq}`
  accessory_id     TEXT NOT NULL REFERENCES accessories (id),
  seq              INTEGER NOT NULL,
  vehicle_id       TEXT NOT NULL REFERENCES vehicles (id),
  install_date     TEXT,
  install_odometer INTEGER,
  end_date         TEXT,
  end_odometer     INTEGER,
  end_reason       TEXT CHECK (end_reason IS NULL OR end_reason IN ('removed','transferred')),
  to_vehicle_id    TEXT REFERENCES vehicles (id),
  note             TEXT NOT NULL DEFAULT ''
);
-- An accessory is installed on at most one vehicle at a time.
CREATE UNIQUE INDEX accessory_one_open_placement ON accessory_placements (accessory_id) WHERE end_reason IS NULL;

CREATE TABLE inspections (
  id              TEXT PRIMARY KEY,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles (id),
  inspection_date TEXT NOT NULL,
  submitted_by    TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  review          TEXT NOT NULL CHECK (review IN ('submitted','reviewed')),
  reviewed_by     TEXT NOT NULL DEFAULT '',
  reviewed_date   TEXT,
  review_note     TEXT NOT NULL DEFAULT '',
  condition       TEXT, -- NULL until a reviewer states one; submission never implies a condition
  seq             INTEGER NOT NULL,
  UNIQUE (vehicle_id, inspection_date)
);

CREATE TABLE inspection_defects (
  id              TEXT PRIMARY KEY,
  inspection_id   TEXT NOT NULL REFERENCES inspections (id),
  description     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('outstanding','resolved')),
  resolved_date   TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  seq             INTEGER NOT NULL
);

/* ── Materials ────────────────────────────────────────────────────────── */

CREATE TABLE material_import_batches (
  id          TEXT PRIMARY KEY,
  file_name   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  sha256      TEXT,
  imported_at TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  seq         INTEGER NOT NULL
);

-- Source requirements exactly as the workbook stated them. Operational edits are in material_line_ops and material_receipts.
CREATE TABLE material_lines (
  id            TEXT PRIMARY KEY, -- area | footing type | anchorage type | component
  batch_id      TEXT NOT NULL REFERENCES material_import_batches (id),
  source_sheet  TEXT NOT NULL,
  source_row    INTEGER NOT NULL,
  area          TEXT NOT NULL,
  footing_type  TEXT NOT NULL,
  anchorage_type TEXT NOT NULL,
  footings      INTEGER NOT NULL,
  plinths       INTEGER NOT NULL,
  bolts         INTEGER NOT NULL,
  component     TEXT NOT NULL,
  category      TEXT NOT NULL,
  required_qty  REAL NOT NULL CHECK (required_qty >= 0),
  calc_json     TEXT NOT NULL,
  source_status TEXT NOT NULL,
  source_comments_json TEXT NOT NULL DEFAULT '[]',
  source_removed INTEGER NOT NULL DEFAULT 0 CHECK (source_removed IN (0,1)),
  seq           INTEGER NOT NULL
);
CREATE INDEX material_lines_area ON material_lines (area);

-- Operational edits to a line. A row exists only once something was entered.
CREATE TABLE material_line_ops (
  line_id                TEXT PRIMARY KEY REFERENCES material_lines (id),
  ordered_qty            INTEGER CHECK (ordered_qty IS NULL OR ordered_qty >= 0),
  confirmed_no_receipts  INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_no_receipts IN (0,1)),
  notes                  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE material_receipts (
  id           TEXT PRIMARY KEY,
  line_id      TEXT NOT NULL REFERENCES material_lines (id),
  receipt_date TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  reference    TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  seq          INTEGER NOT NULL
);
CREATE INDEX material_receipts_line ON material_receipts (line_id);

CREATE TABLE workbook_summary_rows (
  id          TEXT PRIMARY KEY,
  batch_id    TEXT NOT NULL REFERENCES material_import_batches (id),
  source_sheet TEXT NOT NULL,
  source_row  INTEGER NOT NULL,
  area        TEXT NOT NULL,
  item        TEXT NOT NULL,
  total_qty   REAL NOT NULL,
  status      TEXT NOT NULL,
  seq         INTEGER NOT NULL
);

CREATE TABLE anchorage_sheet_rows (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES material_import_batches (id),
  source_sheet  TEXT NOT NULL,
  source_row    INTEGER NOT NULL,
  footing_type  TEXT NOT NULL,
  anchorage_type TEXT NOT NULL,
  footings      INTEGER,
  plinths       INTEGER,
  bolts         INTEGER,
  component     TEXT NOT NULL,
  category      TEXT NOT NULL,
  required_qty  REAL,
  calc_json     TEXT NOT NULL,
  grade         REAL,
  source_status TEXT NOT NULL,
  seq           INTEGER NOT NULL
);

CREATE TABLE import_flags (
  id           TEXT PRIMARY KEY,
  batch_id     TEXT NOT NULL REFERENCES material_import_batches (id),
  code         TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('review','info')),
  source_sheet TEXT NOT NULL,
  source_row   INTEGER NOT NULL,
  line_id      TEXT,
  message      TEXT NOT NULL,
  seq          INTEGER NOT NULL
);

CREATE TABLE flag_acknowledgements (
  flag_id TEXT PRIMARY KEY REFERENCES import_flags (id),
  ack_date TEXT NOT NULL,
  note    TEXT NOT NULL DEFAULT ''
);

INSERT INTO schema_info (key, value) VALUES ('schema_version', '1');
