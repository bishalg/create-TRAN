// Verifies: REQ-RL-001 REQ-RL-002
//! Rate policy and bucket cases from `fixtures/rate.json`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::rate::{take, Bucket, RouteClass, RATE_POLICY};
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/rate.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureData {
    policy: RatePolicyFixture,
    cases: Vec<TestCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RatePolicyFixture {
    auth: ClassPolicyFixture,
    write: ClassPolicyFixture,
    read: ClassPolicyFixture,
    max_keys: usize,
    max_in_flight: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClassPolicyFixture {
    sustained_per_minute: u32,
    burst: u32,
}

#[derive(Deserialize)]
struct TestCase {
    name: String,
    class: String,
    takes: Vec<TakeStep>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TakeStep {
    at_ms: u64,
    allowed: bool,
    retry_after: Option<u64>,
}

fn fixture() -> FixtureData {
    serde_json::from_str(FIXTURE).expect("fixtures/rate.json is valid JSON")
}

#[test]
fn policy_matches_fixture() {
    // Verifies: REQ-RL-001
    let data = fixture();
    assert_eq!(
        RATE_POLICY.auth.sustained_per_minute,
        data.policy.auth.sustained_per_minute
    );
    assert_eq!(RATE_POLICY.auth.burst, data.policy.auth.burst);
    assert_eq!(
        RATE_POLICY.write.sustained_per_minute,
        data.policy.write.sustained_per_minute
    );
    assert_eq!(RATE_POLICY.write.burst, data.policy.write.burst);
    assert_eq!(
        RATE_POLICY.read.sustained_per_minute,
        data.policy.read.sustained_per_minute
    );
    assert_eq!(RATE_POLICY.read.burst, data.policy.read.burst);
    assert_eq!(RATE_POLICY.max_keys, data.policy.max_keys);
    assert_eq!(RATE_POLICY.max_in_flight, data.policy.max_in_flight);
}

#[test]
fn take_fixture_cases() {
    // Verifies: REQ-RL-002
    let data = fixture();
    for case in &data.cases {
        let (policy, class) = match case.class.as_str() {
            "auth" => (RATE_POLICY.auth, RouteClass::Auth),
            "write" => (RATE_POLICY.write, RouteClass::Write),
            "read" => (RATE_POLICY.read, RouteClass::Read),
            other => panic!("unknown class: {other}"),
        };
        assert_eq!(class.as_str(), case.class);

        let first_at_ms = case.takes.first().map(|s| s.at_ms).unwrap_or(0);
        let mut bucket = Bucket::full(&policy, first_at_ms);

        for (index, step) in case.takes.iter().enumerate() {
            let res = take(&bucket, &policy, step.at_ms);
            assert_eq!(
                res.allowed, step.allowed,
                "case '{}' step {} allowed mismatch at {} ms",
                case.name, index, step.at_ms
            );
            assert_eq!(
                res.retry_after_secs, step.retry_after,
                "case '{}' step {} retryAfter mismatch at {} ms",
                case.name, index, step.at_ms
            );
            bucket = res.bucket;
        }
    }
}
