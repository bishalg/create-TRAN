// Verifies: REQ-DB-011
//! The stored-record decision through the UniFFI export surface (`fixtures/stored-records.json`).
//! The records are read by each platform's own store and tested there, never through Rust.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use tran_uniffi::{
    tran_stored_config_schema, tran_stored_push_schema, tran_stored_record_decision,
    tran_stored_session_schema, TranStoredRecordAction,
};

const FIXTURE: &str = include_str!("../../../fixtures/stored-records.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureData {
    current_schemas: CurrentSchemas,
    decisions: Vec<DecisionCase>,
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
