-- Sole plates can have a centre hole; its diameter uses the component's length_unit (mm or in). Additive: existing rows keep NULL (no hole specified).
ALTER TABLE anchorage_components ADD COLUMN center_hole REAL CHECK (center_hole IS NULL OR center_hole > 0);

UPDATE schema_info SET value = '13' WHERE key = 'schema_version';
