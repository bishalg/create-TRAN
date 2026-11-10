//! Session policy and the recovery decision for native apps (spec 022, ADR-0039).
//!
//! Swift and Kotlin call [`session_recovery`] after every auth failure and
//! [`session_refresh_event`] on every refresh answer, so the apps implement only the mechanics
//! (one shared in-flight refresh, the vault) and never the policy.

use rust_core::session::{self, SessionAction, SessionEvent, SESSION_POLICY};

/// Token lifetimes and size issued by the API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct TranSessionPolicy {
    /// Seconds an access token is accepted after it is issued (15 minutes).
    pub access_ttl_seconds: u64,
    /// Seconds a refresh token can buy a new pair after it is issued (30 days).
    pub refresh_ttl_seconds: u64,
    /// Random bytes in each token before base64url encoding.
    pub token_bytes: u32,
}

/// What just went wrong with the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranSessionEvent {
    /// An API call answered `401`.
    Unauthorized {
        /// The vault holds a refresh token.
        has_refresh_credential: bool,
        /// This call was already repeated once after a refresh.
        already_retried: bool,
    },
    /// The refresh call answered `401` or `403`: the credential is dead.
    RefreshRejected,
    /// The refresh call got no usable answer (offline, timeout, `429`, `5xx`).
    RefreshFailed,
}

/// What the app does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranSessionAction {
    /// Refresh once (one shared in-flight refresh), then repeat the call with the new token.
    Refresh,
    /// Clear the vault and the access token, and present `auth.session_expired`.
    SignOut,
    /// Keep the vault and the device session; try again later. Never signs the user out.
    Keep,
}

impl From<TranSessionEvent> for SessionEvent {
    fn from(event: TranSessionEvent) -> Self {
        match event {
            TranSessionEvent::Unauthorized {
                has_refresh_credential,
                already_retried,
            } => Self::Unauthorized {
                has_refresh_credential,
                already_retried,
            },
            TranSessionEvent::RefreshRejected => Self::RefreshRejected,
            TranSessionEvent::RefreshFailed => Self::RefreshFailed,
        }
    }
}

impl From<SessionEvent> for TranSessionEvent {
    fn from(event: SessionEvent) -> Self {
        match event {
            SessionEvent::Unauthorized {
                has_refresh_credential,
                already_retried,
            } => Self::Unauthorized {
                has_refresh_credential,
                already_retried,
            },
            SessionEvent::RefreshRejected => Self::RefreshRejected,
            SessionEvent::RefreshFailed => Self::RefreshFailed,
        }
    }
}

/// The session policy from `rust-core`.
///
/// # Returns
///
/// The lifetimes the API issues tokens with; pinned by the `policy` section of
/// `fixtures/session.json`.
#[uniffi::export]
pub fn session_policy() -> TranSessionPolicy {
    TranSessionPolicy {
        access_ttl_seconds: SESSION_POLICY.access_ttl_seconds,
        refresh_ttl_seconds: SESSION_POLICY.refresh_ttl_seconds,
        token_bytes: u32::try_from(SESSION_POLICY.token_bytes).unwrap_or(u32::MAX),
    }
}

/// What to do after an auth failure (REQ-SEC-015).
///
/// # Arguments
///
/// * `event` — the failure: a `401` on an API call, or the outcome of a refresh.
///
/// # Returns
///
/// [`TranSessionAction::Refresh`] only for a first `401` while a refresh token is held;
/// [`TranSessionAction::SignOut`] when the credential is missing or dead;
/// [`TranSessionAction::Keep`] when the refresh merely failed.
#[uniffi::export]
pub fn session_recovery(event: TranSessionEvent) -> TranSessionAction {
    match session::session_recovery(event.into()) {
        SessionAction::Refresh => TranSessionAction::Refresh,
        SessionAction::SignOut => TranSessionAction::SignOut,
        SessionAction::Keep => TranSessionAction::Keep,
    }
}

/// Classifies the answer to `POST /api/auth/refresh`.
///
/// # Arguments
///
/// * `status` — the HTTP status, or `None` when no answer arrived (offline, timeout).
///
/// # Returns
///
/// `None` when the refresh succeeded (`2xx`); otherwise the event to pass to
/// [`session_recovery`]: `401` and `403` reject the credential, anything else merely failed.
#[uniffi::export]
pub fn session_refresh_event(status: Option<u16>) -> Option<TranSessionEvent> {
    session::refresh_event(status).map(TranSessionEvent::from)
}
