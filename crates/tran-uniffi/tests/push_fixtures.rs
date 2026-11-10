// Verifies: REQ-PSH-005 REQ-PSH-009
//! The device policy and `push_sync` through the UniFFI export surface (same fixture as rust-core).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use tran_uniffi::{device_policy, push_sync, TranLastRegistration, TranPushAction, TranPushState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    policy: Policy,
    sync: Vec<SyncCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    stale_after_days: u32,
    refresh_after_days: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncCase {
    name: String,
    push_available: bool,
    permission_granted: bool,
    has_session: bool,
    current_token: Option<String>,
    last_registration: Option<Recorded>,
    now_unix_s: i64,
    action: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recorded {
    token: String,
    registered_at_unix_s: i64,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(include_str!("../../../fixtures/push.json")).unwrap()
}

fn action_name(action: TranPushAction) -> &'static str {
    match action {
        TranPushAction::Register => "register",
        TranPushAction::Unregister => "unregister",
        TranPushAction::Nothing => "nothing",
    }
}

#[test]
fn policy_matches_fixture() {
    let expected = fixtures().policy;
    let policy = device_policy();
    assert_eq!(policy.stale_after_days, expected.stale_after_days);
    assert_eq!(policy.refresh_after_days, expected.refresh_after_days);
}

#[test]
fn sync_matches_fixture() {
    for case in fixtures().sync {
        let state = TranPushState {
            push_available: case.push_available,
            permission_granted: case.permission_granted,
            has_session: case.has_session,
            current_token: case.current_token,
            last_registration: case.last_registration.map(|r| TranLastRegistration {
                token: r.token,
                registered_at_unix_s: r.registered_at_unix_s,
            }),
            now_unix_s: case.now_unix_s,
        };
        assert_eq!(action_name(push_sync(state)), case.action, "{}", case.name);
    }
}
