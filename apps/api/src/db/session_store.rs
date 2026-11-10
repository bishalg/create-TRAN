//! [`SessionStore`] on SQL (REQ-DB-001, REQ-DB-006, REQ-DB-007).
//!
//! Tables `sessions`, `access_tokens` and `refresh_tokens` (`apps/api/schema.sql`). A rotation is
//! decided by one `UPDATE … WHERE spent = 0` and the row it returns, not by a check in Rust, so of
//! two rotations of one token exactly one spends it; the other finds it spent and is a replay.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction};
use rust_core::UserRole;

use super::{decode, micros, Database};
use crate::session_store::{
    LiveSession, PairDigests, Rotation, SessionId, SessionStore, SessionUser, SessionsPruned,
    StoreError, StoredSession, TokenDigest, Transport,
};

const ROLES: &[(&str, UserRole)] = &[
    ("citizen_voter", UserRole::CitizenVoter),
    ("election_auditor", UserRole::ElectionAuditor),
];

const TRANSPORTS: &[(&str, Transport)] =
    &[("cookie", Transport::Cookie), ("body", Transport::Body)];

/// The session store on `db`.
#[derive(Debug, Clone)]
pub struct SqlSessionStore {
    db: Database,
}

impl SqlSessionStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }
}

fn name_of<T: Copy + PartialEq>(value: T, options: &[(&'static str, T)]) -> &'static str {
    options
        .iter()
        .find(|(_, option)| *option == value)
        .map_or("", |(name, _)| name)
}

/// A session from its stored columns; a role or transport the API never writes is a broken row.
fn stored(user_id: String, role: &str, transport: &str) -> rusqlite::Result<StoredSession> {
    decode(role, ROLES).and_then(|role| {
        decode(transport, TRANSPORTS).map(|transport| StoredSession {
            user: SessionUser { user_id, role },
            transport,
        })
    })
}

fn session_of(connection: &Connection, id: i64) -> rusqlite::Result<StoredSession> {
    connection
        .query_row(
            "SELECT user_id, role, transport FROM sessions WHERE id = ?1",
            [id],
            |row| <(String, String, String)>::try_from(row),
        )
        .and_then(|(user_id, role, transport)| stored(user_id, &role, &transport))
}

/// Adds `pair` to session `id`.
fn attach(transaction: &Transaction<'_>, id: i64, pair: &PairDigests) -> rusqlite::Result<()> {
    transaction
        .execute(
            "INSERT INTO access_tokens (digest, session_id, expires_at) VALUES (?1, ?2, ?3)",
            (&pair.access[..], id, micros(pair.access_expires_at)),
        )
        .and_then(|_| {
            transaction.execute(
                "INSERT INTO refresh_tokens (digest, session_id, expires_at) VALUES (?1, ?2, ?3)",
                (&pair.refresh[..], id, micros(pair.refresh_expires_at)),
            )
        })
        .map(drop)
}

/// Ends session `id` inside `transaction`: its device registrations, then the session, whose
/// tokens go with it (`ON DELETE CASCADE`) (REQ-PSH-003, REQ-DB-006).
fn end_session(transaction: &Transaction<'_>, id: i64) -> rusqlite::Result<()> {
    transaction
        .execute(
            "DELETE FROM device_registrations WHERE session_id = ?1",
            [id],
        )
        .and_then(|_| transaction.execute("DELETE FROM sessions WHERE id = ?1", [id]))
        .map(drop)
}

impl SessionStore for SqlSessionStore {
    fn start(&self, session: StoredSession, pair: PairDigests) -> Result<SessionId, StoreError> {
        self.db.write(|transaction| {
            transaction
                .query_row(
                    "INSERT INTO sessions (user_id, role, transport) VALUES (?1, ?2, ?3) \
                     RETURNING id",
                    (
                        &session.user.user_id,
                        name_of(session.user.role, ROLES),
                        name_of(session.transport, TRANSPORTS),
                    ),
                    |row| row.get::<_, i64>(0),
                )
                .and_then(|id| attach(transaction, id, &pair).map(|()| SessionId(id)))
        })
    }

    fn session_for_access(
        &self,
        access: &TokenDigest,
        now: DateTime<Utc>,
    ) -> Result<Option<LiveSession>, StoreError> {
        self.db.read(|connection| {
            connection
                .query_row(
                    "SELECT s.id, s.user_id, s.role, s.transport FROM access_tokens a \
                     JOIN sessions s ON s.id = a.session_id \
                     WHERE a.digest = ?1 AND a.expires_at > ?2",
                    (&access[..], micros(now)),
                    |row| <(i64, String, String, String)>::try_from(row),
                )
                .optional()
                .and_then(|found| {
                    found
                        .map(|(id, user_id, role, transport)| {
                            stored(user_id, &role, &transport).map(|session| LiveSession {
                                id: SessionId(id),
                                session,
                            })
                        })
                        .transpose()
                })
        })
    }

    fn rotate(
        &self,
        refresh: &TokenDigest,
        next: PairDigests,
        now: DateTime<Utc>,
    ) -> Result<Rotation, StoreError> {
        self.db.write(|transaction| {
            transaction
                .query_row(
                    "UPDATE refresh_tokens SET spent = 1 \
                     WHERE digest = ?1 AND spent = 0 AND expires_at > ?2 RETURNING session_id",
                    (&refresh[..], micros(now)),
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .and_then(|spent| match spent {
                    Some(id) => attach(transaction, id, &next)
                        .and_then(|()| session_of(transaction, id))
                        .map(Rotation::Rotated),
                    None => refused(transaction, refresh),
                })
        })
    }

    fn revoke(&self, refresh: &TokenDigest) -> Result<Option<SessionId>, StoreError> {
        self.db.write(|transaction| {
            session_of_refresh(transaction, refresh).and_then(|found| match found {
                Some((id, _)) => end_session(transaction, id).map(|()| Some(SessionId(id))),
                None => Ok(None),
            })
        })
    }

    fn revoke_user(&self, user_id: &str) -> Result<(), StoreError> {
        self.db.write(|transaction| {
            transaction
                .execute(
                    "DELETE FROM device_registrations WHERE user_id = ?1",
                    [user_id],
                )
                .and_then(|_| {
                    transaction.execute("DELETE FROM sessions WHERE user_id = ?1", [user_id])
                })
                .map(drop)
        })
    }

    fn prune(&self, now: DateTime<Utc>) -> Result<SessionsPruned, StoreError> {
        let at = micros(now);
        self.db.write(|transaction| {
            let expired = |table: &str| {
                transaction.execute(&format!("DELETE FROM {table} WHERE expires_at <= ?1"), [at])
            };
            expired("access_tokens").and_then(|access| {
                expired("refresh_tokens").and_then(|refresh| {
                    transaction
                        .execute(
                            "DELETE FROM sessions WHERE NOT EXISTS \
                             (SELECT 1 FROM refresh_tokens r WHERE r.session_id = sessions.id)",
                            [],
                        )
                        .map(|sessions| SessionsPruned {
                            sessions,
                            tokens: access + refresh,
                        })
                })
            })
        })
    }
}

/// The session a refresh token (spent or not) belongs to, and whether it is spent.
fn session_of_refresh(
    transaction: &Transaction<'_>,
    refresh: &TokenDigest,
) -> rusqlite::Result<Option<(i64, bool)>> {
    transaction
        .query_row(
            "SELECT session_id, spent FROM refresh_tokens WHERE digest = ?1",
            [&refresh[..]],
            |row| <(i64, bool)>::try_from(row),
        )
        .optional()
}

/// Why a refresh token that could not be spent was refused. A spent one is a replay: its session
/// ends, with its device registrations (REQ-SEC-010).
fn refused(transaction: &Transaction<'_>, refresh: &TokenDigest) -> rusqlite::Result<Rotation> {
    session_of_refresh(transaction, refresh).and_then(|found| match found {
        None => Ok(Rotation::Unknown),
        Some((_, false)) => Ok(Rotation::Expired),
        Some((id, true)) => {
            end_session(transaction, id).map(|()| Rotation::Replayed(SessionId(id)))
        }
    })
}

#[cfg(test)]
#[path = "session_store_tests.rs"]
mod tests;
