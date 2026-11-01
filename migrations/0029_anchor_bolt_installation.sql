-- Anchor bolt installation is tracked as its own construction activity, by installation method.
-- Wet-set bolts are cast into the concrete as it is poured; post-installed bolts are set into hardened concrete afterwards. The method belongs to the anchor bolts:
--  * foundation_bolts.install_method   individual anchor bolts on a footing or plinths;
--  * foundation_anchorages.install_method   the bolts of an anchorage group's library type.
-- Additive: no rows are rewritten. Existing bolts and anchorage groups become 'wet-set' (the cast-in default; change it in Foundation Setup where the bolts are post-installed).
-- The new "Anchor bolts installed" activities are not stored rows: they exist wherever anchor bolts are required and start as "not started" until recorded, so every
-- existing construction record and material quantity is untouched.
ALTER TABLE foundation_bolts      ADD COLUMN install_method TEXT NOT NULL DEFAULT 'wet-set' CHECK (install_method IN ('wet-set','post-installed'));
ALTER TABLE foundation_anchorages ADD COLUMN install_method TEXT NOT NULL DEFAULT 'wet-set' CHECK (install_method IN ('wet-set','post-installed'));

UPDATE schema_info SET value = '29' WHERE key = 'schema_version';
