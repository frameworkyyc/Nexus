-- Organization-wide accessory type directory. Additive only: no existing column or row is removed or rewritten except as noted below.
-- A type is created once (for example "Tidy Tank") and then referenced by any number of independent accessory records, each tied to its own asset.
CREATE TABLE accessory_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE, -- lower-cased, trimmed, single-spaced: "Tidy  tank " and "tidy TANK" are the same type
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  seq        INTEGER NOT NULL
);

-- NULL for records that predate the directory and have no reliable match. Types are never deleted, and this reference is enforced.
ALTER TABLE accessories ADD COLUMN type_id TEXT REFERENCES accessory_types (id);

-- Existing accessories already carry a fixed category (their "Type"). Each category in use becomes one directory type, labelled as the app
-- always showed it, and its accessories are linked. The generic "other" category is not a type and is left unlinked, as are custom names.
INSERT INTO accessory_types (id, name, name_key, seq)
SELECT 'aty-' || category,
       CASE category WHEN 'tidy-tank' THEN 'Tidy tank' WHEN 'light-bar' THEN 'Light bar' WHEN 'job-box' THEN 'Job box' WHEN 'headache-rack' THEN 'Headache rack' WHEN 'radio' THEN 'Radio' END,
       CASE category WHEN 'tidy-tank' THEN 'tidy tank' WHEN 'light-bar' THEN 'light bar' WHEN 'job-box' THEN 'job box' WHEN 'headache-rack' THEN 'headache rack' WHEN 'radio' THEN 'radio' END,
       ROW_NUMBER() OVER (ORDER BY category)
FROM (SELECT DISTINCT category FROM accessories WHERE category IN ('tidy-tank', 'light-bar', 'job-box', 'headache-rack', 'radio'));

UPDATE accessories SET type_id = 'aty-' || category WHERE category IN ('tidy-tank', 'light-bar', 'job-box', 'headache-rack', 'radio');

-- A legacy name that only repeats its type's name ("Tidy Tank" on a Tidy tank) carries no extra information, so it is blanked and the
-- name is then always read from the type (renaming the type renames it everywhere). Any other name is a meaningful custom name and is kept.
UPDATE accessories SET name = '' WHERE type_id IS NOT NULL
  AND replace(lower(trim(name)), '-', ' ') = (SELECT name_key FROM accessory_types WHERE id = accessories.type_id);

UPDATE schema_info SET value = '9' WHERE key = 'schema_version';
