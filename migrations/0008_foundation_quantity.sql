-- Foundation designations carry a quantity: how many physical foundations share one name/design (for example 18 foundations named OP1-01-01).
-- Additive only. Each row stays ONE designation with its stable id; individual physical foundations are NOT created here. When per-foundation
-- tracking is introduced later (progress, pours, inspections), it can reference foundations.id from a separate table without replacing any row.
ALTER TABLE foundations ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1);
-- Plinths on each individual foundation. NULL = not known (never assumed to be zero).
ALTER TABLE foundations ADD COLUMN plinths_per_foundation INTEGER CHECK (plinths_per_foundation IS NULL OR plinths_per_foundation >= 0);
-- Existing foundations were created with an explicit plinth count, so their value is the number of plinth records they already have.
UPDATE foundations SET plinths_per_foundation = (SELECT COUNT(*) FROM plinths WHERE plinths.foundation_id = foundations.id);

UPDATE schema_info SET value = '8' WHERE key = 'schema_version';
