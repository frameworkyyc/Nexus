-- Intentionally empty. This migration used to insert a sample organization, project, areas and vehicles. A new installation must
-- start with no records, so that data now lives in seeds/ (a test fixture, never applied by migrations). The file is kept so the
-- migration history stays contiguous and databases that already applied it are unaffected.
UPDATE schema_info SET value = '2' WHERE key = 'schema_version';
