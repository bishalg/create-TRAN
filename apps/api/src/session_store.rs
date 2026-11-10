//! Where sessions are remembered (REQ-SEC-006, REQ-SEC-009, REQ-SEC-010, ADR-0039).
//!
//! The store sees only SHA-256 digests of tokens, never a token, so a leaked store cannot be
//! replayed against the API. [`crate::db::SqlSessionStore`] is the one implementation (ADR-0049);
//! a fork that moves to another database keeps this trait and its guarantees:
//!
//! - [`SessionStore::rotate`] is one transaction, and the database decides which of two concurrent
//!   rotations of one token wins (REQ-DB-006, REQ-DB-007).
//! - Ending a session ([`SessionStore::revoke`], a replay in [`SessionStore::rotate`],
//!   [`SessionStore::revoke_user`]) removes the session, its tokens and the device registrations
//!   made in it in the same transaction (REQ-PSH-003). Account deletion forgets the user's
//!   sessions instead of marking them (REQ-ACC-002).
//! - A failure answers [`StoreError`], never SQL text.

use chrono::{DateTime, Utc};
use rust_core::UserRole;

pub use crate::db::StoreError;

/// SHA-256 of a token.
pub type TokenDigest = [u8; 32];

/// One sign-in (one token family), named by the store. Never sent to a client or logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SessionId(pub i64);

/// A session behind a live access token, with its id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveSession {
    pub id: SessionId,
    pub session: StoredSession,
}

/// Who a session belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionUser {
    pub user_id: String,
    pub role: UserRole,
}

/// How the refresh token travels; fixed for the life of a session (REQ-SEC-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// An `HttpOnly` cookie, for the browser.
    Cookie,
    /// The JSON body, for native apps that keep it in their vault.
    Body,
}

/// What the store remembers about one sign-in (one token family).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSession {
    pub user: SessionUser,
    pub transport: Transport,
}

/// The digests and expiry instants of one freshly minted token pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PairDigests {
    pub access: TokenDigest,
    pub access_expires_at: DateTime<Utc>,
    pub refresh: TokenDigest,
    pub refresh_expires_at: DateTime<Utc>,
}

/// The outcome of presenting a refresh token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rotation {
    /// The token was live: it is now spent and the new pair belongs to the same session.
    Rotated(StoredSession),
    /// Never issued, or its session was revoked.
    Unknown,
    /// Issued but past its lifetime.
    Expired,
    /// Already rotated once: the whole session, named here, is now revoked (REQ-SEC-010).
    Replayed(SessionId),
}

/// What one prune of the session tables removed (REQ-DB-009).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SessionsPruned {
    /// Sessions past their refresh lifetime.
    pub sessions: usize,
    /// Access and refresh token digests past their expiry, spent or not.
    pub tokens: usize,
}

pub trait SessionStore: Send + Sync {
    /// Starts a new session with its first pair.
    fn start(&self, session: StoredSession, pair: PairDigests) -> Result<SessionId, StoreError>;

    /// The session of a live access token: issued, unexpired at `now`, session not revoked.
    fn session_for_access(
        &self,
        access: &TokenDigest,
        now: DateTime<Utc>,
    ) -> Result<Option<LiveSession>, StoreError>;

    /// In one transaction, spends `refresh` and attaches `next` to its session, or says why not.
    /// Presenting a spent token ends the session with its device registrations.
    fn rotate(
        &self,
        refresh: &TokenDigest,
        next: PairDigests,
        now: DateTime<Utc>,
    ) -> Result<Rotation, StoreError>;

    /// Ends the session a refresh token (spent or not) belongs to, with its device registrations,
    /// and names it; unknown tokens are ignored.
    fn revoke(&self, refresh: &TokenDigest) -> Result<Option<SessionId>, StoreError>;

    /// Removes every session of `user_id`, on every device and either transport, with all their
    /// tokens and every device registration of the user, so nothing of the user remains
    /// (REQ-ACC-002, REQ-ACC-003, REQ-PSH-003). Other users keep theirs.
    fn revoke_user(&self, user_id: &str) -> Result<(), StoreError>;

    /// Deletes token digests past their expiry at `now`, then sessions left with no refresh token:
    /// those past their refresh lifetime (REQ-DB-009).
    fn prune(&self, now: DateTime<Utc>) -> Result<SessionsPruned, StoreError>;
}
