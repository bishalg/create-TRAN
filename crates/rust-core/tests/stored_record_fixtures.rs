// Verifies: REQ-DB-011 REQ-DB-012
//! Stored-record decisions and schema rule from `fixtures/stored-records.json`.
//!
//! The records themselves are driven through each platform's real store (iOS
//! `StoredRecordTests.swift`, Android `StoredRecordTest.kt`); here every record's `schema` is held
//! to the one rule the platforms apply, so the fixture cannot ask a platform for the impossible.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::stored_records::{
    stored_record, stored_schema, StoredRecordAction, CURRENT_CONFIG_SCHEMA, CURRENT_PUSH_SCHEMA,
    CURRENT_SESSION_SCHEMA,
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
    kept: bool,
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

/// What the two rules say about one stored record, before its fields are read.
fn verdict(raw: &Value, current: u32) -> Option<StoredRecordAction> {
    stored_schema(raw.get("schema")).map(|schema| stored_record(schema, current))
}

fn check_records(cases: &[RecordCase], current: u32) {
    for case in cases {
        let verdict = verdict(&case.raw, current);
        match (&case.expected, verdict) {
            // A record handed back was readable and not newer.
            (Some(expected), Some(StoredRecordAction::Use | StoredRecordAction::Upgrade)) => {
                assert_eq!(
                    expected["schema"], current,
                    "{}: read as current",
                    case.name
                );
                assert!(case.kept, "{}: a used record is never rewritten", case.name);
            }
            // A newer version is treated as absent and left for the app that wrote it.
            (None, Some(StoredRecordAction::Discard)) => {
                assert!(case.kept, "{}: a newer record is left in place", case.name);
            }
            // An unreadable schema is deleted.
            (None, None) => assert!(!case.kept, "{}: unreadable is deleted", case.name),
            // A readable version whose fields are broken: unreadable, deleted.
            (None, Some(_)) => assert!(!case.kept, "{}: unreadable is deleted", case.name),
            (Some(_), other) => panic!("{}: expected a record, rule says {other:?}", case.name),
        }
    }
}

#[test]
fn every_kept_record_follows_the_schema_rule() {
    let data = fixture();
    check_records(&data.records.session, CURRENT_SESSION_SCHEMA);
    check_records(&data.records.push, CURRENT_PUSH_SCHEMA);
    check_records(&data.records.config, CURRENT_CONFIG_SCHEMA);
}

#[test]
fn the_fixture_keeps_an_unversioned_record_of_every_kind() {
    // REQ-DB-012: what the release before versioning wrote must keep reading.
    let data = fixture();
    for (kind, cases) in [
        ("session", &data.records.session),
        ("push", &data.records.push),
        ("config", &data.records.config),
    ] {
        assert!(
            cases
                .iter()
                .any(|c| c.raw.get("schema").is_none() && c.expected.is_some()),
            "{kind}: no unversioned record that keeps reading"
        );
    }
}
