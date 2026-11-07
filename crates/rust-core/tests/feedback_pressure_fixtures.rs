// Verifies: REQ-ERR-012 REQ-ERR-013 REQ-ERR-014
//! `fixtures/feedback.json` sections for toast pressure, banner recovery and reporting against
//! `rust_core::feedback`. The same rows pin the TypeScript, Swift and Kotlin mechanics.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::feedback::{
    admit_toast, recovery_probe_delay_ms, LogLevel, ToastAdmission, ToastKey, Tone,
    RECOVERY_POLICY, TOAST_POLICY,
};
use serde::Deserialize;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../../../fixtures/feedback.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    toast_policy: Value,
    toast_queue: Vec<QueueCase>,
    recovery_policy: Value,
    recovery_probes: Vec<ProbeCase>,
    reported_log_levels: Vec<String>,
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
    refresh: Option<usize>,
    evict_oldest: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeCase {
    probe: u32,
    expected_ms: u64,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/feedback.json must be valid")
}

fn tone(name: &str) -> Tone {
    Tone::ALL
        .into_iter()
        .find(|t| t.as_str() == name)
        .expect("fixture tone")
}

#[test]
fn toast_policy_matches_the_fixture() {
    assert_eq!(
        json!({ "maxVisible": TOAST_POLICY.max_visible }),
        fixtures().toast_policy
    );
}

#[test]
fn toast_admission_matches_every_fixture_case() {
    for case in fixtures().toast_queue {
        let visible: Vec<ToastKey> = case
            .visible
            .iter()
            .map(|(key, t)| ToastKey {
                message_key: key,
                tone: tone(t),
            })
            .collect();
        let incoming = ToastKey {
            message_key: &case.incoming.0,
            tone: tone(&case.incoming.1),
        };
        let expected = match case.expected.refresh {
            Some(index) => ToastAdmission::Refresh { index },
            None => ToastAdmission::Append {
                evict_oldest: case.expected.evict_oldest,
            },
        };
        assert_eq!(admit_toast(&visible, incoming), expected, "{}", case.name);
    }
}

#[test]
fn recovery_policy_and_probe_schedule_match_the_fixture() {
    let fixtures = fixtures();
    assert_eq!(
        json!({
            "firstProbeMs": RECOVERY_POLICY.first_probe_ms,
            "maxProbeMs": RECOVERY_POLICY.max_probe_ms,
        }),
        fixtures.recovery_policy
    );
    for case in fixtures.recovery_probes {
        assert_eq!(
            recovery_probe_delay_ms(case.probe),
            case.expected_ms,
            "probe {}",
            case.probe
        );
    }
}

#[test]
fn only_error_level_failures_are_reported() {
    let reported: Vec<&str> = [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ]
    .into_iter()
    .filter(|level| level.is_reported())
    .map(LogLevel::as_str)
    .collect();
    assert_eq!(reported, fixtures().reported_log_levels);
}
