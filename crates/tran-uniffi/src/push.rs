//! The device policy and the push-token decision for native apps (spec 027, ADR-0044).
//!
//! Swift and Kotlin call [`push_sync`] at launch, on return to the foreground, when the platform
//! delivers a new token and after sign-in, so the apps implement only the push gateway and the two
//! API calls, never the policy.

use rust_core::push::{self, LastRegistration, PushAction, PushState, DEVICE_POLICY};

/// How long the API keeps a registration nobody refreshed, and how often the app refreshes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct TranDevicePolicy {
    /// The API removes a registration not refreshed for this many days (60).
    pub stale_after_days: u32,
    /// The app registers an unchanged token again once its registration is this many days old (7).
    pub refresh_after_days: u32,
}

/// The registration the app last made and keeps in ordinary app storage.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranLastRegistration {
    /// The push token it registered.
    pub token: String,
    /// When the API answered `204`, in Unix seconds on the device clock.
    pub registered_at_unix_s: i64,
}

/// What the app knows when it runs the sync.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranPushState {
    /// The push gateway found the build's push configuration (APNs entitlement, FCM values).
    pub push_available: bool,
    /// The platform lets the app show notifications (iOS authorized, provisional or ephemeral;
    /// Android `POST_NOTIFICATIONS` granted, or not needed below API 33).
    pub permission_granted: bool,
    /// The app holds an API session to authenticate the call with.
    pub has_session: bool,
    /// The token the platform last delivered; `None` until it delivers one.
    pub current_token: Option<String>,
    /// The registration the app recorded; `None` when it has none.
    pub last_registration: Option<TranLastRegistration>,
    /// Now, in Unix seconds on the device clock.
    pub now_unix_s: i64,
}

/// What the app does after the sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranPushAction {
    /// `PUT /api/devices/{installation_id}` with the current token; on `204` record the token and
    /// the time.
    Register,
    /// Clear the recorded registration first, then a best-effort
    /// `DELETE /api/devices/{installation_id}` whose failure changes nothing.
    Unregister,
    /// Leave everything as it is.
    Nothing,
}

impl From<PushAction> for TranPushAction {
    fn from(action: PushAction) -> Self {
        match action {
            PushAction::Register => Self::Register,
            PushAction::Unregister => Self::Unregister,
            PushAction::Nothing => Self::Nothing,
        }
    }
}

/// The device policy from `rust-core`.
///
/// # Returns
///
/// The stale and refresh windows in days; pinned by the `policy` section of `fixtures/push.json`.
#[uniffi::export]
pub fn device_policy() -> TranDevicePolicy {
    TranDevicePolicy {
        stale_after_days: DEVICE_POLICY.stale_after_days,
        refresh_after_days: DEVICE_POLICY.refresh_after_days,
    }
}

/// What to do with the push token now (REQ-PSH-009).
///
/// # Arguments
///
/// * `state` — push availability, permission, session, the current token and the recorded
///   registration, with the device's current time.
///
/// # Returns
///
/// [`TranPushAction::Register`] for a new or changed token, or an unchanged one whose registration
/// is at least `refresh_after_days` old (or dated in the future); [`TranPushAction::Unregister`]
/// when push, permission or the session is gone while a registration is recorded;
/// [`TranPushAction::Nothing`] otherwise, including before the platform delivers a token.
#[uniffi::export]
pub fn push_sync(state: TranPushState) -> TranPushAction {
    push::push_sync(&PushState {
        push_available: state.push_available,
        permission_granted: state.permission_granted,
        has_session: state.has_session,
        current_token: state.current_token.as_deref(),
        last_registration: state
            .last_registration
            .as_ref()
            .map(|last| LastRegistration {
                token: &last.token,
                registered_at_unix_s: last.registered_at_unix_s,
            }),
        now_unix_s: state.now_unix_s,
    })
    .into()
}
