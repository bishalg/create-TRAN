// Verifies: REQ-DB-011 REQ-DB-012
//! Stored-record decision and recovery cases from `fixtures/stored-records.json`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::stored_records::{
    read_stored_config, read_stored_push, read_stored_session, stored_record,
    CURRENT_CONFIG_SCHEMA, CURRENT_PUSH_SCHEMA, CURRENT_SESSION_SCHEMA,
};
use serde::Deserialize;
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../fixtures/stored-records.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureData {
    current_schemas: CurrentSchemas,
    decisions: Vec<DecisionCase>,
    records: RecordsFixture,
}

#[derive(Deserialize)]
struct CurrentSchemas {
    session: u32,
    push: u32,
    config: u32,
}

#[derive(Deserialize)]
struct DecisionCase {
    name: String,
    schema: u32,
    current: u32,
    action: String,
}

#[derive(Deserialize)]
struct RecordsFixture {
    session: Vec<RecordCase>,
    push: Vec<RecordCase>,
    config: Vec<RecordCase>,
}

#[derive(Deserialize)]
struct RecordCase {
    name: String,
    raw: Value,
    expected: Option<Value>,
}

fn fixture() -> FixtureData {
    serde_json::from_str(FIXTURE).expect("fixtures/stored-records.json is valid JSON")
}

#[test]
fn current_schemas_match_constants() {
    let data = fixture();
    assert_eq!(CURRENT_SESSION_SCHEMA, data.current_schemas.session);
    assert_eq!(CURRENT_PUSH_SCHEMA, data.current_schemas.push);
    assert_eq!(CURRENT_CONFIG_SCHEMA, data.current_schemas.config);
}

#[test]
fn stored_record_decisions_match_fixture() {
    let data = fixture();
    for case in data.decisions {
        let action = stored_record(case.schema, case.current);
        assert_eq!(
            action.as_str(),
            case.action,
            "decision mismatch for case '{}' (schema={}, current={})",
            case.name,
            case.schema,
            case.current
        );
    }
}

#[test]
fn session_records_match_fixture() {
    let data = fixture();
    for case in data.records.session {
        let raw_str = case.raw.to_string();
        let result = read_stored_session(&raw_str, CURRENT_SESSION_SCHEMA);
        match case.expected {
            Some(expected) => {
                let rec = result.unwrap_or_else(|| panic!("expected record for '{}'", case.name));
                let expected_schema = expected["schema"].as_u64().unwrap() as u32;
                let expected_user_id = expected["userId"].as_str().unwrap();
                let expected_role = expected["role"].as_str().unwrap();
                let expected_token = expected["refreshToken"].as_str().unwrap();

                assert_eq!(rec.schema, expected_schema, "{}: schema", case.name);
                assert_eq!(rec.user_id, expected_user_id, "{}: userId", case.name);
                assert_eq!(rec.role, expected_role, "{}: role", case.name);
                assert_eq!(rec.refresh_token, expected_token, "{}: token", case.name);
            }
            None => {
                assert!(
                    result.is_none(),
                    "expected None for case '{}', got {:?}",
                    case.name,
                    result
                );
            }
        }
    }
}

#[test]
fn push_records_match_fixture() {
    let data = fixture();
    for case in data.records.push {
        let raw_str = case.raw.to_string();
        let result = read_stored_push(&raw_str, CURRENT_PUSH_SCHEMA);
        match case.expected {
            Some(expected) => {
                let rec = result.unwrap_or_else(|| panic!("expected record for '{}'", case.name));
                let expected_schema = expected["schema"].as_u64().unwrap() as u32;
                let expected_token = expected["token"].as_str().unwrap();
                let expected_at = expected["registeredAtUnixS"].as_i64().unwrap();

                assert_eq!(rec.schema, expected_schema, "{}: schema", case.name);
                assert_eq!(rec.token, expected_token, "{}: token", case.name);
                assert_eq!(
                    rec.registered_at_unix_s, expected_at,
                    "{}: registeredAtUnixS",
                    case.name
                );
            }
            None => {
                assert!(
                    result.is_none(),
                    "expected None for case '{}', got {:?}",
                    case.name,
                    result
                );
            }
        }
    }
}

#[test]
fn config_records_match_fixture() {
    let data = fixture();
    for case in data.records.config {
        let raw_str = case.raw.to_string();
        let result = read_stored_config(&raw_str, CURRENT_CONFIG_SCHEMA);
        match case.expected {
            Some(expected) => {
                let rec = result.unwrap_or_else(|| panic!("expected record for '{}'", case.name));
                let expected_schema = expected["schema"].as_u64().unwrap() as u32;
                let expected_version = expected["configVersion"].as_i64().unwrap();

                assert_eq!(rec.schema, expected_schema, "{}: schema", case.name);
                assert_eq!(
                    rec.config_version, expected_version,
                    "{}: configVersion",
                    case.name
                );
            }
            None => {
                assert!(
                    result.is_none(),
                    "expected None for case '{}', got {:?}",
                    case.name,
                    result
                );
            }
        }
    }
}
