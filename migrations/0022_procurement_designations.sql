-- Anchorage designation on calculated requirements and on the order, delivery and installation records that point at them. Anchorage-specific materials
-- are now separate requirements per designation (OP1-D2's plywood templates are not OP1-D3's); the designation is stored so each record stays readable.
-- Additive: existing rows keep an empty designation and are matched to their requirement by the application (a key without a designation follows to the single designation that now owns it).
ALTER TABLE manual_materials ADD COLUMN designation TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_order_lines ADD COLUMN designation TEXT NOT NULL DEFAULT '';
ALTER TABLE procurement_delivery_lines ADD COLUMN designation TEXT NOT NULL DEFAULT '';
ALTER TABLE material_installations ADD COLUMN designation TEXT NOT NULL DEFAULT '';

UPDATE schema_info SET value = '22' WHERE key = 'schema_version';
