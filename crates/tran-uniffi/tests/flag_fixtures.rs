// Verifies: REQ-CFG-003 REQ-CFG-006
//! Feature flags and bucket cases through the UniFFI export surface (same fixture as rust-core).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use serde_json::Value;
use tran_uniffi::{tran_derive_bucket, tran_evaluate_flag_boolean, TranClientPlatform};

const FIXTURE: &str = include_str!("../../../fixtures/flags.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureData {
    buckets: Vec<BucketFixture>,
    evaluations: Vec<EvaluationFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BucketFixture {
    installation_id: String,
    bucket: u8,
}

#[derive(Deserialize)]
struct EvaluationFixture {
    name: String,
    flag: String,
    rules: Vec<Value>,
    client: ClientFixture,
    expected: Value,
}

#[derive(Deserialize)]
struct ClientFixture {
    platform: String,
    version: Option<String>,
    bucket: u8,
}

fn fixture() -> FixtureData {
    serde_json::from_str(FIXTURE).expect("fixtures/flags.json is valid JSON")
}

#[test]
fn uniffi_bucket_derivation_cases_match_fixture() {
    // Verifies: REQ-CFG-006
    let data = fixture();
    for case in data.buckets {
        let actual = tran_derive_bucket(case.installation_id.clone());
        assert_eq!(
            actual, case.bucket,
            "UniFFI bucket mismatch for '{}'",
            case.installation_id
        );
    }
}

#[test]
fn uniffi_evaluation_cases_match_fixture() {
    // Verifies: REQ-CFG-003
    let data = fixture();
    for case in data.evaluations {
        if !case.expected.is_boolean() {
            continue;
        }
        let rules_json = serde_json::to_string(&case.rules).expect("valid json rules");
        let platform = match case.client.platform.as_str() {
            "ios" => TranClientPlatform::Ios,
            "android" => TranClientPlatform::Android,
            "web" => TranClientPlatform::Web,
            _ => TranClientPlatform::Unknown,
        };
        let actual = tran_evaluate_flag_boolean(
            case.flag.clone(),
            rules_json,
            platform,
            case.client.version.clone(),
            case.client.bucket,
        )
        .expect("evaluation succeeds");
        assert_eq!(
            actual,
            case.expected.as_bool().unwrap(),
            "UniFFI evaluation mismatch for '{}'",
            case.name
        );
    }
}
