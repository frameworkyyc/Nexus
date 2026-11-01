-- Post-Install on embed plates, alongside anchor bolts and anchorage groups (0029). A post-installed embed plate has its own installation activity in Construction;
-- one installed with the pour (the default) has none.
-- Additive: no rows are rewritten. Existing embed plates stay 'wet-set' (installed with the pour). The 'wet-set' value of the three install_method columns now simply
-- means "not post-installed"; settings already marked 'post-installed' (bolts, anchorage groups) are kept as they are.
-- The "Embed plates installed" activities are not stored rows: they exist wherever a post-installed embed plate does and start "not started" until recorded.
ALTER TABLE foundation_embeds ADD COLUMN install_method TEXT NOT NULL DEFAULT 'wet-set' CHECK (install_method IN ('wet-set','post-installed'));

UPDATE schema_info SET value = '30' WHERE key = 'schema_version';
