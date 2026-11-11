// Verifies: REQ-CFG-001 REQ-CFG-003 REQ-CFG-006 REQ-CFG-007 REQ-CFG-010
//! Feature flags and bucket cases from `fixtures/flags.json`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::compat::ClientPlatform;
use rust_core::flags::{
    derive_bucket, evaluate, find_flag, is_safe_flag_id, ClientEvaluationContext, FlagType,
    FlagValue, Rule, ALL_FLAGS,
};
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/flags.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureData {
    flags: Vec<FlagFixture>,
    buckets: Vec<BucketFixture>,
    evaluations: Vec<EvaluationFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlagFixture {
    id: String,
    #[serde(rename = "type")]
    flag_type: String,
    default_value: FlagValue,
    live: bool,
    owner: String,
    purpose: String,
    expiry: String,
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
    rules: Vec<Rule>,
    client: ClientFixture,
    expected: FlagValue,
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
fn flags_catalogue_matches_fixture() {
    // Verifies: REQ-CFG-001 REQ-CFG-007 REQ-CFG-010
    let data = fixture();
    assert_eq!(ALL_FLAGS.len(), data.flags.len());

    for expected in data.flags {
        let flag = find_flag(&expected.id).expect("declared in rust catalogue");
        assert_eq!(flag.id, expected.id);
        let expected_type = match expected.flag_type.as_str() {
            "boolean" => FlagType::Boolean,
            "integer" => FlagType::Integer,
            "string" => FlagType::String,
            other => panic!("unknown flag type {other}"),
        };
        assert_eq!(flag.flag_type, expected_type);
        assert_eq!(flag.default_value, expected_value(&expected.default_value));
        assert_eq!(flag.live, expected.live);
        assert_eq!(flag.owner, expected.owner);
        assert_eq!(flag.purpose, expected.purpose);
        assert_eq!(flag.expiry, expected.expiry);
        assert!(is_safe_flag_id(flag.id));
    }
}

fn expected_value(v: &FlagValue) -> FlagValue {
    v.clone()
}

#[test]
fn bucket_derivation_cases_match_fixture() {
    // Verifies: REQ-CFG-006
    let data = fixture();
    for case in data.buckets {
        let actual = derive_bucket(&case.installation_id);
        assert_eq!(
            actual, case.bucket,
            "bucket mismatch for installation ID '{}'",
            case.installation_id
        );
    }
}

#[test]
fn evaluation_cases_match_fixture() {
    // Verifies: REQ-CFG-003
    let data = fixture();
    for case in data.evaluations {
        let flag = find_flag(&case.flag).expect("flag exists");
        let platform = match case.client.platform.as_str() {
            "ios" => ClientPlatform::Ios,
            "android" => ClientPlatform::Android,
            "web" => ClientPlatform::Web,
            _ => ClientPlatform::Unknown,
        };
        let ctx = ClientEvaluationContext {
            platform,
            version: case.client.version.as_deref(),
            bucket: case.client.bucket,
        };
        let actual = evaluate(flag, &case.rules, &ctx);
        assert_eq!(
            actual, case.expected,
            "evaluation mismatch for test case '{}'",
            case.name
        );
    }
}
