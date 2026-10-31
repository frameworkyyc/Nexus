-- A custom name for each purchase order (E-House Anchor Bolts). Additive: existing orders keep an empty name and are shown with a default
-- name worked out from their lines (the record itself is not changed).
ALTER TABLE purchase_orders ADD COLUMN name TEXT NOT NULL DEFAULT '';

UPDATE schema_info SET value = '23' WHERE key = 'schema_version';
