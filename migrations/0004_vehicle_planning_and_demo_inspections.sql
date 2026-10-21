-- Planning figures and demonstration-record support. Additive only: nullable columns / a defaulted flag; existing rows are untouched
-- except where a value is still empty (see the guarded UPDATEs below, which never overwrite anything someone entered).
ALTER TABLE vehicles ADD COLUMN expected_life_km INTEGER CHECK (expected_life_km IS NULL OR expected_life_km > 0);
ALTER TABLE vehicles ADD COLUMN inspection_interval_days INTEGER CHECK (inspection_interval_days IS NULL OR inspection_interval_days > 0);
ALTER TABLE service_targets ADD COLUMN interval_km INTEGER CHECK (interval_km IS NULL OR interval_km > 0);
ALTER TABLE inspections ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1));

-- T6010 (configured values supplied by the project coordinator), each only where still empty/untouched.
UPDATE vehicles SET expected_life_km = 180000 WHERE id = 'veh-T6010' AND expected_life_km IS NULL;
-- The 13,551 km target is an oil change on a 5,000 km interval; 2,000 km is the configured "approaching" window.
-- The implied start (8,551 km) is a calculated baseline: no completed oil-change record is created.
UPDATE service_targets SET service_type = 'Oil change', warn_within_km = 2000, interval_km = 5000
 WHERE id = 'svc-T6010-verified' AND service_type IS NULL AND warn_within_km IS NULL AND interval_km IS NULL;
UPDATE tire_sets SET expected_life_km = 60000 WHERE id = 'tire-T6010-1' AND expected_life_km IS NULL;

-- Four Sunday sample inspections for T6010: flagged demo, no inspector, no results, no condition, no defects.
-- Added only when T6010 has no inspection at all, so they can never sit beside or hide genuine history.
INSERT INTO inspections (id, vehicle_id, inspection_date, submitted_by, notes, review, reviewed_by, reviewed_date, review_note, condition, demo, seq)
SELECT 'insp-T6010-demo-' || d.date, 'veh-T6010', d.date, '', 'Demonstration record: not a genuine inspection.', 'submitted', '', NULL, '', NULL, 1, d.n
FROM (SELECT '2026-09-27' AS date, 0 AS n UNION ALL SELECT '2026-10-04', 1 UNION ALL SELECT '2026-10-11', 2 UNION ALL SELECT '2026-10-18', 3) d
WHERE EXISTS (SELECT 1 FROM vehicles WHERE id = 'veh-T6010')
  AND NOT EXISTS (SELECT 1 FROM inspections WHERE vehicle_id = 'veh-T6010');

UPDATE schema_info SET value = '4' WHERE key = 'schema_version';
