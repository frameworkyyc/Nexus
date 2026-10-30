-- Fleet lifespan settings (organization categories with default lifespans, per-asset meter unit) and the fields a weekly inspection now carries.

-- Organization-wide asset categories. Each has a meter unit (kilometres or operating hours) and an optional default lifespan in that unit.
CREATE TABLE fleet_categories (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL UNIQUE, -- lower-cased, trimmed, single-spaced
  meter_unit   TEXT NOT NULL DEFAULT 'km' CHECK (meter_unit IN ('km','h')),
  default_life REAL CHECK (default_life IS NULL OR default_life > 0),
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  seq          INTEGER NOT NULL
);

-- An asset's category (NULL = none) and what its meter counts. Every existing asset keeps counting kilometres, exactly as before.
-- vehicles.expected_life_km stays the asset's own lifespan estimate (in its meter unit) and always takes priority over the category default.
ALTER TABLE vehicles ADD COLUMN category_id TEXT REFERENCES fleet_categories (id);
ALTER TABLE vehicles ADD COLUMN meter_unit TEXT NOT NULL DEFAULT 'km' CHECK (meter_unit IN ('km','h'));

-- What an inspection submission carried. All optional; none of it is a review. `condition` (the reviewer's verdict) is untouched.
ALTER TABLE inspections ADD COLUMN meter_reading REAL CHECK (meter_reading IS NULL OR meter_reading > 0);
ALTER TABLE inspections ADD COLUMN reported_condition TEXT CHECK (reported_condition IS NULL OR reported_condition IN ('good','fair','poor','out-of-service'));
ALTER TABLE inspections ADD COLUMN next_oil_due REAL CHECK (next_oil_due IS NULL OR next_oil_due > 0);

-- Meter readings may now be operating hours ('h') with one decimal. SQLite cannot widen a CHECK in place, so the table is rebuilt with every row copied
-- unchanged (same ids, values and order), then the original is dropped. Nothing references this table.
CREATE TABLE odometer_readings_new (
  id            TEXT PRIMARY KEY,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles (id),
  reading_date  TEXT,
  reading       REAL NOT NULL CHECK (reading > 0),
  unit          TEXT NOT NULL CHECK (unit IN ('km','mi','h')),
  review        TEXT NOT NULL CHECK (review IN ('valid','needs-review','accepted','rejected')),
  flag          TEXT,
  corrects_id   TEXT,
  note          TEXT NOT NULL DEFAULT '',
  review_note   TEXT NOT NULL DEFAULT '',
  reviewed_date TEXT,
  seq           INTEGER NOT NULL
);
INSERT INTO odometer_readings_new (id, vehicle_id, reading_date, reading, unit, review, flag, corrects_id, note, review_note, reviewed_date, seq)
  SELECT id, vehicle_id, reading_date, reading, unit, review, flag, corrects_id, note, review_note, reviewed_date, seq FROM odometer_readings;
DROP INDEX odometer_vehicle;
DROP TABLE odometer_readings;
ALTER TABLE odometer_readings_new RENAME TO odometer_readings;
CREATE INDEX odometer_vehicle ON odometer_readings (vehicle_id);

UPDATE schema_info SET value = '11' WHERE key = 'schema_version';
