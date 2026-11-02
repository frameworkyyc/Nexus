-- Project configuration: projects differ in scope, so what a project includes is a setting of the project, not an assumption of the application.
--  * projects.use_areas   0 = foundations belong directly to the project (it keeps one hidden, implicit area). Existing projects keep areas: 1.
--  * projects.archived    archived projects leave the lists and the project switcher; every record is kept.
--  * projects.template    the starting template the project was created from (informational).
--  * areas.implicit       the hidden area of a project that does not use areas. Never shown to users.
--  * project_settings     explicit module / construction-scope switches. A missing row means the default (everything that existed before is on; the new
--                         equipment-setting and grouting scope items are off), so no existing project gains work it never had.
-- Additive: no row is rewritten, no activity record is added or removed.
ALTER TABLE projects ADD COLUMN use_areas INTEGER NOT NULL DEFAULT 1 CHECK (use_areas IN (0,1));
ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));
ALTER TABLE projects ADD COLUMN template TEXT NOT NULL DEFAULT 'full-concrete' CHECK (template IN ('full-concrete','grouting-only','custom'));
ALTER TABLE areas ADD COLUMN implicit INTEGER NOT NULL DEFAULT 0 CHECK (implicit IN (0,1));

CREATE TABLE project_settings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  UNIQUE (project_id, key)
);
CREATE INDEX project_settings_project ON project_settings(project_id);

UPDATE schema_info SET value = '31' WHERE key = 'schema_version';
