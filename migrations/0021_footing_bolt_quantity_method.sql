-- Footing anchor bolts: how the quantity counts. 'per-foundation' (the default, and what every existing row keeps) multiplies bolts per footing by the
-- foundation's quantity of physical foundations; 'total' uses the quantity as the total across all of them (for example 4 extra bolts on one footing).
ALTER TABLE foundation_bolts ADD COLUMN mode TEXT NOT NULL DEFAULT 'per-foundation' CHECK (mode IN ('per-foundation','total'));

UPDATE schema_info SET value = '21' WHERE key = 'schema_version';
