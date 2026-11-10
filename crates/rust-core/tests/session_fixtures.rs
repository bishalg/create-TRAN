// Verifies: REQ-SEC-005 REQ-SEC-015
//! Session policy and recovery cases from `fixtures/session.json`, shared with TypeScript, UniFFI
//! and native.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::session::{
    refresh_event, session_recovery, SessionAction, SessionEvent, SESSION_POLICY,
};
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/session.json");

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
    token_bytes: usize,
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
    serde_json::from_str(FIXTURE).expect("fixtures/session.json")
}

#[test]
fn policy_matches_fixture() {
    let policy = fixtures().policy;
    assert_eq!(SESSION_POLICY.access_ttl_seconds, policy.access_ttl_seconds);
    assert_eq!(
        SESSION_POLICY.refresh_ttl_seconds,
        policy.refresh_ttl_seconds
    );
    assert_eq!(SESSION_POLICY.token_bytes, policy.token_bytes);
}

#[test]
fn recovery_matches_fixture() {
    for case in fixtures().recovery {
        let event = match case.event.as_str() {
            "unauthorized" => SessionEvent::Unauthorized {
                has_refresh_credential: case.has_refresh_credential,
                already_retried: case.already_retried,
            },
            "refresh_rejected" => SessionEvent::RefreshRejected,
            "refresh_failed" => SessionEvent::RefreshFailed,
            other => panic!("unknown fixture event {other:?}"),
        };
        assert_eq!(event.as_str(), case.event, "{}", case.name);
        assert_eq!(
            session_recovery(event).as_str(),
            case.action,
            "{}",
            case.name
        );
    }
}

#[test]
fn refresh_responses_match_fixture() {
    for case in fixtures().refresh_responses {
        let event = refresh_event(case.status).map(SessionEvent::as_str);
        assert_eq!(event, case.event.as_deref(), "{}", case.name);
    }
}

#[test]
fn every_action_has_a_snake_case_name() {
    let names: Vec<&str> = [
        SessionAction::Refresh,
        SessionAction::SignOut,
        SessionAction::Keep,
    ]
    .iter()
    .map(|a| a.as_str())
    .collect();
    assert_eq!(names, ["refresh", "sign_out", "keep"]);
}
