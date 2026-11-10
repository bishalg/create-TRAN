//! The device policy and the one decision every app makes about its push token (spec 027,
//! ADR-0044).
//!
//! [`DEVICE_POLICY`] is read by the API to prune registrations nobody refreshed and by the apps to
//! re-register before that happens. [`push_sync`] turns what the app knows right now into one
//! [`PushAction`], so iOS and Android never decide it twice. TypeScript receives the policy
//! through `pnpm tokens:sync`, native code the policy and the decision through UniFFI;
//! `fixtures/push.json` pins both on every platform.
//!
//! Verifies: REQ-PSH-005 REQ-PSH-009

use serde::Serialize;

/// How long a registration lives without a refresh, and how often the apps refresh it (REQ-PSH-005,
/// REQ-PSH-009).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DevicePolicy {
    /// The API removes a registration not refreshed for this many days.
    pub stale_after_days: u32,
    /// The apps register an unchanged token again once it is this many days old, well inside
    /// `stale_after_days`, so a device in use is never pruned.
    pub refresh_after_days: u32,
}

/// Seconds in one day of the policy.
pub const SECONDS_PER_DAY: i64 = 86_400;

impl DevicePolicy {
    /// `stale_after_days` in seconds.
    pub const fn stale_after_seconds(&self) -> i64 {
        self.stale_after_days as i64 * SECONDS_PER_DAY
    }

    /// `refresh_after_days` in seconds.
    pub const fn refresh_after_seconds(&self) -> i64 {
        self.refresh_after_days as i64 * SECONDS_PER_DAY
    }
}

/// Sixty days before the server forgets a device, a weekly refresh from the device.
pub const DEVICE_POLICY: DevicePolicy = DevicePolicy {
    stale_after_days: 60,
    refresh_after_days: 7,
};

/// The registration the app last made and still records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LastRegistration<'a> {
    /// The token it registered.
    pub token: &'a str,
    /// When the API answered `204`, in Unix seconds on the device clock.
    pub registered_at_unix_s: i64,
}

/// Everything [`push_sync`] decides from: what the app knows when it runs the sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PushState<'a> {
    /// The build can receive push at all: the gateway found its configuration (APNs entitlement,
    /// FCM values). `false` in a build without push (REQ-PSH-012).
    pub push_available: bool,
    /// The platform lets the app show notifications now (iOS authorized, provisional or
    /// ephemeral; Android `POST_NOTIFICATIONS` granted, or not needed below API 33).
    pub permission_granted: bool,
    /// The app holds an API session it can authenticate the call with.
    pub has_session: bool,
    /// The token the platform last gave this installation; `None` until it delivers one.
    pub current_token: Option<&'a str>,
    /// The registration the app recorded; `None` when it has none.
    pub last_registration: Option<LastRegistration<'a>>,
    /// Now, in Unix seconds on the device clock.
    pub now_unix_s: i64,
}

/// What the app does after the sync (REQ-PSH-009).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PushAction {
    /// `PUT /api/devices/{installation_id}` with the current token; record it with the time.
    Register,
    /// Clear the recorded registration, then a best-effort `DELETE /api/devices/{installation_id}`.
    Unregister,
    /// Leave everything as it is.
    Nothing,
}

impl PushAction {
    pub const ALL: [Self; 3] = [Self::Register, Self::Unregister, Self::Nothing];

    /// Stable snake_case name, matching `fixtures/push.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Register => "register",
            Self::Unregister => "unregister",
            Self::Nothing => "nothing",
        }
    }
}

