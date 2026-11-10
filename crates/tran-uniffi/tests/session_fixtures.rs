// Verifies: REQ-SEC-005 REQ-SEC-015
//! Session policy and recovery through the UniFFI export surface (same fixture as rust-core).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use tran_uniffi::{
    session_policy, session_recovery, session_refresh_event, TranSessionAction, TranSessionEvent,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    policy: Policy,
    recovery: Vec<RecoveryCase>,
    refresh_responses: Vec<RefreshCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    access_ttl_seconds: u64,
    refresh_ttl_seconds: u64,
    token_bytes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryCase {
    name: String,
    event: String,
    #[serde(default)]
    has_refresh_credential: bool,
    #[serde(default)]
    already_retried: bool,
    action: String,
}

#[derive(Deserialize)]
struct RefreshCase {
    name: String,
    status: Option<u16>,
    event: Option<String>,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(include_str!("../../../fixtures/session.json")).unwrap()
}

fn event_name(event: TranSessionEvent) -> &'static str {
    match event {
        TranSessionEvent::Unauthorized { .. } => "unauthorized",
        TranSessionEvent::RefreshRejected => "refresh_rejected",
        TranSessionEvent::RefreshFailed => "refresh_failed",
    }
}

fn action_name(action: TranSessionAction) -> &'static str {
    match action {
        TranSessionAction::Refresh => "refresh",
        TranSessionAction::SignOut => "sign_out",
        TranSessionAction::Keep => "keep",
    }
}

#[test]
fn policy_matches_fixture() {
    let expected = fixtures().policy;
    let policy = session_policy();
    assert_eq!(policy.access_ttl_seconds, expected.access_ttl_seconds);
    assert_eq!(policy.refresh_ttl_seconds, expected.refresh_ttl_seconds);
    assert_eq!(policy.token_bytes, expected.token_bytes);
}

#[test]
fn recovery_matches_fixture() {
    for case in fixtures().recovery {
        let event = match case.event.as_str() {
            "unauthorized" => TranSessionEvent::Unauthorized {
                has_refresh_credential: case.has_refresh_credential,
                already_retried: case.already_retried,
            },
            "refresh_rejected" => TranSessionEvent::RefreshRejected,
            "refresh_failed" => TranSessionEvent::RefreshFailed,
            other => panic!("unknown fixture event {other:?}"),
        };
        assert_eq!(
            action_name(session_recovery(event)),
            case.action,
            "{}",
            case.name
        );
    }
}

#[test]
fn refresh_responses_match_fixture() {
    for case in fixtures().refresh_responses {
        let event = session_refresh_event(case.status).map(event_name);
        assert_eq!(event, case.event.as_deref(), "{}", case.name);
    }
}
