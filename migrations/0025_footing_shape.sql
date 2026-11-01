-- Footing shape and additions/deductions. Additive: one nullable column on foundations holding the shape as JSON (kind, dimensions in mm, rectangular
-- additions and deductions). NULL = the footing is the rectangle in footing_length/width/height, exactly as before, so every existing foundation keeps its
-- dimensions and calculated volume.
ALTER TABLE foundations ADD COLUMN footing_shape TEXT;

UPDATE schema_info SET value = '25' WHERE key = 'schema_version';
