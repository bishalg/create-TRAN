//! Where sessions are remembered (REQ-SEC-006, REQ-SEC-009, REQ-SEC-010, ADR-0039).
//!
//! The store sees only SHA-256 digests of tokens, never a token, so a leaked store cannot be
//! replayed against the API. [`InMemorySessionStore`] is the sample's: it empties on restart and
//! never prunes. A fork replaces it with its database behind the same [`SessionStore`] trait,
//! keeping [`SessionStore::rotate`] atomic (one transaction), because two concurrent rotations of
//! the same token must not both succeed. [`SessionStore::revoke_user`] is what account deletion
//! calls (REQ-ACC-002): it forgets the user's sessions instead of marking them.
//!
//! Each session has a [`SessionId`], so what was made in it (a device registration, REQ-PSH-003)
//! can end with it: [`SessionStore::revoke`] and a replay in [`SessionStore::rotate`] name the
//! session they ended, and [`crate::sessions::Sessions`] removes its registrations in the same
//! call.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use chrono::{DateTime, Utc};
use rust_core::UserRole;

/// SHA-256 of a token.
pub type TokenDigest = [u8; 32];

/// One sign-in (one token family), named by the store. Never sent to a client or logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SessionId(pub u64);

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

pub trait SessionStore: Send + Sync {
    /// Starts a new session with its first pair.
    fn start(&self, session: StoredSession, pair: PairDigests) -> SessionId;

    /// The session of a live access token: issued, unexpired at `now`, session not revoked.
    fn session_for_access(&self, access: &TokenDigest, now: DateTime<Utc>) -> Option<LiveSession>;

    /// Whether the session exists and is not revoked; its tokens may still have expired.
    fn is_live(&self, id: SessionId) -> bool;

    /// Atomically spends `refresh` and attaches `next` to its session, or says why not. Presenting
    /// a spent token revokes the session.
    fn rotate(&self, refresh: &TokenDigest, next: PairDigests, now: DateTime<Utc>) -> Rotation;

    /// Revokes the session a refresh token (spent or not) belongs to and names it; unknown tokens
    /// are ignored.
    fn revoke(&self, refresh: &TokenDigest) -> Option<SessionId>;

    /// Removes every session of `user_id`, on every device and either transport, with all their
    /// tokens, so nothing of the user remains (REQ-ACC-002, REQ-ACC-003). Other users keep theirs.
    fn revoke_user(&self, user_id: &str);
}

#[derive(Debug, Default)]
pub struct InMemorySessionStore(Mutex<Tables>);

#[derive(Debug, Default)]
struct Tables {
    /// By family id; a removed family's grants are removed with it.
    families: HashMap<u64, Family>,
    next_family: u64,
    access: HashMap<TokenDigest, Grant>,
    refresh: HashMap<TokenDigest, Grant>,
}

#[derive(Debug)]
struct Family {
    session: StoredSession,
    revoked: bool,
}

#[derive(Debug)]
struct Grant {
    family: u64,
    expires_at: DateTime<Utc>,
    spent: bool,
}

impl Tables {
    fn attach(&mut self, family: u64, pair: PairDigests) {
        let grant = |expires_at| Grant {
            family,
            expires_at,
            spent: false,
        };
        self.access
            .insert(pair.access, grant(pair.access_expires_at));
        self.refresh
            .insert(pair.refresh, grant(pair.refresh_expires_at));
    }
}

impl InMemorySessionStore {
    fn tables(&self) -> std::sync::MutexGuard<'_, Tables> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl SessionStore for InMemorySessionStore {
    fn start(&self, session: StoredSession, pair: PairDigests) -> SessionId {
        let mut tables = self.tables();
        let family = tables.next_family;
        tables.next_family += 1;
        tables.families.insert(
            family,
            Family {
                session,
                revoked: false,
            },
        );
        tables.attach(family, pair);
        SessionId(family)
    }

    fn session_for_access(&self, access: &TokenDigest, now: DateTime<Utc>) -> Option<LiveSession> {
        let tables = self.tables();
        let grant = tables.access.get(access).filter(|g| now < g.expires_at)?;
        let family = &tables.families[&grant.family];
        (!family.revoked).then(|| LiveSession {
            id: SessionId(grant.family),
            session: family.session.clone(),
        })
    }

