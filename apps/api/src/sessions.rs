//! Issuing, checking, rotating and revoking sessions (REQ-SEC-006 to REQ-SEC-011, ADR-0039), and
//! ending all of a user's at once when the account is deleted (REQ-ACC-002).
//!
//! [`Sessions`] composes the [`SessionStore`] and the [`DeviceStore`] (REQ-PSH-003, ADR-0044). The
//! stores keep the tie between a session and its device registrations inside their transactions
//! (ADR-0049): ending a session removes its registrations, and a registration is written only while
//! its session is live.
//!
//! Its methods are synchronous and never log, so they can run off the async executor: request code
//! calls them through [`Sessions::blocking`] (REQ-DB-008) and logs what they answer.
//!
//! Tokens are [`SESSION_POLICY`]`.token_bytes` bytes from the operating system's CSPRNG, encoded
//! as unpadded base64url, and held as [`Secret`]s. Only their SHA-256 digests reach the
//! [`SessionStore`]. Expiry is measured on the injected [`Clock`] (ADR-0004).

use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Duration;
use rust_core::push::DEVICE_POLICY;
use rust_core::session::SESSION_POLICY;
use sha2::{Digest, Sha256};

use crate::clock::{Clock, SystemClock};
use crate::db::prune::PruneReport;
use crate::db::{off_runtime, Database, SqlDeviceStore, SqlSessionStore};
use crate::devices::{DeviceStore, Registration};
use crate::secret::Secret;
use crate::session_store::{
    LiveSession, PairDigests, Rotation, SessionStore, StoreError, StoredSession, TokenDigest,
};

/// A freshly issued pair, for the response that hands it to the client.
#[derive(Debug)]
pub struct IssuedTokens {
    pub access: Secret,
    pub refresh: Secret,
}

#[derive(Clone)]
pub struct Sessions {
    store: Arc<dyn SessionStore>,
    devices: Arc<dyn DeviceStore>,
    clock: Arc<dyn Clock>,
}

impl Sessions {
    pub fn new(
        store: Arc<dyn SessionStore>,
        devices: Arc<dyn DeviceStore>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            store,
            devices,
            clock,
        }
    }

    /// Sessions and devices in `db`, on `clock`: what the server and every test run.
    pub fn sql(db: Database, clock: Arc<dyn Clock>) -> Self {
        Self::new(
            Arc::new(SqlSessionStore::new(db.clone())),
            Arc::new(SqlDeviceStore::new(db)),
            clock,
        )
    }

    /// A fresh in-memory database on the real clock ([`crate::state::AppState::new`]).
    pub fn in_memory() -> Self {
        Self::sql(Database::in_memory(), Arc::new(SystemClock))
    }

    /// The device registry, for the routes and the push sender (ADR-0044).
    pub fn devices(&self) -> &Arc<dyn DeviceStore> {
        &self.devices
    }

    /// The clock sessions and registrations are measured on.
    pub fn clock(&self) -> &Arc<dyn Clock> {
        &self.clock
    }

    /// Runs `work` with these sessions on the blocking pool ([`off_runtime`]): how async code
    /// calls every method below, so a store call never stalls the request runtime.
    pub async fn blocking<T, E>(
        &self,
        work: impl FnOnce(&Sessions) -> Result<T, E> + Send + 'static,
    ) -> Result<T, E>
    where
        T: Send + 'static,
        E: From<StoreError> + Send + 'static,
    {
        let sessions = self.clone();
        off_runtime(move || work(&sessions)).await
    }

    /// Starts a session and returns its first pair.
    pub fn sign_in(&self, session: StoredSession) -> Result<IssuedTokens, StoreError> {
        let (tokens, digests) = self.mint_pair();
        self.store.start(session, digests)?;
        Ok(tokens)
    }

    /// The session behind a live access token.
    pub fn authenticate(&self, access: &str) -> Result<Option<LiveSession>, StoreError> {
        self.store
            .session_for_access(&digest(access), self.clock.now())
    }

    /// Spends `refresh` for a new pair. A replay ends the session, with its device registrations;
    /// the caller logs it.
    pub fn refresh(
        &self,
        refresh: &str,
    ) -> Result<Result<(StoredSession, IssuedTokens), Rotation>, StoreError> {
        let (tokens, digests) = self.mint_pair();
        Ok(
            match self
                .store
                .rotate(&digest(refresh), digests, self.clock.now())?
            {
                Rotation::Rotated(session) => Ok((session, tokens)),
                refused => Err(refused),
            },
        )
    }

    /// Ends the session of `refresh`, if there is one, with its device registrations.
    pub fn sign_out(&self, refresh: &str) -> Result<(), StoreError> {
        self.store.revoke(&digest(refresh)).map(drop)
    }

    /// Ends every session of `user_id` on every device (REQ-ACC-002) and removes every device
    /// registration of the user (REQ-PSH-003), in one transaction.
    pub fn revoke_user(&self, user_id: &str) -> Result<(), StoreError> {
        self.store.revoke_user(user_id)
    }

    /// Stores `registration`, made in its `session` (REQ-PSH-001, REQ-PSH-002), and returns how
    /// many registrations of the same token it displaced. A session that ended before the write
    /// lands keeps nothing: the store writes only while the session is live.
    pub fn register_device(&self, registration: Registration) -> Result<usize, StoreError> {
        self.devices.register(registration)
    }

    /// Deletes expired token digests, sessions past their refresh lifetime and device
    /// registrations not refreshed for `DEVICE_POLICY.stale_after_days`, on this clock
    /// (REQ-DB-009, REQ-PSH-005).
    pub fn prune(&self) -> Result<PruneReport, StoreError> {
        let now = self.clock.now();
        let pruned = self.store.prune(now)?;
        let stale = now - Duration::seconds(DEVICE_POLICY.stale_after_seconds());
        Ok(PruneReport {
            sessions: pruned.sessions,
            tokens: pruned.tokens,
            devices: self.devices.prune(stale)?,
        })
    }

    fn mint_pair(&self) -> (IssuedTokens, PairDigests) {
        let now = self.clock.now();
        let lifetime = |seconds: u64| Duration::seconds(i64::try_from(seconds).unwrap_or(i64::MAX));
        let tokens = IssuedTokens {
            access: mint_token(),
            refresh: mint_token(),
        };
        let digests = PairDigests {
            access: digest(tokens.access.expose()),
            access_expires_at: now + lifetime(SESSION_POLICY.access_ttl_seconds),
            refresh: digest(tokens.refresh.expose()),
            refresh_expires_at: now + lifetime(SESSION_POLICY.refresh_ttl_seconds),
        };
        (tokens, digests)
    }
}

