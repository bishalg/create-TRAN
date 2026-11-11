// Verifies: REQ-DB-011 REQ-DB-012
//! Stored record cases through the UniFFI export surface (pinned by `fixtures/stored-records.json`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use serde_json::Value;
use tran_uniffi::{
    tran_read_stored_push, tran_read_stored_session, tran_stored_config_schema,
    tran_stored_push_schema, tran_stored_record_decision, tran_stored_session_schema,
    TranStoredRecordAction,
};

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
fn uniffi_current_schemas_match_fixture() {
    let data = fixture();
    assert_eq!(tran_stored_session_schema(), data.current_schemas.session);
    assert_eq!(tran_stored_push_schema(), data.current_schemas.push);
    assert_eq!(tran_stored_config_schema(), data.current_schemas.config);
}

#[test]
fn uniffi_stored_record_decisions_match_fixture() {
    let data = fixture();
    for case in data.decisions {
        let action = tran_stored_record_decision(case.schema, case.current);
        let action_str = match action {
            TranStoredRecordAction::Use => "use",
            TranStoredRecordAction::Upgrade => "upgrade",
            TranStoredRecordAction::Discard => "discard",
        };
        assert_eq!(
            action_str, case.action,
            "decision mismatch for '{}'",
            case.name
        );
    }
}

#[test]
fn uniffi_session_records_match_fixture() {
    let data = fixture();
    for case in data.records.session {
        let raw_str = case.raw.to_string();
        let result = tran_read_stored_session(raw_str, tran_stored_session_schema());
        match case.expected {
            Some(expected) => {
                let rec = result.unwrap_or_else(|| panic!("expected record for '{}'", case.name));
                assert_eq!(rec.schema, expected["schema"].as_u64().unwrap() as u32);
                assert_eq!(rec.user_id, expected["userId"].as_str().unwrap());
                assert_eq!(rec.role, expected["role"].as_str().unwrap());
                assert_eq!(
                    rec.refresh_token,
                    expected["refreshToken"].as_str().unwrap()
                );
            }
            None => {
                assert!(result.is_none(), "expected None for '{}'", case.name);
            }
        }
    }
}

#[test]
fn uniffi_push_records_match_fixture() {
    let data = fixture();
    for case in data.records.push {
        let raw_str = case.raw.to_string();
        let result = tran_read_stored_push(raw_str, tran_stored_push_schema());
        match case.expected {
            Some(expected) => {
                let rec = result.unwrap_or_else(|| panic!("expected record for '{}'", case.name));
                assert_eq!(rec.schema, expected["schema"].as_u64().unwrap() as u32);
                assert_eq!(rec.token, expected["token"].as_str().unwrap());
                assert_eq!(
                    rec.registered_at_unix_s,
                    expected["registeredAtUnixS"].as_i64().unwrap()
                );
            }
            None => {
                assert!(result.is_none(), "expected None for '{}'", case.name);
            }
        }
    }
}