    fn is_live(&self, id: SessionId) -> bool {
        self.tables()
            .families
            .get(&id.0)
            .is_some_and(|family| !family.revoked)
    }

    fn rotate(&self, refresh: &TokenDigest, next: PairDigests, now: DateTime<Utc>) -> Rotation {
        let mut tables = self.tables();
        let Tables {
            families,
            refresh: refresh_grants,
            ..
        } = &mut *tables;
        let Some(grant) = refresh_grants.get_mut(refresh) else {
            return Rotation::Unknown;
        };
        let Some(family) = families.get_mut(&grant.family).filter(|f| !f.revoked) else {
            return Rotation::Unknown;
        };
        if grant.spent {
            family.revoked = true;
            return Rotation::Replayed(SessionId(grant.family));
        }
        if now >= grant.expires_at {
            return Rotation::Expired;
        }
        grant.spent = true;
        let (id, session) = (grant.family, family.session.clone());
        tables.attach(id, next);
        Rotation::Rotated(session)
    }

    fn revoke(&self, refresh: &TokenDigest) -> Option<SessionId> {
        let mut tables = self.tables();
        let Tables {
            families,
            refresh: refresh_grants,
            ..
        } = &mut *tables;
        let id = refresh_grants.get(refresh)?.family;
        // A grant's family is removed only with the grant (`revoke_user`), so it is here.
        families
            .entry(id)
            .and_modify(|family| family.revoked = true);
        Some(SessionId(id))
    }

