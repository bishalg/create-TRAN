//! Issuing, checking, rotating and revoking sessions (REQ-SEC-006 to REQ-SEC-011, ADR-0039), and
//! ending all of a user's at once when the account is deleted (REQ-ACC-002).
//!
//! [`Sessions`] also owns the device registry's tie to the session (REQ-PSH-003, ADR-0044): every
//! path that ends a session (sign-out, a replayed refresh token, [`Sessions::revoke_user`]) removes
//! the registrations made in it in the same call, and [`Sessions::register_device`] never leaves a
//! registration behind a session that ended meanwhile. The guarantee lives here, above both
//! stores, so a fork that replaces either store keeps it.
//!
//! Tokens are [`SESSION_POLICY`]`.token_bytes` bytes from the operating system's CSPRNG, encoded
//! as unpadded base64url, and held as [`Secret`]s. Only their SHA-256 digests reach the
//! [`SessionStore`]. Expiry is measured on the injected [`Clock`] (ADR-0004).

use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Duration;
use rust_core::session::SESSION_POLICY;
use sha2::{Digest, Sha256};

use crate::clock::{Clock, SystemClock};
use crate::device_store::InMemoryDeviceStore;
use crate::devices::{DeviceStore, Registration};
use crate::secret::Secret;
use crate::session_store::{
    InMemorySessionStore, LiveSession, PairDigests, Rotation, SessionStore, StoredSession,
    TokenDigest,
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

    /// The sample's setup: sessions and devices in memory, on the real clock.
    pub fn in_memory() -> Self {
        Self::new(
            Arc::new(InMemorySessionStore::default()),
            Arc::new(InMemoryDeviceStore::default()),
            Arc::new(SystemClock),
        )
    }

    /// The device registry, for the routes and the push sender (ADR-0044).
    pub fn devices(&self) -> &Arc<dyn DeviceStore> {
        &self.devices
    }

    /// The clock sessions and registrations are measured on.
    pub fn clock(&self) -> &Arc<dyn Clock> {
        &self.clock
    }

    /// Starts a session and returns its first pair.
    pub fn sign_in(&self, session: StoredSession) -> IssuedTokens {
        let (tokens, digests) = self.mint_pair();
        self.store.start(session, digests);
        tokens
    }

    /// The session behind a live access token.
    pub fn authenticate(&self, access: &str) -> Option<LiveSession> {
        self.store
            .session_for_access(&digest(access), self.clock.now())
    }

    /// Spends `refresh` for a new pair. A replay revokes the session, with its device
    /// registrations, and is logged once.
    pub fn refresh(&self, refresh: &str) -> Result<(StoredSession, IssuedTokens), Rotation> {
        let (tokens, digests) = self.mint_pair();
        match self
            .store
            .rotate(&digest(refresh), digests, self.clock.now())
        {
            Rotation::Rotated(session) => Ok((session, tokens)),
            Rotation::Replayed(id) => {
                self.devices.remove_session(id);
                tracing::warn!("refresh token replayed; session revoked");
                Err(Rotation::Replayed(id))
            }
            refused => Err(refused),
        }
    }

    /// Revokes the session of `refresh`, if there is one, with its device registrations.
    pub fn sign_out(&self, refresh: &str) {
        if let Some(id) = self.store.revoke(&digest(refresh)) {
            self.devices.remove_session(id);
        }
    }

    /// Ends every session of `user_id` on every device (REQ-ACC-002) and removes every device
    /// registration of the user (REQ-PSH-003).
    pub fn revoke_user(&self, user_id: &str) {
        self.store.revoke_user(user_id);
        self.devices.remove_user(user_id);
    }

    /// Stores `registration`, made in its `session` (REQ-PSH-001, REQ-PSH-002), and returns how
    /// many registrations of the same token it displaced.
    ///
    /// A session revoked between the caller's authentication and this write would otherwise keep
    /// a registration nobody removes: the check after the write closes that gap without a lock
    /// across both stores, because revoking marks the session before it removes registrations.
    pub fn register_device(&self, registration: Registration) -> usize {
        let session = registration.session;
        let displaced = self.devices.register(registration);
        if !self.store.is_live(session) {
            self.devices.remove_session(session);
        }
        displaced
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

    // Verifies: REQ-PSH-003 — a registration written for a session revoked meanwhile is removed
    // by the write itself, so it never outlives the session.
    #[test]
    fn a_registration_never_outlives_a_session_revoked_before_it_landed() {
        use crate::device_store::tests::registration;
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
        let live_tokens = sessions.sign_in(session.clone());
        let live = sessions.authenticate(live_tokens.access.expose()).unwrap();
        let ended_tokens = sessions.sign_in(session);
        let ended = sessions.authenticate(ended_tokens.access.expose()).unwrap();
        sessions.sign_out(ended_tokens.refresh.expose());

        assert_eq!(
            sessions.register_device(registration(1, "voter-001", ended.id.0, 'a')),
            0
        );
        assert!(sessions.devices().for_user("voter-001").is_empty());
        assert_eq!(
            sessions.register_device(registration(2, "voter-001", live.id.0, 'a')),
            0
        );
        assert_eq!(sessions.devices().for_user("voter-001").len(), 1);
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
