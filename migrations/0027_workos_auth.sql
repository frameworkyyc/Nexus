-- WorkOS AuthKit sign-in. Additive: nothing is dropped or rewritten, and the Cloudflare Access sign-in keeps working until it is switched off in configuration.
--  * user_roles: the WorkOS user a member signed in as (bound at first sign-in, so a reused email address can never take over a membership), and what is known about
--    their WorkOS invitation (id, when it was sent and expires, and whether WorkOS was asked to email it).
--  * auth_sessions: Nexus's own server-side sessions. The cookie holds a random token; only an HMAC of it is stored here. Revoking a member deletes their access at once.
ALTER TABLE user_roles ADD COLUMN workos_user_id TEXT;
ALTER TABLE user_roles ADD COLUMN workos_invitation_id TEXT;
ALTER TABLE user_roles ADD COLUMN invitation_sent_at TEXT;
ALTER TABLE user_roles ADD COLUMN invitation_expires_at TEXT;
ALTER TABLE user_roles ADD COLUMN invitation_delivery TEXT CHECK (invitation_delivery IN ('sent','failed','existing_user','not_configured'));

CREATE TABLE auth_sessions (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  workos_user_id    TEXT NOT NULL,
  workos_session_id TEXT NOT NULL,
  auth_method       TEXT,
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  revoke_reason     TEXT
);
CREATE INDEX auth_sessions_email ON auth_sessions (email);

UPDATE schema_info SET value = '27' WHERE key = 'schema_version';
