-- Planning figures and demonstration-record support. Additive only: nullable columns / a defaulted flag; existing rows are untouched
-- (Sample values for particular vehicles that used to follow here now live in seeds/, never in migrations.)
ALTER TABLE vehicles ADD COLUMN expected_life_km INTEGER CHECK (expected_life_km IS NULL OR expected_life_km > 0);
ALTER TABLE vehicles ADD COLUMN inspection_interval_days INTEGER CHECK (inspection_interval_days IS NULL OR inspection_interval_days > 0);
ALTER TABLE service_targets ADD COLUMN interval_km INTEGER CHECK (interval_km IS NULL OR interval_km > 0);
ALTER TABLE inspections ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1));

UPDATE schema_info SET value = '4' WHERE key = 'schema_version';
