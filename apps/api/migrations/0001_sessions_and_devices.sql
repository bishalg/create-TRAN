-- Sessions, their token digests and device registrations (spec 030, ADR-0049).
-- Tokens are kept as SHA-256 digests only (REQ-SEC-006). Times are Unix microseconds, UTC.
-- Every column is listed with its purpose and retention in docs/PERSISTENCE.md.

-- One sign-in (one token family). Ids are never reused (AUTOINCREMENT): a device registration may
-- outlive an expired session until it goes stale, and must never match a newer session.
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('citizen_voter', 'election_auditor')),
    transport TEXT NOT NULL CHECK (transport IN ('cookie', 'body'))
);

CREATE INDEX sessions_by_user ON sessions (user_id);

CREATE TABLE access_tokens (
    digest BLOB PRIMARY KEY CHECK (length(digest) = 32),
    session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX access_tokens_by_session ON access_tokens (session_id);

CREATE INDEX access_tokens_by_expiry ON access_tokens (expires_at);

-- A refresh token is spent once; presenting a spent one ends its session (REQ-SEC-010).
CREATE TABLE refresh_tokens (
    digest BLOB PRIMARY KEY CHECK (length(digest) = 32),
    session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    spent INTEGER NOT NULL DEFAULT 0 CHECK (spent IN (0, 1))
) WITHOUT ROWID;

CREATE INDEX refresh_tokens_by_session ON refresh_tokens (session_id);

CREATE INDEX refresh_tokens_by_expiry ON refresh_tokens (expires_at);

-- One installation's push registration (spec 027). The unique token is what moves a token to its
-- newest owner (REQ-PSH-002). No foreign key to sessions: revoking a session removes its
-- registrations in the same transaction, while one whose session merely expired stays until it is
-- stale (REQ-PSH-005).
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

CREATE INDEX device_registrations_by_user ON device_registrations (user_id);

CREATE INDEX device_registrations_by_session ON device_registrations (session_id);

CREATE INDEX device_registrations_by_refresh ON device_registrations (refreshed_at);
