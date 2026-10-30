-- Fresh-install support: organization details, richer projects and areas, a persisted anchorage library, equipment kind.
-- Additive only. No row is created, changed or removed: a new installation starts with no organization, projects, areas or assets.

ALTER TABLE companies ADD COLUMN legal_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN location      TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN contact_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN website       TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN notes         TEXT NOT NULL DEFAULT '';

ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN start_date  TEXT;
ALTER TABLE projects ADD COLUMN end_date    TEXT;

ALTER TABLE areas ADD COLUMN identifier  TEXT NOT NULL DEFAULT '';
ALTER TABLE areas ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE areas ADD COLUMN archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));

-- The project's anchorage library: defined once, referenced by materials (and by plinths).
CREATE TABLE anchorage_types (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id),
  code        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  seq         INTEGER NOT NULL,
  UNIQUE (project_id, code)
);
ALTER TABLE plinths ADD COLUMN anchorage_type_id TEXT REFERENCES anchorage_types (id);

-- Fleet assets are vehicles or equipment.
ALTER TABLE vehicles ADD COLUMN kind TEXT NOT NULL DEFAULT 'vehicle' CHECK (kind IN ('vehicle','equipment'));

UPDATE schema_info SET value = '7' WHERE key = 'schema_version';
