-- Real project and fleet starting points supplied by the project coordinator. Everything is INSERT OR IGNORE, so re-running
-- never overwrites newer records. Nothing here is demonstration data.
-- Not seeded (not provided): VINs, plates, inspections, maintenance history, tire size/condition/tread, installation dates.

INSERT OR IGNORE INTO companies (id, name) VALUES ('progressive', 'Progressive');

INSERT OR IGNORE INTO projects (id, company_id, name, job_number, client, location, scope, status, status_note)
VALUES ('reef', 'progressive', 'REEF', '928', 'AltaGas', 'Ridley Island, British Columbia', 'Concrete Foundations', 'active', '');

INSERT OR IGNORE INTO areas (id, project_id, name, sequence) VALUES
  ('mole-sieve', 'reef', 'Mole Sieve', 1),
  ('propane-bog', 'reef', 'Propane BOG', 2),
  ('piperack', 'reef', 'Piperack', 3),
  ('locomotive-shelter', 'reef', 'Locomotive Shelter', 4),
  ('e-house', 'reef', 'E-House', 5);

INSERT OR IGNORE INTO vehicles (id, company_id, unit_number, year, make, model, vin, licence_plate, notes, seq) VALUES
  ('veh-T6010', 'progressive', 'T6010', 2026, 'Ford', 'F-350', NULL, NULL, '', 0),
  ('veh-T6005', 'progressive', 'T6005', 2026, 'Ford', 'F-350', NULL, NULL, '', 1),
  ('veh-LV167', 'progressive', 'LV167', 2024, 'GMC', '3500', NULL, NULL, '', 2),
  ('veh-LV174', 'progressive', 'LV174', 2024, 'GMC', '3500', NULL, NULL, '', 3);

INSERT OR IGNORE INTO vehicle_assignments (id, vehicle_id, project_id, start_date, end_date, seq) VALUES
  ('asg-T6010-1', 'veh-T6010', 'reef', NULL, NULL, 0),
  ('asg-T6005-1', 'veh-T6005', 'reef', NULL, NULL, 1),
  ('asg-LV167-1', 'veh-LV167', 'reef', NULL, NULL, 2),
  ('asg-LV174-1', 'veh-LV174', 'reef', NULL, NULL, 3);

-- T6010 verified values. Each is inserted only if T6010 has no record of that kind yet, so newer information is never replaced.
INSERT INTO odometer_readings (id, vehicle_id, reading_date, reading, unit, review, flag, corrects_id, note, review_note, reviewed_date, seq)
SELECT 'odo-T6010-verified', 'veh-T6010', NULL, 11856, 'km', 'valid', NULL, NULL, 'Verified information supplied for this unit; date not recorded.', '', NULL, 0
WHERE NOT EXISTS (SELECT 1 FROM odometer_readings WHERE vehicle_id = 'veh-T6010');

INSERT INTO service_targets (id, vehicle_id, odometer, set_date, note, service_type, warn_within_km, seq)
SELECT 'svc-T6010-verified', 'veh-T6010', 13551, NULL, 'Verified information supplied for this unit; date not recorded.', NULL, NULL, 0
WHERE NOT EXISTS (SELECT 1 FROM service_targets WHERE vehicle_id = 'veh-T6010');

INSERT INTO tire_sets (id, vehicle_id, manufacturer, model, size, classes_json, studded, origin, active, install_date, install_odometer, removal_date, removal_odometer, condition, notes, seq)
SELECT 'tire-T6010-1', 'veh-T6010', 'Bridgestone', 'Dueler A/T', NULL, '[]', 'unknown', 'Original factory tires', 1, NULL, 0, NULL, NULL, 'unknown', '', 0
WHERE NOT EXISTS (SELECT 1 FROM tire_sets WHERE vehicle_id = 'veh-T6010');

INSERT INTO accessories (id, name, category, description, specification, cost, warranty, notes, seq)
SELECT 'acc-T6010-tidy-tank', '750 L Tidy Tank', 'tidy-tank', '', '750 L', NULL, '', '', 0
WHERE NOT EXISTS (SELECT 1 FROM accessory_placements WHERE vehicle_id = 'veh-T6010');

INSERT INTO accessory_placements (id, accessory_id, seq, vehicle_id, install_date, install_odometer, end_date, end_odometer, end_reason, to_vehicle_id, note)
SELECT 'acc-T6010-tidy-tank:0', 'acc-T6010-tidy-tank', 0, 'veh-T6010', NULL, NULL, NULL, NULL, NULL, NULL, ''
WHERE EXISTS (SELECT 1 FROM accessories WHERE id = 'acc-T6010-tidy-tank')
  AND NOT EXISTS (SELECT 1 FROM accessory_placements WHERE accessory_id = 'acc-T6010-tidy-tank');

UPDATE schema_info SET value = '2' WHERE key = 'schema_version';
