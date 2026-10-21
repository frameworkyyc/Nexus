-- Optional, person-entered tire thresholds. NULL means "not recorded": nothing is assumed or defaulted.
-- Additive only (two nullable columns); existing rows are untouched.
ALTER TABLE tire_sets ADD COLUMN expected_life_km INTEGER CHECK (expected_life_km IS NULL OR expected_life_km > 0);
ALTER TABLE tire_sets ADD COLUMN replace_at_mm REAL CHECK (replace_at_mm IS NULL OR (replace_at_mm >= 0 AND replace_at_mm <= 30));

UPDATE schema_info SET value = '3' WHERE key = 'schema_version';
