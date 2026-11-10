//! Session policy and the client's reaction to an auth failure (spec 022, ADR-0039).
//!
//! The API reads [`SESSION_POLICY`] to issue tokens; TypeScript receives it through
//! `pnpm tokens:sync` and native code through UniFFI. [`session_recovery`] is the one decision
//! every client makes after a `401`, and [`refresh_event`] classifies the answer to a refresh call,
//! so no platform re-decides either. `fixtures/session.json` pins both on every platform.
//!
//! Verifies: REQ-SEC-005 REQ-SEC-015

/// Lifetimes and size of the tokens the API issues (REQ-SEC-005).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionPolicy {
    /// How long an access token is accepted after it is issued.
    pub access_ttl_seconds: u64,
    /// How long a refresh token can buy a new pair after it is issued.
    pub refresh_ttl_seconds: u64,
    /// Random bytes in each token, before base64url encoding.
    pub token_bytes: usize,
}

/// 15-minute access tokens, 30-day refresh tokens, 256 bits of entropy each.
pub const SESSION_POLICY: SessionPolicy = SessionPolicy {
    access_ttl_seconds: 900,
    refresh_ttl_seconds: 2_592_000,
    token_bytes: 32,
};

/// What just went wrong with the session, as a client sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEvent {
    /// An API call answered `401`.
    Unauthorized {
        /// The client holds a refresh token (in its vault, or as the web's cookie).
        has_refresh_credential: bool,
        /// This call was already repeated once after a refresh.
        already_retried: bool,
    },
    /// The refresh call was refused: the credential is dead.
    RefreshRejected,
    /// The refresh call got no usable answer: offline, timeout, rate limit, server error.
    RefreshFailed,
}

impl SessionEvent {
    /// Stable snake_case name, matching `fixtures/session.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unauthorized { .. } => "unauthorized",
            Self::RefreshRejected => "refresh_rejected",
            Self::RefreshFailed => "refresh_failed",
        }
    }
}

/// What the client does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionAction {
    /// Refresh once (sharing one in-flight refresh), then repeat the call with the new token.
    Refresh,
    /// Clear the vault and the access token, and present `auth.session_expired`.
    SignOut,
    /// Keep the credential and the device session; try again later.
    Keep,
}

impl SessionAction {
    /// Stable snake_case name, matching `fixtures/session.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Refresh => "refresh",
            Self::SignOut => "sign_out",
            Self::Keep => "keep",
        }
    }
}

/// The recovery table of REQ-SEC-015.
pub fn session_recovery(event: SessionEvent) -> SessionAction {
    match event {
        SessionEvent::Unauthorized {
            has_refresh_credential: true,
            already_retried: false,
        } => SessionAction::Refresh,
        SessionEvent::Unauthorized { .. } | SessionEvent::RefreshRejected => SessionAction::SignOut,
        SessionEvent::RefreshFailed => SessionAction::Keep,
    }
}

/// Classifies the answer to `POST /api/auth/refresh`.
///
/// `status` is `None` when no HTTP answer arrived (offline, timeout). Returns `None` when the
/// refresh succeeded (`2xx`); `401` and `403` are [`SessionEvent::RefreshRejected`]; anything else
/// is [`SessionEvent::RefreshFailed`], because only the server saying "no" may end a session.
pub fn refresh_event(status: Option<u16>) -> Option<SessionEvent> {
    match status {
        Some(200..=299) => None,
        Some(401 | 403) => Some(SessionEvent::RefreshRejected),
        _ => Some(SessionEvent::RefreshFailed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_is_fifteen_minutes_thirty_days_and_256_bits() {
        // Verifies: REQ-SEC-005
        assert_eq!(SESSION_POLICY.access_ttl_seconds, 15 * 60);
        assert_eq!(SESSION_POLICY.refresh_ttl_seconds, 30 * 24 * 60 * 60);
        assert_eq!(SESSION_POLICY.token_bytes * 8, 256);
    }

    #[test]
    fn only_a_first_401_with_a_credential_refreshes() {
        // Verifies: REQ-SEC-015
        let unauthorized = |has_refresh_credential, already_retried| SessionEvent::Unauthorized {
            has_refresh_credential,
            already_retried,
        };
        assert_eq!(
            session_recovery(unauthorized(true, false)),
            SessionAction::Refresh
        );
        for (credential, retried) in [(true, true), (false, false), (false, true)] {
            assert_eq!(
                session_recovery(unauthorized(credential, retried)),
                SessionAction::SignOut
            );
        }
        assert_eq!(unauthorized(true, true).as_str(), "unauthorized");
    }

    #[test]
    fn a_rejected_refresh_signs_out_and_a_failed_one_keeps_the_session() {
        // Verifies: REQ-SEC-015
        assert_eq!(
            session_recovery(SessionEvent::RefreshRejected),
            SessionAction::SignOut
        );
        assert_eq!(
            session_recovery(SessionEvent::RefreshFailed),
            SessionAction::Keep
        );
        assert_eq!(refresh_event(Some(204)), None);
        assert_eq!(
            refresh_event(Some(403)),
            Some(SessionEvent::RefreshRejected)
        );
        assert_eq!(refresh_event(None), Some(SessionEvent::RefreshFailed));
        assert_eq!(refresh_event(Some(301)), Some(SessionEvent::RefreshFailed));
    }
}
