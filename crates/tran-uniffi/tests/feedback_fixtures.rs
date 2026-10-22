// Verifies: REQ-ERR-001 REQ-ERR-004 REQ-ERR-005 REQ-ROB-010 REQ-LOAD-001
//! The feedback catalogue through the UniFFI export surface (same fixture as rust-core).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use tran_uniffi::{
    action_spec, error_catalogue, error_code_for_http_status, error_code_for_validation,
    error_code_from_wire, error_spec, is_valid_request_id, loading_policy, retry_after_ms,
    retry_delay_ms, retry_policy, toast_duration_ms, verdict_source_spec, TranErrorCode,
    TranLogLevel, TranPresentation, TranToastDuration, TranToastTone, TranUserAction,
    TranValidationError, TranVerdictSource,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    toast_durations_ms: BTreeMap<String, u64>,
    retry_policy: Policy,
    retry_delays: Vec<DelayCase>,
    retry_after: Vec<RetryAfterCase>,
    errors: Vec<ErrorCase>,
    status_fallback: Vec<StatusCase>,
    actions: Vec<ActionCase>,
    request_ids: RequestIds,
    loading_policy: LoadingPolicyCase,
    verdict_sources: Vec<VerdictSourceCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadingPolicyCase {
    indicator_delay_ms: u64,
    pending_message_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerdictSourceCase {
    source: String,
    message_key: String,
}

#[derive(Deserialize)]
struct RequestIds {
    valid: Vec<String>,
    invalid: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    max_attempts: u32,
    base_delay_ms: u64,
    max_delay_ms: u64,
    request_timeout_ms: u64,
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
#[serde(rename_all = "camelCase")]
struct ErrorCase {
    code: String,
    http_status: Option<u16>,
    retryable: bool,
    log_level: String,
    presentation: Value,
    message_key: String,
}

#[derive(Deserialize)]
struct StatusCase {
    status: u16,
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionCase {
    action: String,
    presentation: Value,
    message_key: String,
}

fn fixtures() -> Fixtures {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/feedback.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn duration_name(duration: TranToastDuration) -> &'static str {
    match duration {
        TranToastDuration::Short => "short",
        TranToastDuration::Medium => "medium",
        TranToastDuration::Long => "long",
    }
}

/// The fixture's JSON shape for a presentation, so the comparison is field by field.
fn presentation_json(p: TranPresentation) -> Value {
    match p {
        TranPresentation::Silent => serde_json::json!({ "kind": "silent" }),
        TranPresentation::Inline => serde_json::json!({ "kind": "inline" }),
        TranPresentation::Banner => serde_json::json!({ "kind": "banner" }),
        TranPresentation::Dialog { destructive } => {
            serde_json::json!({ "kind": "dialog", "destructive": destructive })
        }
        TranPresentation::Toast { tone, duration } => serde_json::json!({
            "kind": "toast",
            "tone": match tone {
                TranToastTone::Success => "success",
                TranToastTone::Info => "info",
                TranToastTone::Warning => "warning",
                TranToastTone::Error => "error",
            },
            "duration": duration_name(duration),
        }),
    }
}

fn level_name(level: TranLogLevel) -> &'static str {
    match level {
        TranLogLevel::Debug => "debug",
        TranLogLevel::Info => "info",
        TranLogLevel::Warn => "warn",
        TranLogLevel::Error => "error",
    }
}

#[test]
fn the_catalogue_matches_the_fixture_row_by_row() {
    let expected = fixtures().errors;
    let catalogue = error_catalogue();
    assert_eq!(catalogue.len(), expected.len());
    for (spec, case) in catalogue.iter().zip(&expected) {
        assert_eq!(spec.wire_code, case.code);
        assert_eq!(spec.http_status, case.http_status, "{}", case.code);
        assert_eq!(spec.retryable, case.retryable, "{}", case.code);
        assert_eq!(level_name(spec.log_level), case.log_level, "{}", case.code);
        assert_eq!(
            presentation_json(spec.presentation),
            case.presentation,
            "{}",
            case.code
        );
        assert_eq!(spec.message_key, case.message_key, "{}", case.code);
        assert_eq!(error_code_from_wire(case.code.clone()), Some(spec.code));
        assert_eq!(&error_spec(spec.code), spec);
    }
    assert_eq!(error_code_from_wire("from.the_future".into()), None);
}

#[test]
fn actions_match_the_fixture() {
    for case in fixtures().actions {
        let action = match case.action.as_str() {
            "sign_out" => TranUserAction::SignOut,
            "server_check_succeeded" => TranUserAction::ServerCheckSucceeded,
            other => panic!("unknown fixture action {other:?}"),
        };
        let spec = action_spec(action);
        assert_eq!(spec.wire_name, case.action);
        assert_eq!(presentation_json(spec.presentation), case.presentation);
        assert_eq!(spec.message_key, case.message_key);
    }
}

#[test]
fn statuses_without_a_code_use_the_fallback_table() {
    for case in fixtures().status_fallback {
        let code = error_code_for_http_status(case.status);
        assert_eq!(
            error_spec(code).wire_code,
            case.code,
            "HTTP {}",
            case.status
        );
    }
}

#[test]
fn timing_and_retry_policy_match_the_fixture() {
    let f = fixtures();
    for duration in [
        TranToastDuration::Short,
        TranToastDuration::Medium,
        TranToastDuration::Long,
    ] {
        assert_eq!(
            toast_duration_ms(duration),
            f.toast_durations_ms[duration_name(duration)]
        );
    }
    let policy = retry_policy();
    assert_eq!(policy.max_attempts, f.retry_policy.max_attempts);
    assert_eq!(policy.base_delay_ms, f.retry_policy.base_delay_ms);
    assert_eq!(policy.max_delay_ms, f.retry_policy.max_delay_ms);
    assert_eq!(policy.request_timeout_ms, f.retry_policy.request_timeout_ms);
    for case in f.retry_delays {
        assert_eq!(retry_delay_ms(case.retry, case.random), case.expected_ms);
    }
    for case in f.retry_after {
        assert_eq!(
            retry_after_ms(case.header.clone()),
            case.expected_ms,
            "{:?}",
            case.header
        );
    }
}

#[test]
fn device_rejections_share_the_server_codes() {
    let cases = [
        (
            TranValidationError::AgeOutOfRange,
            TranErrorCode::ValidationAgeOutOfRange,
        ),
        (
            TranValidationError::BirthdateInFuture,
            TranErrorCode::ValidationBirthdateInFuture,
        ),
        (
            TranValidationError::InvalidCountryCode,
            TranErrorCode::ValidationInvalidCountryCode,
        ),
        (
            TranValidationError::InvalidBirthdate,
            TranErrorCode::ValidationInvalidDate,
        ),
        (
            TranValidationError::InvalidReferenceDate,
            TranErrorCode::ValidationInvalidDate,
        ),
    ];
    for (error, code) in cases {
        assert_eq!(error_code_for_validation(error), code);
    }
}

#[test]
fn request_id_shape_matches_the_fixture() {
    let ids = fixtures().request_ids;
    assert!(ids.valid.into_iter().all(is_valid_request_id));
    assert!(!ids.invalid.into_iter().any(is_valid_request_id));
}

#[test]
fn loading_policy_matches_fixture() {
    let expected = fixtures().loading_policy;
    let policy = loading_policy();
    assert_eq!(policy.indicator_delay_ms, expected.indicator_delay_ms);
    assert_eq!(policy.pending_message_key, expected.pending_message_key);
}

#[test]
fn every_verdict_source_matches_fixture() {
    let sources = [
        TranVerdictSource::Device,
        TranVerdictSource::Server,
        TranVerdictSource::DeviceFallback,
    ];
    let expected = fixtures().verdict_sources;
    assert_eq!(expected.len(), sources.len());
    for (source, case) in sources.into_iter().zip(expected) {
        let spec = verdict_source_spec(source);
        assert_eq!(spec.source, source);
        assert_eq!(spec.wire_name, case.source);
        assert_eq!(spec.message_key, case.message_key);
    }
}
