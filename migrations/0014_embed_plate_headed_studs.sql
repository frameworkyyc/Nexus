-- Embed plates can have headed studs: how many per plate, their diameter and length (in the component's length_unit, mm or in). Additive: existing rows keep NULL (no studs).
ALTER TABLE anchorage_components ADD COLUMN stud_count INTEGER CHECK (stud_count IS NULL OR stud_count >= 1);
ALTER TABLE anchorage_components ADD COLUMN stud_diameter REAL CHECK (stud_diameter IS NULL OR stud_diameter > 0);
ALTER TABLE anchorage_components ADD COLUMN stud_length REAL CHECK (stud_length IS NULL OR stud_length > 0);

UPDATE schema_info SET value = '14' WHERE key = 'schema_version';
