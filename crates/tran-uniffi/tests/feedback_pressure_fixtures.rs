// Verifies: REQ-ERR-012 REQ-ERR-013 REQ-ERR-014
//! Toast pressure, banner recovery and reporting through the UniFFI surface (same fixture as
//! rust-core), so Swift and Kotlin call exactly what these rows pin.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use tran_uniffi::{
    admit_toast, is_reported_log_level, recovery_policy, recovery_probe_delay_ms, toast_policy,
    TranLogLevel, TranToastAdmission, TranToastKey, TranToastTone,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    toast_policy: ToastPolicyCase,
    toast_queue: Vec<QueueCase>,
    recovery_policy: RecoveryCase,
    recovery_probes: Vec<ProbeCase>,
    reported_log_levels: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToastPolicyCase {
    max_visible: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueCase {
    name: String,
    visible: Vec<(String, String)>,
    incoming: (String, String),
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    refresh: Option<u32>,
    evict_oldest: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryCase {
    first_probe_ms: u64,
    max_probe_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeCase {
    probe: u32,
    expected_ms: u64,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(include_str!("../../../fixtures/feedback.json")).unwrap()
}

fn key((message_key, tone): (String, String)) -> TranToastKey {
    let tone = match tone.as_str() {
        "success" => TranToastTone::Success,
        "info" => TranToastTone::Info,
        "warning" => TranToastTone::Warning,
        "error" => TranToastTone::Error,
        other => panic!("unknown tone {other}"),
    };
    TranToastKey { message_key, tone }
}

#[test]
fn toast_policy_and_admission_match_the_fixture() {
    let fixtures = fixtures();
    assert_eq!(
        toast_policy().max_visible,
        fixtures.toast_policy.max_visible
    );
    for case in fixtures.toast_queue {
        let visible = case.visible.into_iter().map(key).collect();
        let expected = match case.expected.refresh {
            Some(index) => TranToastAdmission::Refresh { index },
            None => TranToastAdmission::Append {
                evict_oldest: case.expected.evict_oldest,
            },
        };
        assert_eq!(
            admit_toast(visible, key(case.incoming)),
            expected,
            "{}",
            case.name
        );
    }
}

#[test]
fn recovery_schedule_matches_the_fixture() {
    let fixtures = fixtures();
    let policy = recovery_policy();
    assert_eq!(
        policy.first_probe_ms,
        fixtures.recovery_policy.first_probe_ms
    );
    assert_eq!(policy.max_probe_ms, fixtures.recovery_policy.max_probe_ms);
    for case in fixtures.recovery_probes {
        assert_eq!(recovery_probe_delay_ms(case.probe), case.expected_ms);
    }
}

#[test]
fn only_reported_levels_are_reported() {
    let levels = [
        (TranLogLevel::Debug, "debug"),
        (TranLogLevel::Info, "info"),
        (TranLogLevel::Warn, "warn"),
        (TranLogLevel::Error, "error"),
    ];
    let reported: Vec<String> = levels
        .into_iter()
        .filter(|(level, _)| is_reported_log_level(*level))
        .map(|(_, name)| name.to_string())
        .collect();
    assert_eq!(reported, fixtures().reported_log_levels);
}