    fn revoke_user(&self, user_id: &str) {
        let mut tables = self.tables();
        let Tables {
            families,
            access,
            refresh,
            ..
        } = &mut *tables;
        families.retain(|_, family| family.session.user.user_id != user_id);
        access.retain(|_, grant| families.contains_key(&grant.family));
        refresh.retain(|_, grant| families.contains_key(&grant.family));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn t(seconds: i64) -> DateTime<Utc> {
        DateTime::<Utc>::UNIX_EPOCH + Duration::seconds(seconds)
    }

    fn pair(n: u8) -> PairDigests {
        PairDigests {
            access: [n; 32],
            access_expires_at: t(900),
            refresh: [n + 100; 32],
            refresh_expires_at: t(2_000),
        }
    }

    fn session() -> StoredSession {
        StoredSession {
            user: SessionUser {
                user_id: "voter-001".into(),
                role: UserRole::CitizenVoter,
            },
            transport: Transport::Body,
        }
    }

    /// The session behind an access digest, without its id.
    trait Who {
        fn who(&self, access: &TokenDigest, now: DateTime<Utc>) -> Option<StoredSession>;
    }

    impl Who for InMemorySessionStore {
        fn who(&self, access: &TokenDigest, now: DateTime<Utc>) -> Option<StoredSession> {
            self.session_for_access(access, now)
                .map(|live| live.session)
        }
    }

    fn started() -> InMemorySessionStore {
        let store = InMemorySessionStore::default();
        store.start(session(), pair(1));
        store
    }

    // Verifies: REQ-SEC-006 REQ-SEC-008
    #[test]
    fn an_access_digest_is_live_until_it_expires() {
        let store = started();
        assert_eq!(store.who(&[1; 32], t(899)), Some(session()));
        assert_eq!(store.who(&[1; 32], t(900)), None);
        assert_eq!(store.who(&[9; 32], t(0)), None);
    }

    // Verifies: REQ-SEC-006 REQ-PSH-003
    #[test]
    fn each_session_has_its_own_id_and_revoking_names_it() {
        let store = InMemorySessionStore::default();
        let first = store.start(session(), pair(1));
        let second = store.start(session(), pair(2));
        assert_ne!(first, second);
        let live = store.session_for_access(&[2; 32], t(1)).unwrap();
        assert_eq!((live.id, live.session), (second, session()));
        assert!(store.is_live(first) && store.is_live(second));
        assert_eq!(store.revoke(&[101; 32]), Some(first));
        assert!(!store.is_live(first) && store.is_live(second));
        assert_eq!(store.revoke(&[42; 32]), None);
        assert!(!store.is_live(SessionId(99)));
        store.revoke_user("voter-001");
        assert!(!store.is_live(second));
    }

    // Verifies: REQ-SEC-009
    #[test]
    fn rotation_spends_the_token_and_keeps_the_session() {
        let store = started();
        assert_eq!(
            store.rotate(&[101; 32], pair(2), t(10)),
            Rotation::Rotated(session())
        );
        assert_eq!(store.who(&[2; 32], t(10)), Some(session()));
        // The old access token stays valid until it expires; only its refresh token is spent.
        assert_eq!(store.who(&[1; 32], t(10)), Some(session()));
        assert_eq!(
            store.rotate(&[102; 32], pair(3), t(20)),
            Rotation::Rotated(session())
        );
    }

    // Verifies: REQ-SEC-009
    #[test]
    fn unknown_and_expired_refresh_tokens_are_refused() {
        let store = started();
        assert_eq!(store.rotate(&[7; 32], pair(2), t(0)), Rotation::Unknown);
        assert_eq!(
            store.rotate(&[101; 32], pair(2), t(2_000)),
            Rotation::Expired
        );
    }

    // Verifies: REQ-SEC-010
    #[test]
    fn a_replayed_refresh_token_revokes_the_whole_family() {
        let store = started();
        store.rotate(&[101; 32], pair(2), t(10));
        assert_eq!(
            store.rotate(&[101; 32], pair(3), t(11)),
            Rotation::Replayed(SessionId(0))
        );
        assert_eq!(store.who(&[1; 32], t(12)), None);
        assert_eq!(store.who(&[2; 32], t(12)), None);
        assert_eq!(store.rotate(&[102; 32], pair(4), t(12)), Rotation::Unknown);
    }

    // Verifies: REQ-SEC-011
    #[test]
    fn revoking_ends_the_family_and_ignores_unknown_tokens() {
        let store = started();
        let other = StoredSession {
            transport: Transport::Cookie,
            ..session()
        };
        store.start(other.clone(), pair(5));
        store.revoke(&[42; 32]);
        store.revoke(&[101; 32]);
        assert_eq!(store.who(&[1; 32], t(1)), None);
        assert_eq!(store.rotate(&[101; 32], pair(2), t(1)), Rotation::Unknown);
        assert_eq!(store.who(&[5; 32], t(1)), Some(other));
    }

    fn user(user_id: &str, transport: Transport) -> StoredSession {
        StoredSession {
            user: SessionUser {
                user_id: user_id.into(),
                role: UserRole::CitizenVoter,
            },
            transport,
        }
    }

    // Verifies: REQ-ACC-002
    #[test]
    fn revoking_a_user_ends_every_session_of_that_user_only() {
        let store = started();
        store.start(user("voter-001", Transport::Cookie), pair(2));
        store.rotate(&[102; 32], pair(3), t(1));
        let other = user("auditor-001", Transport::Body);
        store.start(other.clone(), pair(4));

        store.revoke_user("voter-001");
        for access in [[1; 32], [2; 32], [3; 32]] {
            assert_eq!(store.who(&access, t(2)), None);
        }
        for refresh in [[101; 32], [102; 32], [103; 32]] {
            assert_eq!(store.rotate(&refresh, pair(9), t(2)), Rotation::Unknown);
        }
        assert_eq!(store.who(&[4; 32], t(2)), Some(other.clone()));
        assert_eq!(
            store.rotate(&[104; 32], pair(5), t(2)),
            Rotation::Rotated(other)
        );
        store.revoke_user("nobody");
        store.revoke(&[101; 32]);
    }

    // Verifies: REQ-ACC-003
    #[test]
    fn revoking_a_user_leaves_no_record_of_them() {
        let store = started();
        store.start(user("voter-001", Transport::Cookie), pair(2));
        store.start(user("auditor-001", Transport::Body), pair(4));

        store.revoke_user("voter-001");
        let tables = store.tables();
        assert!(tables
            .families
            .values()
            .all(|family| family.session.user.user_id == "auditor-001"));
        assert_eq!(tables.families.len(), 1);
        assert_eq!((tables.access.len(), tables.refresh.len()), (1, 1));
    }
}