/// What to do with the push token now (REQ-PSH-009).
///
/// With push available, permission granted and a session, a token that differs from the recorded
/// one is registered, and so is an unchanged one once its registration is `refresh_after_days`
/// old or dated in the future (the device clock moved back; registering again is harmless). An
/// unchanged, recent registration needs nothing, and neither does a missing token: the platform
/// has not delivered one yet, and what is recorded stays until it does. Without push, permission
/// or a session, a recorded registration is unregistered; with nothing recorded there is nothing
/// to do.
pub fn push_sync(state: &PushState<'_>) -> PushAction {
    let ready = state.push_available && state.permission_granted && state.has_session;
    match (ready, state.current_token, state.last_registration) {
        (false, _, Some(_)) => PushAction::Unregister,
        (false, _, None) | (true, None, _) => PushAction::Nothing,
        (true, Some(token), Some(last)) if last.token == token => {
            let age = state.now_unix_s - last.registered_at_unix_s;
            if (0..DEVICE_POLICY.refresh_after_seconds()).contains(&age) {
                PushAction::Nothing
            } else {
                PushAction::Register
            }
        }
        (true, Some(_), _) => PushAction::Register,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = SECONDS_PER_DAY;

    fn ready<'a>(
        current_token: Option<&'a str>,
        last: Option<LastRegistration<'a>>,
    ) -> PushState<'a> {
        PushState {
            push_available: true,
            permission_granted: true,
            has_session: true,
            current_token,
            last_registration: last,
            now_unix_s: 100 * DAY,
        }
    }

    fn at(token: &str, age: i64) -> Option<LastRegistration<'_>> {
        Some(LastRegistration {
            token,
            registered_at_unix_s: 100 * DAY - age,
        })
    }

    #[test]
    fn the_policy_is_sixty_days_and_a_weekly_refresh() {
        // Verifies: REQ-PSH-005 REQ-PSH-009
        assert_eq!(DEVICE_POLICY.stale_after_days, 60);
        assert_eq!(DEVICE_POLICY.refresh_after_days, 7);
        assert_eq!(DEVICE_POLICY.stale_after_seconds(), 60 * DAY);
        assert_eq!(DEVICE_POLICY.refresh_after_seconds(), 7 * DAY);
        const { assert!(DEVICE_POLICY.refresh_after_days * 2 < DEVICE_POLICY.stale_after_days) };
    }

    #[test]
    fn a_new_or_changed_token_is_registered() {
        // Verifies: REQ-PSH-009
        assert_eq!(push_sync(&ready(Some("a"), None)), PushAction::Register);
        assert_eq!(
            push_sync(&ready(Some("a"), at("b", 0))),
            PushAction::Register
        );
    }

    #[test]
    fn an_unchanged_token_is_registered_again_once_a_week() {
        // Verifies: REQ-PSH-009
        assert_eq!(
            push_sync(&ready(Some("a"), at("a", 0))),
            PushAction::Nothing
        );
        assert_eq!(
            push_sync(&ready(Some("a"), at("a", 7 * DAY - 1))),
            PushAction::Nothing
        );
        assert_eq!(
            push_sync(&ready(Some("a"), at("a", 7 * DAY))),
            PushAction::Register
        );
        assert_eq!(
            push_sync(&ready(Some("a"), at("a", -1))),
            PushAction::Register
        );
    }

    #[test]
    fn no_token_yet_changes_nothing() {
        // Verifies: REQ-PSH-009
        assert_eq!(push_sync(&ready(None, None)), PushAction::Nothing);
        assert_eq!(
            push_sync(&ready(None, at("a", 30 * DAY))),
            PushAction::Nothing
        );
    }

    #[test]
    fn losing_push_permission_or_the_session_unregisters_what_is_recorded() {
        // Verifies: REQ-PSH-009
        for lose in 0..3 {
            let mut state = ready(Some("a"), at("a", 0));
            match lose {
                0 => state.push_available = false,
                1 => state.permission_granted = false,
                _ => state.has_session = false,
            }
            assert_eq!(push_sync(&state), PushAction::Unregister, "{lose}");
            state.last_registration = None;
            assert_eq!(push_sync(&state), PushAction::Nothing, "{lose}");
        }
    }

    #[test]
    fn action_names_are_snake_case_and_match_serde() {
        // Verifies: REQ-PSH-009
        let names: Vec<&str> = PushAction::ALL.map(PushAction::as_str).to_vec();
        assert_eq!(names, ["register", "unregister", "nothing"]);
        for action in PushAction::ALL {
            assert_eq!(serde_json::to_value(action).unwrap(), action.as_str());
        }
        assert_eq!(
            serde_json::to_value(DEVICE_POLICY).unwrap(),
            serde_json::json!({ "stale_after_days": 60, "refresh_after_days": 7 })
        );
    }
}
