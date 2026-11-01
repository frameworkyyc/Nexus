-- Team membership for v1.0. Additive: nothing is dropped or rewritten.
--  * user_roles.status: 'invited' (added by an administrator, has not signed in yet), 'active', or 'revoked' (kept for the record; a revoked
--    member has no access even when Cloudflare Access still authenticates them). Every existing row stays 'active'.
--  * user_roles.last_seen_at: set when an invited member first signs in.
--  * user_projects: the projects a non-administrator can see. Administrators always see every project and need no rows.
-- Existing non-administrators keep exactly what they could see: they are given every project that exists today.
ALTER TABLE user_roles ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','revoked'));
ALTER TABLE user_roles ADD COLUMN last_seen_at TEXT;

CREATE TABLE user_projects (
  email       TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (email, project_id)
);
CREATE INDEX user_projects_project ON user_projects (project_id);

INSERT INTO user_projects (email, project_id, assigned_by, assigned_at)
  SELECT r.email, p.id, 'migration:0026', strftime('%Y-%m-%dT%H:%M:%SZ', 'now') FROM user_roles r CROSS JOIN projects p WHERE r.role <> 'admin';

UPDATE schema_info SET value = '26' WHERE key = 'schema_version';
