-- The schema after every migration in apps/api/migrations, applied to an empty database (spec 030 REQ-DB-004).
-- Generated: do not edit. `pnpm schema:snapshot` rewrites it; `cargo test -p api --test migrations_test` fails while it is stale.

CREATE TABLE access_tokens (
    digest BLOB PRIMARY KEY CHECK (length(digest) = 32),
    session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX access_tokens_by_expiry ON access_tokens (expires_at);

CREATE INDEX access_tokens_by_session ON access_tokens (session_id);

CREATE TABLE device_registrations (
    installation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id INTEGER NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
    push_token TEXT NOT NULL UNIQUE,
    locale TEXT NOT NULL,
    app_version TEXT NOT NULL,
    marketing INTEGER NOT NULL CHECK (marketing IN (0, 1)),
    refreshed_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX device_registrations_by_refresh ON device_registrations (refreshed_at);

CREATE INDEX device_registrations_by_session ON device_registrations (session_id);

CREATE INDEX device_registrations_by_user ON device_registrations (user_id);

CREATE TABLE refresh_tokens (
    digest BLOB PRIMARY KEY CHECK (length(digest) = 32),
    session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    spent INTEGER NOT NULL DEFAULT 0 CHECK (spent IN (0, 1))
) WITHOUT ROWID;

CREATE INDEX refresh_tokens_by_expiry ON refresh_tokens (expires_at);

CREATE INDEX refresh_tokens_by_session ON refresh_tokens (session_id);

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('citizen_voter', 'election_auditor')),
    transport TEXT NOT NULL CHECK (transport IN ('cookie', 'body'))
);

CREATE INDEX sessions_by_user ON sessions (user_id);