/// A new random token: `token_bytes` from the OS CSPRNG, unpadded base64url.
pub fn mint_token() -> Secret {
    let mut bytes = vec![0u8; SESSION_POLICY.token_bytes];
    #[allow(
        clippy::expect_used,
        reason = "without the OS random source no token can be safe; the request fails with 500"
    )]
    getrandom::fill(&mut bytes).expect("the operating system's random source is available");
    Secret::new(URL_SAFE_NO_PAD.encode(bytes))
}

/// SHA-256 of a token: what the store keeps and looks up.
pub fn digest(token: &str) -> TokenDigest {
    Sha256::digest(token.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // Verifies: REQ-SEC-006
    #[test]
    fn tokens_are_unpadded_base64url_of_the_policy_size_and_never_repeat() {
        let tokens: HashSet<String> = (0..64).map(|_| mint_token().expose().to_string()).collect();
        assert_eq!(tokens.len(), 64);
        for token in &tokens {
            let bytes = URL_SAFE_NO_PAD.decode(token).unwrap();
            assert_eq!(bytes.len(), SESSION_POLICY.token_bytes);
            assert!(!token.contains('=') && !token.contains('+') && !token.contains('/'));
        }
    }

    // Verifies: REQ-PSH-003 — a registration written for a session revoked meanwhile is never
    // kept, so it never outlives the session.
    #[test]
    fn a_registration_never_outlives_a_session_revoked_before_it_landed() {
        use crate::db::tests::registration;
        use crate::session_store::{SessionUser, Transport};
        use rust_core::UserRole;

        let sessions = Sessions::in_memory();
        let session = StoredSession {
            user: SessionUser {
                user_id: "voter-001".into(),
                role: UserRole::CitizenVoter,
            },
            transport: Transport::Body,
        };
        let live_tokens = sessions.sign_in(session.clone()).unwrap();
        let live = sessions
            .authenticate(live_tokens.access.expose())
            .unwrap()
            .unwrap();
        let ended_tokens = sessions.sign_in(session).unwrap();
        let ended = sessions
            .authenticate(ended_tokens.access.expose())
            .unwrap()
            .unwrap();
        sessions.sign_out(ended_tokens.refresh.expose()).unwrap();

        assert_eq!(
            sessions.register_device(registration(1, "voter-001", ended.id, 'a')),
            Ok(0)
        );
        assert!(sessions.devices().for_user("voter-001").unwrap().is_empty());
        assert_eq!(
            sessions.register_device(registration(2, "voter-001", live.id, 'a')),
            Ok(0)
        );
        assert_eq!(sessions.devices().for_user("voter-001").unwrap().len(), 1);
    }

    // Verifies: REQ-SEC-006
    #[test]
    fn the_digest_is_sha256() {
        // SHA-256("abc"), FIPS 180-2 test vector.
        let abc = digest("abc");
        assert_eq!(abc[..4], [0xba, 0x78, 0x16, 0xbf]);
        assert_eq!(abc[28..], [0xf2, 0x00, 0x15, 0xad]);
    }
}
