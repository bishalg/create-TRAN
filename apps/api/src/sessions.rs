//! Issuing, checking, rotating and revoking sessions (REQ-SEC-006 to REQ-SEC-011, ADR-0039).
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
use crate::secret::Secret;
use crate::session_store::{
    InMemorySessionStore, PairDigests, Rotation, SessionStore, StoredSession, TokenDigest,
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
    clock: Arc<dyn Clock>,
}

impl Sessions {
    pub fn new(store: Arc<dyn SessionStore>, clock: Arc<dyn Clock>) -> Self {
        Self { store, clock }
    }

    /// The sample's setup: in memory, on the real clock.
    pub fn in_memory() -> Self {
        Self::new(
            Arc::new(InMemorySessionStore::default()),
            Arc::new(SystemClock),
        )
    }

    /// Starts a session and returns its first pair.
    pub fn sign_in(&self, session: StoredSession) -> IssuedTokens {
        let (tokens, digests) = self.mint_pair();
        self.store.start(session, digests);
        tokens
    }

    /// The session behind a live access token.
    pub fn authenticate(&self, access: &str) -> Option<StoredSession> {
        self.store
            .session_for_access(&digest(access), self.clock.now())
    }

    /// Spends `refresh` for a new pair. A replay revokes the session and is logged once.
    pub fn refresh(&self, refresh: &str) -> Result<(StoredSession, IssuedTokens), Rotation> {
        let (tokens, digests) = self.mint_pair();
        match self
            .store
            .rotate(&digest(refresh), digests, self.clock.now())
        {
            Rotation::Rotated(session) => Ok((session, tokens)),
            Rotation::Replayed => {
                tracing::warn!("refresh token replayed; session revoked");
                Err(Rotation::Replayed)
            }
            refused => Err(refused),
        }
    }

    /// Revokes the session of `refresh`, if there is one.
    pub fn sign_out(&self, refresh: &str) {
        self.store.revoke(&digest(refresh));
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

    // Verifies: REQ-SEC-006
    #[test]
    fn the_digest_is_sha256() {
        // SHA-256("abc"), FIPS 180-2 test vector.
        let abc = digest("abc");
        assert_eq!(abc[..4], [0xba, 0x78, 0x16, 0xbf]);
        assert_eq!(abc[28..], [0xf2, 0x00, 0x15, 0xad]);
    }
}
