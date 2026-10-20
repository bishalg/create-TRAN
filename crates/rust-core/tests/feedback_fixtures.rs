// Verifies: REQ-ERR-001 REQ-ERR-004 REQ-ERR-005 REQ-ERR-006 REQ-ERR-007 REQ-ERR-008
//! `fixtures/feedback.json` against the catalogue in `rust_core::feedback`. The same file pins the
//! generated TypeScript, Swift and Kotlin tables.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::feedback::{
    code_for_http_status, is_valid_request_id, retry_after_ms, retry_delay_ms, ErrorCode,
    Presentation, ToastDuration, UserAction, LOG_EVENT, RETRY_POLICY, SERVER_DEADLINE_MS,
};
use serde::Deserialize;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../../../fixtures/feedback.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    toast_durations_ms: Value,
    retry_policy: Value,
    server_deadline_ms: u64,
    log_event: Value,
    request_ids: RequestIds,
    retry_delays: Vec<DelayCase>,
    retry_after: Vec<RetryAfterCase>,
    errors: Vec<Value>,
    status_fallback: Vec<StatusCase>,
    actions: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DelayCase {
    retry: u32,
    random: f64,
    expected_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetryAfterCase {
    header: String,
    expected_ms: Option<u64>,
}

#[derive(Deserialize)]
struct RequestIds {
    valid: Vec<String>,
    invalid: Vec<String>,
}

#[derive(Deserialize)]
struct StatusCase {
    status: u16,
    code: String,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/feedback.json must be valid")
}

/// The fixture's JSON shape for a presentation — the same shape codegen emits.
fn presentation_json(presentation: Presentation) -> Value {
    match presentation {
        Presentation::Silent => json!({ "kind": "silent" }),
        Presentation::Inline => json!({ "kind": "inline" }),
        Presentation::Banner => json!({ "kind": "banner" }),
        Presentation::Toast { tone, duration } => {
            json!({ "kind": "toast", "tone": tone.as_str(), "duration": duration.as_str() })
        }
        Presentation::Dialog { destructive } => {
            json!({ "kind": "dialog", "destructive": destructive })
        }
    }
}

#[test]
fn every_error_code_matches_the_fixture_in_order() {
    let actual: Vec<Value> = ErrorCode::ALL
        .iter()
        .map(|code| {
            let spec = code.spec();
            json!({
                "code": code.as_str(),
                "httpStatus": spec.http_status,
                "retryable": spec.retryable,
                "logLevel": spec.log_level.as_str(),
                "presentation": presentation_json(spec.presentation),
                "messageKey": spec.message_key,
            })
        })
        .collect();
    assert_eq!(actual, fixtures().errors);
}

#[test]
fn every_action_matches_the_fixture_in_order() {
    let actual: Vec<Value> = UserAction::ALL
        .iter()
        .map(|action| {
            let spec = action.spec();
            json!({
                "action": action.as_str(),
                "presentation": presentation_json(spec.presentation),
                "messageKey": spec.message_key,
            })
        })
        .collect();
    assert_eq!(actual, fixtures().actions);
}

#[test]
fn toast_durations_and_retry_policy_match_the_fixture() {
    let fixtures = fixtures();
    assert_eq!(
        json!({
            "short": ToastDuration::Short.millis(),
            "medium": ToastDuration::Medium.millis(),
            "long": ToastDuration::Long.millis(),
        }),
        fixtures.toast_durations_ms
    );
    assert_eq!(
        json!({
            "maxAttempts": RETRY_POLICY.max_attempts,
            "baseDelayMs": RETRY_POLICY.base_delay_ms,
            "maxDelayMs": RETRY_POLICY.max_delay_ms,
            "requestTimeoutMs": RETRY_POLICY.request_timeout_ms,
        }),
        fixtures.retry_policy
    );
}

// Verifies: REQ-ROB-004 REQ-ROB-007
#[test]
fn server_deadline_and_log_event_match_the_fixture() {
    let fixtures = fixtures();
    assert_eq!(SERVER_DEADLINE_MS, fixtures.server_deadline_ms);
    assert_eq!(
        json!({ "message": LOG_EVENT.message, "fields": LOG_EVENT.fields }),
        fixtures.log_event
    );
}

// Verifies: REQ-ROB-010
#[test]
fn request_id_shape_matches_the_fixture() {
    let ids = fixtures().request_ids;
    for id in ids.valid {
        assert!(is_valid_request_id(&id), "{id:?} should be valid");
    }
    for id in ids.invalid {
        assert!(!is_valid_request_id(&id), "{id:?} should be invalid");
    }
}

#[test]
fn retry_delays_match_the_fixture() {
    for case in fixtures().retry_delays {
        assert_eq!(
            retry_delay_ms(case.retry, case.random),
            case.expected_ms,
            "retry {} random {}",
            case.retry,
            case.random
        );
    }
}

#[test]
fn retry_after_headers_match_the_fixture() {
    for case in fixtures().retry_after {
        assert_eq!(
            retry_after_ms(&case.header),
            case.expected_ms,
            "{:?}",
            case.header
        );
    }
}

#[test]
fn status_fallback_matches_the_fixture() {
    for case in fixtures().status_fallback {
        assert_eq!(
            code_for_http_status(case.status).as_str(),
            case.code,
            "{}",
            case.status
        );
    }
}
